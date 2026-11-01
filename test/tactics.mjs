// Run: node test/tactics.mjs  — offline checks of the Tactics model with made-up data (no network).
import assert from 'node:assert/strict';
import { gexNodes, pickPivot, pickPivots, profile, drift, footprint, niceStep, signals, setup, decide, decideBoth, sixOfSix } from '../tools/tactics/model.js';
import { TAC_CONFIG as cfg } from '../tools/tactics/config.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, a + ' vs ' + b);
const now = Date.UTC(2026, 9, 31, 12), day = 864e5;

// 1. Gamma nodes: calls positive, puts negative; pivot = nearest big node.
const opt = (type, strike, oi) => ({ type, strike, oi, iv: 0.55, expiry: now + 7 * day });
const nodes = gexNodes([opt('C', 2250, 20000), opt('P', 2250, 5000), opt('P', 2200, 30000), opt('C', 2300, 2000), opt('C', 2500, 99999)], 2236, now, 4);
assert.deepEqual(nodes.map(n => n.strike), [2200, 2250, 2300]);    // 2,500 is outside ±4%
assert.ok(nodes[1].call > 0 && nodes[1].put < 0 && nodes[1].net > 0);
assert.ok(nodes[0].net < 0);
let piv = pickPivot(nodes, 2236, cfg);
assert.equal(piv.strike, 2250);                                      // big and nearest
piv = pickPivot(nodes, 2236, { ...cfg, pivotShare: 0.99 });
assert.equal(Math.abs(piv.net), Math.max(...nodes.map(n => Math.abs(n.net))));

// 2. Volume profile: busiest price is the POC; value area holds ~70% around it.
const cs = [];
for (let i = 0; i < 100; i++) cs.push({ l: 2230, h: 2232, usd: 10 });   // heavy trading at 2,230–2,232
for (let i = 0; i < 10; i++) cs.push({ l: 2200, h: 2260, usd: 6 });     // thin spread over the range
const pr = profile(cs, 60, 0.7);
near(pr.poc, 2231, 1);
assert.ok(pr.val <= 2230 && pr.vah >= 2232 && pr.vah - pr.val < 10, 'value area hugs the busy zone');
const inside = pr.bins.filter(b => b.mid >= pr.val && b.mid <= pr.vah).reduce((s, b) => s + b.usd, 0);
assert.ok(inside >= 0.7 * pr.total);

// 3. Premium drift: puts bought, calls sold -> bearish numbers.
const dr = drift([
  { t: now, type: 'P', dir: 1, usd: 300e3 }, { t: now + 6e5, type: 'C', dir: -1, usd: 100e3 },
  { t: now + 12e5, type: 'C', dir: 1, usd: 20e3 }], 5 * 6e4);
assert.equal(dr.puts, 300e3);
assert.equal(dr.calls, -80e3);
assert.equal(dr.series.at(-1).calls, -80e3);

// 4. Footprint rows and signals.
assert.equal(niceStep(30, 15), 2);
assert.equal(niceStep(700, 15), 50);
const T = (t, price, usd, dir) => ({ t: now + t, price, usd, dir });
// A candle that pushes up to 2,250 on thin buying, with sellers hitting the upper rows.
const trades = [
  T(0, 2240, 50e3, 1), T(1, 2240, 40e3, -1), T(2, 2242, 60e3, 1), T(3, 2242, 50e3, -1),
  T(4, 2244, 10e3, 1), T(5, 2244, 60e3, -1), T(6, 2246, 8e3, 1), T(7, 2246, 50e3, -1),
  T(8, 2248, 5e3, 1), T(9, 2248, 30e3, -1), T(10, 2250, 1e3, 1), T(11, 2250, 20e3, -1),
  T(12, 2243, 30e3, -1),
];
const fp = footprint(trades, 15 * 6e4, 2);
assert.equal(fp.length, 1);
const c = fp[0];
assert.equal(c.h, 2250); assert.equal(c.c, 2243);
assert.equal(c.rows[0].price, 2250);
assert.ok(c.delta < 0);
const s = signals(c, cfg);
assert.equal(s.buyersExhausted, true);
assert.equal(s.sellersIn, true);
assert.equal(s.buyersIn, false);

// 5. The full setup, like the video: retest of the pivot from below, VAH aligned,
//    put-heavy premium, sellers in, price below the flip -> ready, short.
const st = {
  spot: 2243, pivot: { strike: 2250, net: 5e6 }, flip: 2262, nodes: [{ strike: 2250, net: 5e6 }, { strike: 2200, net: -4e6 }, { strike: 2225, net: 1e6 }],
  profile: { poc: 2232, vah: 2251, val: 2215 }, drift: { calls: -80e3, puts: 300e3 }, candles: fp,
};
let r = setup(st, cfg);
assert.equal(r.side, 'short');
assert.equal(r.status, 'ready');
assert.ok(r.checks.every(x => x.ok === true), JSON.stringify(r.checks));
near(r.stop, 2250 * 1.001, 0.01);                       // just above the retest high
assert.equal(r.entry, 2243);
assert.deepEqual(r.targets.map(t => Math.round(t.price)), [2232, 2215]);   // POC then VAL
assert.ok(r.targets[1].r > 3);

