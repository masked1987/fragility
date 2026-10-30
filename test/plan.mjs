// Run: node test/plan.mjs  — offline checks of the Playbook mode and levels (no network).
import assert from 'node:assert/strict';
import { buildPlan, pickMode, trigger, roundTo } from '../tools/playbook/plan.js';
import { PLAY_CONFIG as cfg } from '../tools/playbook/config.js';

// Today's ETH readings (30 Oct 2026, late evening UTC), from the four tabs.
const today = {
  asset: 'ETH', spot: 2236, flip: 2240, move: 0.029, zone: 'Calm', score: 31, funding: 'short',
  gamma: -0.02, neutral: 0.05, overall: { level: 'steady' }, gap: 3.6, gapPts: 5,
  flow: { tone: 'down', down: 'open', up: 'far' },
  longs: [{ price: 2174, usd: 24e6, gammaThere: -9e6 }, { price: 2152, usd: 41e6, gammaThere: -9e6, largest: true }],
  shorts: [{ price: 2353, usd: 28e6, gammaThere: 19e6 }, { price: 2532, usd: 64e6, gammaThere: 21e6, largest: true }],
  strikes: [{ price: 1995, gamma: -3e6 }, { price: 2297, gamma: 2e6 }, { price: 2498, gamma: 2e6 }],
  levels: [2250, 2200, 2170],
};
const p = buildPlan(today, cfg);
assert.equal(p.mode.key, 'none', 'price on the flip, leverage flushed: no edge');
assert.equal(p.up, 2250);
assert.equal(p.down, 2200);
assert.equal(p.plans[0].key, 'wait');
const bd = p.plans.find(x => x.key === 'breakDown'), bu = p.plans.find(x => x.key === 'breakUp');
assert.equal(bd.stop, 2235);                                   // 2,200 + ½ day (~32) rounded up
assert.deepEqual(bd.targets.map(t => t.price), [2175, 2150]);  // the two long clusters
assert.equal(bu.stop, 2215);
assert.deepEqual(bu.targets.map(t => t.price), [2295, 2355]);  // stall strike, then short cluster
assert.equal(bu.targets[0].kind, 'strike');
assert.ok(Math.abs(bu.targets[0].r - 45 / 35) < 1e-9);   // (2,295 − 2,250) ÷ (2,250 − 2,215)
const fl = p.plans.find(x => x.key === 'flush');
assert.deepEqual(fl.zone, [2150, 2175]);
assert.equal(fl.side, 'long');

// Modes.
const m = (o) => pickMode({ ...today, ...o }, cfg).key;
assert.equal(m({ zone: 'Primed' }), 'cascade');
assert.equal(m({ overall: { level: 'unstable' } }), 'cascade');
assert.equal(m({ zone: 'Building', flow: { tone: 'down', down: 'loaded', up: 'far' } }), 'cascade');
assert.equal(m({ flow: { tone: 'down', down: 'loaded', up: 'far' } }), 'none'); // loaded but Calm: not a cascade by itself
assert.equal(m({ flow: { tone: 'up', down: 'far', up: 'open' } }), 'squeezeUp');
assert.equal(m({ spot: 2200, flow: { tone: 'up', down: 'far', up: 'open' } }), 'trendDown'); // squeeze needs price near/above the flip
assert.equal(m({ spot: 2200 }), 'trendDown');
assert.equal(m({ spot: 2280 }), 'range');
assert.equal(m({ spot: 2280, gap: -6 }), 'trendDown');           // dealers losing: not a range any more
assert.equal(m({ funding: 'long', flow: { tone: 'down', down: 'open', up: 'far' } }), 'squeezeDown');

// Preferred decision follows the mode; cascade halves every size.
let q = buildPlan({ ...today, spot: 2200 }, cfg);
assert.equal(q.plans[0].key, 'breakDown');
assert.equal(q.plans[0].preferred, true);
q = buildPlan({ ...today, zone: 'Primed' }, cfg);
assert.equal(q.plans[0].key, 'flush');
assert.ok(q.plans.every(x => x.size === 0.5));
q = buildPlan({ ...today, spot: 2280 }, cfg);
assert.equal(q.plans[0].key, 'range');

// Triggers: an upside trigger is never below the flip; nothing mapped -> half a day's move.
assert.equal(trigger({ ...today, flip: 2280 }, cfg, 1).level, 2280);
assert.equal(trigger({ ...today, flip: null, levels: [] }, cfg, -1).level, 2200);   // round number
const bare = buildPlan({ ...today, longs: null, shorts: null, strikes: [] }, cfg);
const t = bare.plans.find(x => x.key === 'breakDown').targets;
assert.equal(t[0].kind, 'move');
assert.equal(t[0].price, roundTo(2200 - 0.5 * 0.029 * 2236, 0));

// Just broke 2,200 in the last few hours: that plan is triggered (wait for the retest).
q = buildPlan({ ...today, spot: 2195, closes: [2212, 2206, 2203, 2196] }, cfg);
assert.equal(q.down, 2200);
assert.equal(q.plans.find(x => x.key === 'breakDown').triggered, true);
// Same price but it has been under 2,200 for hours: the next level down is the trigger.
q = buildPlan({ ...today, spot: 2195, closes: [2190, 2192, 2194, 2196] }, cfg);
assert.equal(q.down, 2170);
assert.equal(q.plans.find(x => x.key === 'breakDown').triggered, false);
// Just reclaimed 2,250: the long plan is triggered.
q = buildPlan({ ...today, spot: 2262, closes: [2241, 2246, 2255, 2261] }, cfg);
assert.equal(q.up, 2250);
assert.equal(q.plans.find(x => x.key === 'breakUp').triggered, true);

// A level crossed on the wrong side of the flip is not a reclaim (BTC, 30 Oct 2026).
const btc = { ...today, asset: 'BTC', spot: 77032, flip: 77358, move: 0.021, levels: [], longs: null, shorts: null, strikes: [], closes: [76887, 76662, 76904, 77050] };
q = buildPlan(btc, cfg);
assert.equal(q.up, 77500);
assert.equal(q.plans.find(x => x.key === 'breakUp').triggered, false);

// BTC-sized prices round to 50.
assert.equal(roundTo(76913, 0), 76900);
assert.equal(roundTo(76913, 1), 76950);

console.log('plan: all checks passed');
