// Run: node test/tactics-backtest.mjs [months=24] [cacheDir]
// Backtest of the Tactics 6/6 decision on past data, with the tab's own code
// (buildTac → setup → decide, sixOfSix for when the phone would ring).
//
// Past option open interest per strike (needed for the pivot and the gamma flip)
// is only free for the 1st of each month (Tardis free sample days), so those are
// the days tested. Per day:
//   option chain: the Tardis options_chain file's first ~200 MB (00:00–00:20 UTC
//     snapshot of every ETH option: strike, expiry, open interest, mark IV), held
//     for the day; options drop out as they expire.
//   perpetual trades: the Tardis trades file (footprint / order flow).
//   option trades: Deribit history API (premium drift).
//   1-minute candles: Deribit chart data (value area, and what happened after).
// Checks run every 15 minutes at :07 / :22 / :37 / :52 like the alert job, from
// 04:00 UTC (before that the tab uses yesterday's session, not in the files).
// After each 6/6: did price reach the first target or the stop first (24 h max)?
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setCache, chainAt, perpTradesOn, optionTradesOn, minutesFrom, outcome, DAY, M15, ymd, px } from './bt-data.mjs';
import { buildTac } from '../tools/tactics/collect.js';
import { sixOfSix } from '../tools/tactics/model.js';
import { TAC_CONFIG as cfg } from '../tools/tactics/config.js';

const MONTHS = +(process.argv[2] || 24);
const CACHE = process.argv[3] || '.bt-cache';
setCache(CACHE);
const ASSET = 'ETH';

const now = new Date();
const days = [];
for (let k = MONTHS; k >= 1; k--) days.push(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));

const signals = [], metCount = {}, near = [], skipped = [];
let checks = 0;
for (const D of days) {
  let chain, perp, optTr, minutes;
  try {
    [chain, perp, optTr, minutes] = [await chainAt(D), await perpTradesOn(D), await optionTradesOn(D), await minutesFrom(D)];
  } catch (e) { skipped.push(ymd(D) + ': ' + e.message); continue; }
  if (chain.length < 100 || !perp.length || !minutes.length) { skipped.push(`${ymd(D)}: thin data (options ${chain.length}, perp ${perp.length}, minutes ${minutes.length})`); continue; }
  let prev = null, dayMet = [];
  for (let T = D + 4 * 36e5 + 7 * 6e4; T < D + DAY; T += M15) {
    const lastMin = minutes.filter(m => m.t + 6e4 <= T).pop();
    if (!lastMin) continue;
    const spot = lastMin.c;
    const fpFrom = Math.floor((T - cfg.footprintHours * 36e5) / M15) * M15;
    const d = buildTac(ASSET, T, {
      chain: { spot, options: chain },
      minutes: minutes.filter(m => m.t < T),
      optTr: optTr.filter(t => t.t >= D && t.t <= T),
      perp: perp.filter(t => t.t >= fpFrom && t.t <= T),
    }, cfg);
    checks++;
    const dec = d.decision;
    metCount[dec.met] = (metCount[dec.met] || 0) + 1;
    dayMet.push(dec.met);
    if (dec.met === 5) near.push({ day: ymd(D), T, side: dec.side, missing: dec.rules.filter(r => !r.ok).map(r => r.key)[0] });
    const t = sixOfSix(dec, prev);
    prev = t.state;
    if (t.fire) signals.push({ day: ymd(D), T, side: dec.action, spot, s: dec.setup || d.setup, out: outcome(dec.setup || d.setup, dec.action, T, minutes) });
  }
  console.log(`${ymd(D)}  options ${chain.length}  perp trades ${perp.length}  option trades ${optTr.length}  best ${Math.max(...dayMet)}/6  signals ${signals.filter(s => s.day === ymd(D)).length}`);
}

console.log(`\n${days.length - skipped.length} days, ${checks} checks (every 15 min, 04:00–24:00 UTC)`);
if (skipped.length) console.log('skipped:', skipped.join(' | '));
console.log('rules met per check:', Object.keys(metCount).sort().map(k => `${k}/6: ${metCount[k]}`).join('  '));
const missing = {};
near.forEach(n => { missing[n.missing] = (missing[n.missing] || 0) + 1; });
console.log('5/6 checks, the one rule missing:', JSON.stringify(missing));
console.log(`\n6/6 signals: ${signals.length}`);
for (const g of signals) {
  const tg = g.s.targets[0];
  console.log(`  ${g.day} ${new Date(g.T).toISOString().slice(11, 16)} UTC  ${g.side.toUpperCase()} at ${px(g.s.entry)}, stop ${px(g.s.stop)}, target ${tg ? px(tg.price) + ' (' + tg.r.toFixed(1) + 'R)' : 'none'}` +
    `  ->  ${g.out.result}${g.out.mins != null ? ' after ' + Math.round(g.out.mins) + ' min' : ''}, ${g.out.R >= 0 ? '+' : ''}${g.out.R.toFixed(2)}R (best ${g.out.best.toFixed(1)}R)`);
}
if (signals.length) {
  const tot = signals.reduce((a, g) => a + g.out.R, 0);
  console.log(`  total ${tot >= 0 ? '+' : ''}${tot.toFixed(2)}R, average ${(tot / signals.length).toFixed(2)}R per signal; targets ${signals.filter(g => g.out.result === 'target').length}, stops ${signals.filter(g => g.out.result === 'stop').length}`);
}
writeFileSync(join(CACHE, 'results.json'), JSON.stringify({ days: days.map(ymd), skipped, checks, metCount, near, signals: signals.map(g => ({ ...g, s: { entry: g.s.entry, stop: g.s.stop, targets: g.s.targets, pivot: g.s.pivot } })) }, null, 1));