// Not at the level yet -> waiting, entry planned at the retest.
r = setup({ ...st, spot: 2225, candles: footprint(trades.map(x => ({ ...x, price: x.price - 30 })), 15 * 6e4, 2) }, cfg);
assert.equal(r.status, 'waiting');
near(r.entry, 2250 - 2250 * cfg.levelTolPct / 100, 1e-9);
// At the level but premium is call-heavy and price above the flip -> only building.
r = setup({ ...st, drift: { calls: 300e3, puts: -50e3 }, flip: 2200 }, cfg);
assert.equal(r.status, 'building');
// Price above the pivot -> the long side (support retest from above).
r = setup({ ...st, spot: 2256 }, cfg);
assert.equal(r.side, 'long');
// No pivot -> nothing to do.
assert.equal(setup({ ...st, pivot: null }, cfg).status, 'none');

// 6. The decision: SELL only when all six video rules hold, otherwise HOLD.
let dd = decide(setup(st, cfg));
assert.equal(dd.action, 'sell');
assert.equal(dd.met, 6);
// One rule missing is enough to hold: premium call-heavy...
dd = decide(setup({ ...st, drift: { calls: 300e3, puts: -50e3 } }, cfg));
assert.equal(dd.action, 'hold');
assert.equal(dd.met, 5);
assert.deepEqual(dd.rules.filter(r => !r.ok).map(r => r.key), ['premium']);
// ...or the pivot not at the value area high (the "ready" status alone would still allow it).
r = setup({ ...st, profile: { poc: 2232, vah: 2275, val: 2215 } }, cfg);
assert.equal(r.status, 'ready');
assert.equal(decide(r).action, 'hold');
// Sellers in but no exhaustion at the high -> hold.
const noEx = footprint(trades.map(x => x.price === 2250 ? { ...x, usd: x.dir > 0 ? 60e3 : x.usd } : x), 15 * 6e4, 2);
dd = decide(setup({ ...st, candles: noEx }, cfg));
assert.equal(dd.action, 'hold');
assert.ok(dd.rules.find(x => x.key === 'exhaustion').ok === false);
// Price above the pivot with the short-side data: the buy rules apply, and they don't hold.
dd = decide(setup({ ...st, spot: 2256 }, cfg));
assert.equal(dd.action, 'hold');
assert.equal(dd.short, false);
assert.ok(dd.met < 6);

// BUY: the mirror image (prices flipped around 2,250, buyers and sellers swapped).
const M = x => 4500 - x;
const fpL = footprint(trades.map(x => ({ ...x, price: M(x.price), dir: -x.dir })), 15 * 6e4, 2);
const sL = signals(fpL[0], cfg);
assert.equal(sL.sellersExhausted, true);
assert.equal(sL.buyersIn, true);
const stL = {
  spot: M(2243), pivot: { strike: 2250, net: 5e6 }, flip: M(2262), nodes: [{ strike: 2250, net: 5e6 }, { strike: 2300, net: -4e6 }, { strike: 2275, net: 1e6 }],
  profile: { poc: M(2232), vah: M(2215), val: M(2251) }, drift: { calls: 300e3, puts: -80e3 }, candles: fpL,
};
r = setup(stL, cfg);
assert.equal(r.side, 'long');
dd = decide(r);
assert.equal(dd.action, 'buy');
assert.equal(dd.met, 6);
assert.ok(r.stop < 2250 && r.targets[0].price > r.entry);
// One buy rule missing -> hold: put-heavy premium, or price below the flip.
dd = decide(setup({ ...stL, drift: { calls: -80e3, puts: 300e3 } }, cfg));
assert.equal(dd.action, 'hold');
assert.deepEqual(dd.rules.filter(r => !r.ok).map(r => r.key), ['premium']);
dd = decide(setup({ ...stL, flip: 2270 }, cfg));
assert.equal(dd.action, 'hold');
assert.deepEqual(dd.rules.filter(r => !r.ok).map(r => r.key), ['gamma']);
// No pivot at all -> hold.
assert.equal(decide(setup({ ...st, pivot: null }, cfg)).action, 'hold');

