// Run: node test/alerts.mjs  — offline checks of the combined verdict and alert logic (no network).
import assert from 'node:assert/strict';
import { dealerSide, readOverall, readCarry } from '../tools/market-maker/read.js';
import { levelCrossings } from '../tools/fragility/alerts.js';
import { MM_CONFIG } from '../tools/market-maker/config.js';
import { pickLevels, needsRepick } from '../shared/levels.js';
import { CONFIG } from '../tools/fragility/config.js';

const cfg = { ...MM_CONFIG, gapPts: 5, flipBufferPts: 1 };

// 1. Dealer side: plain thresholds, then the buffer keeps it from flapping.
assert.equal(dealerSide(6, null, cfg), 'win');
assert.equal(dealerSide(0, null, cfg), 'even');
assert.equal(dealerSide(-5, null, cfg), 'lose');
assert.equal(dealerSide(-4.5, 'lose', cfg), 'lose');  // still within the buffer
assert.equal(dealerSide(-3.9, 'lose', cfg), 'even');  // clearly back inside
assert.equal(dealerSide(-4.5, 'even', cfg), 'even');  // not losing until −5
assert.equal(dealerSide(4.5, 'win', cfg), 'win');
assert.equal(dealerSide(-6, 'win', cfg), 'lose');     // straight from winning to losing

// 2. Levels: crossings both ways, the buffer, several at once, first run quiet.
const L = [2250, 2200, 2170];
let r = levelCrossings(2235, L, {}, 0.15);
assert.deepEqual(r.sides, { 2250: 'below', 2200: 'above', 2170: 'above' });
assert.equal(r.crossed.length, 0, 'first run never alerts');
let s = r.sides;
r = levelCrossings(2199, L, s, 0.15);                 // 0.05% under 2,200: inside the buffer
assert.equal(r.crossed.length, 0);
r = levelCrossings(2195, L, s, 0.15);                 // 0.23% under: counts
assert.deepEqual(r.crossed, [{ level: 2200, dir: 'down' }]);
s = r.sides;
r = levelCrossings(2201, L, s, 0.15);                 // back over by a hair: still below
assert.equal(r.crossed.length, 0);
r = levelCrossings(2160, L, s, 0.15);
assert.deepEqual(r.crossed, [{ level: 2170, dir: 'down' }]);
r = levelCrossings(2260, L, r.sides, 0.15);           // big rally through all three
assert.deepEqual(r.crossed.map(c => c.level + c.dir), ['2250up', '2200up', '2170up']);

// 3. Combined verdict.
const a = (gap, net, vegaW, dIv) => ({ ivWeek: 55, rvWeek: 55 - gap, ivChange24h: dIv || 0,
  carry: { total: { theta: 1e5, hedge: net - 1e5, net: net, vegaW: vegaW || 0 }, groups: [] } });
let o = readOverall(a(8, 5e4), 0.2, { score: 20, zone: 'Calm' }, cfg, 0.05);
assert.equal(o.level, 'steady');
assert.match(o.text, /well paid/);
o = readOverall(a(0, 5e4, 4e5, -3), 0, { score: 45, zone: 'Building' }, cfg, 0.05);
assert.equal(o.level, 'watch');                       // vol drop cost dealers + leverage building
assert.match(o.text, /leverage is building/);
o = readOverall(a(-7, -2e5), -0.2, { score: 70, zone: 'Primed' }, cfg, 0.05);
assert.equal(o.level, 'unstable');
assert.match(o.text, /^Overall: unstable\. Dealers are losing on the moves and leverage is stretched\.$/);
o = readOverall({ ivWeek: 55, rvWeek: 55, ivChange24h: 0, carry: null }, null, null, cfg, 0.05);
assert.equal(o.level, 'steady');                      // nothing known: no pressure, says so plainly
assert.equal(o.text, 'Overall: steady. Nothing stands out either way.');
o = readOverall(a(0, 5e4, 4e5, -3), 0, { score: 20, zone: 'Calm' }, cfg, 0.05);
assert.equal(o.level, 'steady');                      // one small flag: still steady, but named
assert.match(o.text, /^Overall: steady\. Only one thing to watch: the last day's implied vol move cost them ~\$1\.2M\.$/);

// 4. When step 1 and the dollars disagree, the dollar line says why.
const c = (net) => ({ total: { theta: 1e5, hedge: net - 1e5, net: net }, groups: [] });
assert.match(readCarry(c(3e5), -8, cfg), /in general are losing/);
assert.match(readCarry(c(-3e5), 8, cfg), /in general are winning/);
assert.doesNotMatch(readCarry(c(3e5), 8, cfg), /in general/);
assert.doesNotMatch(readCarry(c(3e5)), /in general/);

// 5. Key levels picked from the option chain: 2 biggest strikes above and below.
const T0 = Date.UTC(2026, 10, 1, 9), opt = (type, strike, oi) => ({ type, strike, oi, iv: 0.6, expiry: T0 + 5 * 864e5 });
const chain = [
  opt('C', 2300, 40000), opt('C', 2280, 30000), opt('C', 2260, 2000), opt('C', 2275, 25000), // 2,275 sits 0.2% from 2,280
  opt('P', 2220, 8000), opt('P', 2180, 9000), opt('P', 2200, 1000), opt('P', 2240, 500),
  opt('C', 2500, 99999),                                                                      // outside ±5%: ignored
];
const KL = CONFIG.keyLevels;
let lv = pickLevels(chain, 2267, T0, KL);
assert.deepEqual(lv.map(l => l.price), [2180, 2220, 2280, 2300]);
assert.ok(lv.find(l => l.price === 2180).usd < 0 && lv.find(l => l.price === 2300).usd > 0); // puts negative, calls positive
// The small side still gets levels: each side is measured against its own biggest.
assert.equal(pickLevels(chain, 2267, T0, KL).filter(l => l.price < 2267).length, 2);
// Not price-dependent: the same levels a little higher (only the split above/below moves).
assert.deepEqual(pickLevels(chain, 2250, T0, KL).map(l => l.price), [2180, 2220, 2280, 2300]);
assert.deepEqual(pickLevels([], 2267, T0, KL), []);
// Expired options don't count.
assert.deepEqual(pickLevels(chain.map(o => ({ ...o, expiry: T0 - 1 })), 2267, T0, KL), []);

// 6. When to pick again: daily after 08:00 UTC, or when price runs past one side.
const st = { levels: [2180, 2220, 2280, 2300], picked: Date.UTC(2026, 10, 1, 8, 7) };
assert.equal(needsRepick(null, 2267, T0, 8), true);                              // nothing stored
assert.equal(needsRepick(st, 2267, Date.UTC(2026, 10, 1, 23), 8), false);         // same day
assert.equal(needsRepick(st, 2267, Date.UTC(2026, 10, 2, 7, 52), 8), false);      // next day, before 08:00 UTC
assert.equal(needsRepick(st, 2267, Date.UTC(2026, 10, 2, 8, 7), 8), true);        // next day, after the expiry
assert.equal(needsRepick(st, 2310, Date.UTC(2026, 10, 1, 12), 8), true);          // above every level
assert.equal(needsRepick(st, 2170, Date.UTC(2026, 10, 1, 12), 8), true);          // below every level

console.log('alerts: all checks passed');
