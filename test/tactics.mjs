// Run: node test/tactics.mjs  — offline checks of the Tactics model with made-up data (no network).
import assert from 'node:assert/strict';
import { gexNodes, pickPivot, profile, drift, footprint, niceStep, signals, setup, decide } from '../tools/tactics/model.js';
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
assert.deepEqual(dd.rules.filter(r => !r.ok).map(r => r.key), ['puts']);
// ...or the pivot not at the value area high (the "ready" status alone would still allow it).
r = setup({ ...st, profile: { poc: 2232, vah: 2275, val: 2215 } }, cfg);
assert.equal(r.status, 'ready');
assert.equal(decide(r).action, 'hold');
// Sellers in but no exhaustion at the high -> hold.
const noEx = footprint(trades.map(x => x.price === 2250 ? { ...x, usd: x.dir > 0 ? 60e3 : x.usd } : x), 15 * 6e4, 2);
dd = decide(setup({ ...st, candles: noEx }, cfg));
assert.equal(dd.action, 'hold');
assert.ok(dd.rules.find(x => x.key === 'exhaustion').ok === false);
// Price above the pivot: the video's setup is a sell only -> hold, nothing met.
dd = decide(setup({ ...st, spot: 2256 }, cfg));
assert.equal(dd.action, 'hold');
assert.equal(dd.met, 0);
// No pivot at all -> hold.
assert.equal(decide(setup({ ...st, pivot: null }, cfg)).action, 'hold');

console.log('tactics: all checks passed');