// 7. Phone alert: rings only on the step from 5 or fewer to 6, re-arms below 6.
const D = (met, action = met === 6 ? 'sell' : 'hold') => ({ met, action });
const ring = (seq, prev = null) => seq.map(d => { const t = sixOfSix(d, prev); prev = t.state; return t.fire; });
assert.deepEqual(ring([D(3), D(5), D(6), D(6), D(6)]), [false, false, true, false, false]);   // once, not every check
assert.deepEqual(ring([D(6), D(5), D(6)]), [true, false, true]);                               // drop re-arms it
assert.deepEqual(ring([D(6), D(0), D(4), D(6)]), [true, false, false, true]);
assert.deepEqual(ring([D(6)], { met: 6, action: 'sell' }), [false]);                           // already at 6 last time
assert.deepEqual(ring([D(5), D(6, 'buy'), D(6, 'buy'), D(4)]), [false, true, false, false]);   // buys ring the same way
assert.deepEqual(ring([D(6, 'buy'), D(6, 'sell')]), [true, true]);                             // straight flip to the other side
assert.deepEqual(ring([D(6)], 2), [true]);                                                     // older state: a bare count
// It counts the same decide() result the tab shows.
assert.equal(sixOfSix(decide(setup(st, cfg)), { met: 5, action: 'hold' }).fire, true);
assert.equal(sixOfSix(decide(setup(stL, cfg)), { met: 5, action: 'hold' }).fire, true);
assert.equal(sixOfSix(decide(setup({ ...st, drift: { calls: 300e3, puts: -50e3 } }, cfg)), { met: 4 }).fire, false);

// 8. Both sides at once: SELL rules at the nearest big node above, BUY rules at the
// nearest big node below (asked "look for sells and buys at the same time").
const two = [{ strike: 2200, net: -4e6 }, { strike: 2250, net: 5e6 }, { strike: 2275, net: 1e6 }, { strike: 2300, net: -4.5e6 }];
let pv = pickPivots(two, 2243, cfg);
assert.equal(pv.above.strike, 2250);                                 // 2,275 is too small to count
assert.equal(pv.below.strike, 2200);
assert.ok([pv.above, pv.below].includes(pickPivot(two, 2243, cfg))); // the tab's nearest pivot is one of them
pv = pickPivots(two, 2320, cfg);
assert.equal(pv.above, null);                                        // nothing big above: no sell side
assert.equal(pv.below.strike, 2300);
assert.deepEqual(pickPivots([], 2243, cfg), { above: null, below: null });
// SELL 6/6 at the pivot above while the buy side below is only partly there.
const sellS = setup(st, cfg), buyBelow = setup({ ...st, pivot: { strike: 2200, net: -4e6 } }, cfg);
assert.equal(sellS.side, 'short');
assert.equal(buyBelow.side, 'long');
dd = decideBoth(sellS, buyBelow, st.spot);
assert.equal(dd.action, 'sell');
assert.equal(dd.met, 6);
assert.equal(dd.setup, sellS);
assert.ok(dd.sides.buy.met < 6 && dd.sides.buy.action === 'hold');
// BUY 6/6 at the pivot below while the nearest big node is above: this used to be missed.
const buyS = setup(stL, cfg), sellAbove = setup({ ...stL, pivot: { strike: 2262, net: -4e6 } }, cfg);
assert.equal(sellAbove.side, 'short');
assert.ok(Math.abs(2262 - stL.spot) < Math.abs(2250 - stL.spot), 'the pivot above is the nearer one');
dd = decideBoth(sellAbove, buyS, stL.spot);
assert.equal(dd.action, 'buy');
assert.equal(dd.met, 6);
assert.equal(dd.short, false);
assert.equal(dd.setup, buyS);
assert.ok(dd.sides.sell.met < 6);
assert.equal(sixOfSix(dd, { met: 3, action: 'hold' }).fire, true);   // the phone rings for it
// Neither side complete: HOLD, led by the side with more rules met; both counts kept.
const sellPart = setup({ ...st, drift: { calls: 300e3, puts: -50e3 } }, cfg);          // 5 of 6
dd = decideBoth(sellPart, buyBelow, st.spot);
assert.equal(dd.action, 'hold');
assert.equal(dd.met, 5);
assert.equal(dd.short, true);
assert.equal(dd.sides.sell.met, 5);
assert.equal(dd.sides.buy.met, buyBelow && decide(buyBelow).met);
// Only one side has a big node, or none.
assert.equal(decideBoth(sellS, null, st.spot).action, 'sell');
assert.equal(decideBoth(null, buyS, stL.spot).action, 'buy');
dd = decideBoth(null, null, 2243);
assert.equal(dd.action, 'hold');
assert.equal(dd.noPivot, true);
// Both sides can never be 6/6 together: the gamma rule needs opposite sides of the flip.
for (const flip of [2200, 2243, 2300]) {
  const a = decide(setup({ ...st, flip }, cfg)), b = decide(setup({ ...st, flip, pivot: { strike: 2200, net: -4e6 } }, cfg));
  assert.ok(!(a.rules.find(r => r.key === 'gamma').ok && b.rules.find(r => r.key === 'gamma').ok));
}

console.log('tactics: all checks passed');
