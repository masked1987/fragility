// Run: node test/tactics-compare.mjs [months=36] [cacheDir] [concurrency=3]
// Compares two ways of picking the Tactics pivots on the same past data:
//   net   = |calls − puts| (the video's GEX map; a strike with lots of both cancels out)
//   total = calls + puts   (how much sits at a strike either way; the owner's key levels)
// Everything else is the tab's own code (buildTac, both sides, the six rules).
// Days: the 1st of each month (the free Tardis sample days, see tactics-backtest.mjs).
// Checks every 15 minutes at :07/:22/:37/:52 from 04:00 UTC, like the alert job.
//
// Three levels, each traded with the tab's own entry, stop and first target
// (outcome(): target or stop first within 24 h, else the move at 24 h in R):
//   1. retest   - price is back at a pivot (rule 1). Tests which method picks
//                 strikes that price actually turns at. Many examples.
//   2. trigger  - retest + order flow (buyers/sellers ran out or stepped in).
//   3. 6/6      - all six rules, i.e. when the phone would ring (sixOfSix).
// Levels 1 and 2 take at most one trade per pivot and side per hour.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setCache, chainAt, perpTradesOn, optionTradesOn, minutesFrom, outcome, ASSET, DAY, M15, ymd, px } from './bt-data.mjs';
import { buildTac } from '../tools/tactics/collect.js';
import { sixOfSix } from '../tools/tactics/model.js';
import { TAC_CONFIG } from '../tools/tactics/config.js';

const MONTHS = +(process.argv[2] || 36);
const CACHE = process.argv[3] || '.bt-cache';
const CONC = +(process.argv[4] || 3);
setCache(CACHE);
const METHODS = ['net', 'total'];
const now = new Date();
const days = [];
for (let k = MONTHS; k >= 1; k--) days.push(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));

