// Run: node test/alerts.mjs  — offline checks of the combined verdict and alert logic (no network).
import assert from 'node:assert/strict';
import { dealerSide, readOverall, readCarry } from '../tools/market-maker/read.js';
import { levelCrossings, breakReversals } from '../tools/fragility/alerts.js';
import { MM_CONFIG } from '../tools/market-maker/config.js';
import { pickLevels, needsRepick, METHOD } from '../shared/levels.js';
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

// 5. Key gamma levels: the 5 strikes with the most open calls + puts within ±15%,
//    leaving out options that expire within 2 days.
const T0 = Date.UTC(2026, 10, 1, 9), D = 864e5;
const opt = (type, strike, oi, days = 20) => ({ type, strike, oi, iv: 0.6, expiry: T0 + days * D });
const chain = [
  opt('C', 2000, 50000), opt('P', 2000, 55000),          // 105k
  opt('C', 2200, 60000), opt('P', 2200, 32000),          // 92k
  opt('C', 2500, 70000), opt('P', 2500, 5000),           // 75k
  opt('C', 2300, 50000), opt('P', 2300, 23000),          // 73k
  opt('C', 2400, 55000), opt('P', 2400, 5000),           // 60k
  opt('C', 2280, 900000, 1),                             // huge but expires tomorrow: ignored
  opt('C', 2310, 40000),                                 // 0.4% from 2,300, which is bigger: skipped
  opt('C', 2700, 30000), opt('P', 1700, 99999),          // 2,700 is 6th; 1,700 is outside ±15%
];
const KL = CONFIG.keyLevels;
let lv = pickLevels(chain, 2267, T0, KL);
assert.deepEqual(lv.map(l => l.price), [2000, 2200, 2300, 2400, 2500]);
assert.equal(lv.find(l => l.price === 2200).oi, 92000);
// Not tied to the price: the same five a little lower (the range still covers them).
assert.deepEqual(pickLevels(chain, 2230, T0, KL).map(l => l.price), [2000, 2200, 2300, 2400, 2500]);
assert.deepEqual(pickLevels([], 2267, T0, KL), []);

// 5b. A cross only counts when a 15-minute close is 0.5% past the level.
const conf = KL.confirmPct;
assert.equal(conf, 0.5);
let cr = levelCrossings(2306, [2300], { 2300: 'below' }, conf);                 // 0.26% above: not yet
assert.equal(cr.crossed.length, 0);
assert.equal(cr.sides[2300], 'below');
cr = levelCrossings(2312, [2300], cr.sides, conf);                              // 0.52% above: crossed
assert.deepEqual(cr.crossed, [{ level: 2300, dir: 'up' }]);

// 5c. Break, then reversal within 48 hours (the close must be 0.5% back the other side).
const H = 36e5, WIN = KL.reversalHours * H;
let br = [{ level: 2300, dir: 'up', at: T0, extreme: 2312 }];
let rv = breakReversals(2318, T0 + 2 * H, br, conf, WIN);            // still above: open, extreme rises
assert.equal(rv.reversed.length, 0);
assert.equal(rv.open[0].extreme, 2318);
rv = breakReversals(2292, T0 + 3 * H, rv.open, conf, WIN);           // back under, but only 0.35%: not yet
assert.equal(rv.reversed.length, 0);
rv = breakReversals(2285, T0 + 30 * H, rv.open, conf, WIN);          // 0.65% back below, 30 hours later
assert.equal(rv.reversed.length, 1);
assert.equal(rv.reversed[0].extreme, 2318);
assert.equal(rv.open.length, 0);                                    // dropped after reversing
// Downside break that comes back up.
rv = breakReversals(2212, T0 + 5 * H, [{ level: 2200, dir: 'down', at: T0, extreme: 2185 }], conf, WIN);
assert.equal(rv.reversed.length, 1);
// Older than 48 hours: no longer watched, even if price comes back.
rv = breakReversals(2285, T0 + 49 * H, [{ level: 2300, dir: 'up', at: T0, extreme: 2318 }], conf, WIN);
assert.equal(rv.reversed.length, 0);
assert.equal(rv.open.length, 0);

// 6. When to pick again: daily after 08:00 UTC, or when price runs past one side.
const st = { levels: [2180, 2220, 2280, 2300], picked: Date.UTC(2026, 10, 1, 8, 7), method: METHOD };
assert.equal(needsRepick(null, 2267, T0, 8), true);                              // nothing stored
assert.equal(needsRepick(st, 2267, Date.UTC(2026, 10, 1, 23), 8), false);         // same day
assert.equal(needsRepick(st, 2267, Date.UTC(2026, 10, 2, 7, 52), 8), false);      // next day, before 08:00 UTC
assert.equal(needsRepick(st, 2267, Date.UTC(2026, 10, 2, 8, 7), 8), true);        // next day, after the expiry
assert.equal(needsRepick(st, 2310, Date.UTC(2026, 10, 1, 12), 8), true);          // above every level
assert.equal(needsRepick(st, 2170, Date.UTC(2026, 10, 1, 12), 8), true);          // below every level
assert.equal(needsRepick({ ...st, method: undefined }, 2267, Date.UTC(2026, 10, 1, 12), 8), true); // sized the old way

console.log('alerts: all checks passed');
