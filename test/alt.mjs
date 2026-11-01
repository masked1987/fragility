// Run: node test/alt.mjs  — offline checks of the Alt Tactics model (made-up data).
import assert from 'node:assert/strict';
import { pickHuge, ichimoku, to15, findSetups, oncePerLevel, decideAlt } from '../tools/alt-tactics/model.js';
import { ALT_CONFIG as cfg } from '../tools/alt-tactics/config.js';

const M5 = 5 * 6e4, T0 = Date.UTC(2026, 9, 29, 12);
// 5-minute candles along a path of closes (each candle spans its open to close ±0.5).
function candles(path) {
  let prev = path[0];
  return path.map((c, i) => { const o = prev; prev = c; return { t: T0 + i * M5, h: Math.max(o, c) + 0.5, l: Math.min(o, c) - 0.5, c }; });
}
const line = (from, to, n) => Array.from({ length: n }, (_, i) => from + (to - from) * (i + 1) / n);
const flat = (x, n) => Array.from({ length: n }, (_, i) => x + (i % 2 ? 0.3 : -0.3));

// 1. Huge levels: calls + puts per strike, 70% of the biggest, tomorrow's expiry left out.
const now = T0, day = 864e5;
const opt = (strike, oi, days = 30) => ({ strike, oi, expiry: now + days * day, type: 'C' });
const huge = pickHuge([opt(2000, 90e3), opt(2200, 50e3), opt(2200, 40e3), opt(2300, 60e3), opt(2500, 70e3), opt(2400, 500e3, 1), opt(3500, 99e3)], 2250, now, cfg);
assert.deepEqual(huge.map(h => h.price), [2000, 2200, 2500]);   // 2,300 is 67%; 2,400 expires tomorrow; 3,500 is >35% away
assert.equal(huge[0].share, 1);

// 2. Ichimoku score: a steady rise scores 100, a steady fall 0.
let ich = ichimoku(candles(line(2000, 2300, 200)));
assert.equal(ich[77], null);
assert.equal(ich.at(-1).score, 100);
ich = ichimoku(candles(line(2300, 2000, 200)));
assert.equal(ich.at(-1).score, 0);
assert.equal(to15(candles(flat(2250, 9))).length, 3);

// 3. The owner's Oct 30 pattern: above 2,200, dip to ~2,169, buyers back.
const levels = [2000, 2200, 2500];
const dip = [...flat(2260, 120), ...line(2260, 2170, 30), ...flat(2170, 6), ...line(2170, 2240, 30), ...flat(2240, 10)];
let c = candles(dip);
let s = findSetups(c, levels, cfg);
assert.equal(s.length, 1);
assert.equal(s[0].level, 2200);
assert.equal(s[0].state, 'signal');
assert.ok(Math.abs(s[0].signal.stop - Math.min(...c.map(x => x.l))) < 1e-9, 'stop at the lowest price of the move');
assert.equal(s[0].signal.target, 2500);                        // the next huge level up
assert.ok(s[0].signal.entry > 2170 && s[0].signal.rr > 1);
let d = decideAlt(c, levels, cfg);
assert.equal(d.action, 'buy');                                 // trade open: no stop, no target yet
assert.equal(d.open.level, 2200);

// 4. Still falling, no confirmation yet: WATCH, with the low so far.
c = candles([...flat(2260, 120), ...line(2260, 2180, 30), ...flat(2180, 4)]);
d = decideAlt(c, levels, cfg);
assert.equal(d.action, 'watch');
assert.equal(d.waiting.level, 2200);
assert.ok(d.waiting.low < 2181);

// 5. More than 3% through the level: a real breakdown, no trade.
c = candles([...flat(2260, 120), ...line(2260, 2120, 40), ...line(2120, 2240, 40)]);
s = findSetups(c, levels, cfg);
assert.equal(s[0].state, 'broken');
assert.equal(decideAlt(c, levels, cfg).action, 'wait');

// 6. Once per level: stopped at 2,200, a second dip through 2,200 is not traded
//    until price has crossed another level.
const stopped = [...dip, ...line(2240, 2150, 30), ...line(2150, 2230, 25), ...flat(2230, 10), ...line(2230, 2160, 30), ...line(2160, 2245, 30), ...flat(2245, 10)];
c = candles(stopped);
s = oncePerLevel(findSetups(c, levels, cfg), c);
const taken = s.filter(x => x.taken);
assert.equal(taken.length, 1);
assert.equal(taken[0].trade.result, 'stopped');
assert.ok(s.some(x => x.used), 'a later dip through the same level is skipped');
// ...but after price crosses another level, 2,200 can be traded again.
const levels2 = [2000, 2200, 2230, 2500];
s = oncePerLevel(findSetups(c, levels2, cfg), c);
assert.ok(s.filter(x => x.taken && x.level === 2200).length >= 1);

// 7. Nothing happening: WAIT, with the huge levels either side.
c = candles(flat(2260, 300));
d = decideAlt(c, levels, cfg);
assert.equal(d.action, 'wait');
assert.equal(d.below, 2200);
assert.equal(d.above, 2500);

console.log('alt: all checks passed');