// 1. Download everything first, a few days at a time (cached; reruns are fast).
async function load(D) {
  return Promise.all([chainAt(D), perpTradesOn(D), optionTradesOn(D), minutesFrom(D)]);
}
const failed = {};
let next = 0, done = 0;
async function worker() {
  while (next < days.length) {
    const D = days[next++];
    try { await load(D); } catch (e) { failed[D] = e.message; }
    done++;
    console.log(`downloaded ${done}/${days.length}  ${ymd(D)}${failed[D] ? '  FAILED: ' + failed[D] : ''}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

// 2. Run both methods over the same checks.
const res = {};
METHODS.forEach(m => { res[m] = { retest: [], trigger: [], six: [], met: {}, sideChecks: { sell: 0, buy: 0 }, noTarget: 0 }; });
let checks = 0, differ = 0, skipped = [];
for (const D of days) {
  if (failed[D]) { skipped.push(ymd(D) + ': ' + failed[D]); continue; }
  const [chain, perp, optTr, minutes] = await load(D);
  if (chain.length < 100 || !perp.length || !minutes.length) { skipped.push(`${ymd(D)}: thin data`); continue; }
  const state = {};
  METHODS.forEach(m => { state[m] = { prev: null, last: {} }; });
  for (let T = D + 4 * 36e5 + 7 * 6e4; T < D + DAY; T += M15) {
    const lastMin = minutes.filter(x => x.t + 6e4 <= T).pop();
    if (!lastMin) continue;
    checks++;
    const fpFrom = Math.floor((T - TAC_CONFIG.footprintHours * 36e5) / M15) * M15;
    const data = {
      chain: { spot: lastMin.c, options: chain },
      minutes: minutes.filter(x => x.t < T),
      optTr: optTr.filter(t => t.t >= D && t.t <= T),
      perp: perp.filter(t => t.t >= fpFrom && t.t <= T),
    };
    const piv = {};
    for (const m of METHODS) {
      const cfg = { ...TAC_CONFIG, pivotSize: m };
      const d = buildTac(ASSET, T, data, cfg);
      const r = res[m], st = state[m], dec = d.decision;
      piv[m] = [d.pivots.above && d.pivots.above.strike, d.pivots.below && d.pivots.below.strike].join('/');
      r.met[dec.met] = (r.met[dec.met] || 0) + 1;
      for (const k of ['sell', 'buy']) {
        const sd = dec.sides[k];
        if (!sd) continue;
        r.sideChecks[k]++;
        const s = sd.setup;
        if (!s.atLevel) continue;
        if (!s.targets.length) { r.noTarget++; continue; }
        const key = k + s.pivot, flow = s.checks.find(c => c.key === 'flow');
        const trade = (level) => {
          const lk = level + key;
          if (st.last[lk] && T - st.last[lk] < 36e5) return;
          st.last[lk] = T;
          r[level].push({ day: ymd(D), T, side: k, pivot: s.pivot, out: outcome(s, k, T, minutes) });
        };
        trade('retest');
        if (flow && (flow.exhausted || flow.stepping)) trade('trigger');
      }
      const t = sixOfSix(dec, st.prev);
      st.prev = t.state;
      if (t.fire) r.six.push({ day: ymd(D), T, side: dec.action, pivot: dec.setup.pivot, s: dec.setup, out: outcome(dec.setup, dec.action, T, minutes) });
    }
    if (piv.net !== piv.total) differ++;
  }
  console.log(`${ymd(D)}  ` + METHODS.map(m => `${m}: retests ${res[m].retest.filter(x => x.day === ymd(D)).length}, triggers ${res[m].trigger.filter(x => x.day === ymd(D)).length}, 6/6 ${res[m].six.filter(x => x.day === ymd(D)).length}`).join('  |  '));
}

// 3. Report.
function stats(list) {
  const n = list.length, R = list.reduce((a, x) => a + x.out.R, 0);
  const tg = list.filter(x => x.out.result === 'target').length, sp = list.filter(x => x.out.result === 'stop').length;
  return { n, target: tg, stop: sp, open: n - tg - sp, win: n ? tg / n : 0, avgR: n ? R / n : 0, totalR: R };
}
const fmt = s => s.n ? `${String(s.n).padStart(4)} trades  target first ${String(s.target).padStart(3)} (${(s.win * 100).toFixed(0).padStart(2)}%)  stop ${String(s.stop).padStart(3)}  other ${String(s.open).padStart(2)}  avg ${s.avgR >= 0 ? '+' : ''}${s.avgR.toFixed(2)}R  total ${s.totalR >= 0 ? '+' : ''}${s.totalR.toFixed(1)}R` : '   0 trades';
const used = days.length - skipped.length;
console.log(`\n${used} days, ${checks} checks; pivots differed between the methods on ${differ} checks (${(differ / checks * 100).toFixed(0)}%)`);
if (skipped.length) console.log('skipped: ' + skipped.join(' | '));
const out = {};
for (const lvl of [['retest', '1. Retest of a pivot'], ['trigger', '2. Retest + order-flow trigger'], ['six', '3. Full 6/6 (phone alert)']]) {
  console.log(`\n${lvl[1]}`);
  for (const m of METHODS) {
    const all = stats(res[m][lvl[0]]);
    out[m + '.' + lvl[0]] = all;
    console.log(`  ${m.padEnd(5)} ${fmt(all)}`);
    for (const k of ['sell', 'buy']) console.log(`     ${k.padEnd(4)} ${fmt(stats(res[m][lvl[0]].filter(x => x.side === k)))}`);
  }
}
console.log('\nRules met per check (highest side):');
for (const m of METHODS) console.log(`  ${m.padEnd(5)} ` + Object.keys(res[m].met).sort().map(k => `${k}/6: ${res[m].met[k]}`).join('  ') + `   | checks with a SELL pivot ${res[m].sideChecks.sell}, a BUY pivot ${res[m].sideChecks.buy}`);
for (const m of METHODS) {
  if (!res[m].six.length) continue;
  console.log(`\n6/6 signals, ${m}:`);
  for (const g of res[m].six) {
    const tg = g.s.targets[0];
    console.log(`  ${g.day} ${new Date(g.T).toISOString().slice(11, 16)} UTC  ${g.side.toUpperCase()} at ${px(g.s.entry)} (pivot ${px(g.pivot)}), stop ${px(g.s.stop)}, target ${tg ? px(tg.price) + ' (' + tg.r.toFixed(1) + 'R)' : 'none'}  ->  ${g.out.result}, ${g.out.R >= 0 ? '+' : ''}${g.out.R.toFixed(2)}R`);
  }
}
writeFileSync(join(CACHE, 'compare.json'), JSON.stringify({ days: days.map(ymd), skipped, checks, differ, out,
  trades: Object.fromEntries(METHODS.map(m => [m, { retest: res[m].retest, trigger: res[m].trigger, six: res[m].six.map(g => ({ ...g, s: undefined })) }])) }, null, 1));
