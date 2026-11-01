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
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTac } from '../tools/tactics/collect.js';
import { sixOfSix } from '../tools/tactics/model.js';
import { TAC_CONFIG as cfg } from '../tools/tactics/config.js';

const MONTHS = +(process.argv[2] || 24);
const CACHE = process.argv[3] || '.bt-cache';
mkdirSync(CACHE, { recursive: true });
const ASSET = 'ETH', DAY = 864e5, M15 = 15 * 6e4;
const TARDIS = 'https://datasets.tardis.dev/v1/deribit';
const DERIBIT = 'https://history.deribit.com/api/v2/public';
const MONTH = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const ymd = d => new Date(d).toISOString().slice(0, 10).replace(/-/g, '/');
const px = x => Math.round(x).toLocaleString('en-US');

function cached(name, make) {
  const f = join(CACHE, name);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  return Promise.resolve(make()).then(v => { writeFileSync(f, JSON.stringify(v)); return v; });
}
async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) { /* retry */ }
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error('failed: ' + url);
}

// Every ETH option at the start of the day: the last row per instrument in the
// file's first ~200 MB (about the first 20 minutes).
function chainAt(D) {
  return cached('chain-' + ymd(D).replace(/\//g, '') + '.json', () => {
    const raw = execSync(`curl -s -r 0-209715199 "${TARDIS}/options_chain/${ymd(D)}/OPTIONS.csv.gz" | (gunzip 2>/dev/null || true) | grep '^deribit,ETH-' || true`,
      { maxBuffer: 2e9 }).toString();
    const last = {};
    for (const line of raw.split('\n')) {
      const f = line.split(',');
      if (f.length < 17) continue;
      last[f[1]] = { strike: +f[5], type: f[4] === 'call' ? 'C' : 'P', expiry: +f[6] / 1000, oi: +f[7], iv: +f[16] / 100 };
    }
    return Object.values(last).filter(o => o.oi > 0 && o.iv > 0 && o.strike > 0);
  });
}

function perpTradesOn(D) {
  return cached('perp-' + ymd(D).replace(/\//g, '') + '.json', () => {
    const raw = execSync(`curl -s "${TARDIS}/trades/${ymd(D)}/ETH-PERPETUAL.csv.gz" | gunzip`, { maxBuffer: 2e9 }).toString();
    return raw.split('\n').slice(1).filter(Boolean).map(l => {
      const f = l.split(',');
      return { t: Math.floor(+f[2] / 1000), price: +f[6], usd: +f[7], dir: f[5] === 'buy' ? 1 : -1 };
    });
  });
}

// Same mapping as tools/tactics/sources.js optionTrades(), from the history API.
function optionTradesOn(D) {
  return cached('opt-' + ymd(D).replace(/\//g, '') + '.json', async () => {
    const out = [];
    let end = D + DAY;
    for (let p = 0; p < 300; p++) {
      const j = await getJson(`${DERIBIT}/get_last_trades_by_currency_and_time?currency=${ASSET}&kind=option&start_timestamp=${D}&end_timestamp=${end}&count=1000&sorting=desc`);
      const tr = j.result.trades;
      out.push(...tr);
      if (!j.result.has_more || !tr.length) break;
      end = tr[tr.length - 1].timestamp - 1;
    }
    return out.reverse().map(t => {
      const p = t.instrument_name.split('-'), e = p[1].match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
      return { t: t.timestamp, type: p[3], strike: +p[2], expiry: e ? Date.UTC(2000 + +e[3], MONTH[e[2]], +e[1], 8) : null,
        dir: t.direction === 'buy' ? 1 : -1, usd: t.price * t.amount * t.index_price };
    }).filter(t => t.type === 'C' || t.type === 'P');
  });
}

// 1-minute candles (USD volume) from the day's start to 2 days later.
function minutesFrom(D) {
  return cached('min-' + ymd(D).replace(/\//g, '') + '.json', async () => {
    const out = [];
    for (let a = D; a < D + 2 * DAY; a += DAY / 4) {
      const j = await getJson(`https://www.deribit.com/api/v2/public/get_tradingview_chart_data?instrument_name=${ASSET}-PERPETUAL&start_timestamp=${a}&end_timestamp=${a + DAY / 4 - 1}&resolution=1`);
      const r = j.result;
      r.ticks.forEach((t, i) => out.push({ t, o: r.open[i], h: r.high[i], l: r.low[i], c: r.close[i], usd: r.cost[i] }));
    }
    return out;
  });
}

// What happened after a signal: first target or stop first, within 24 hours.
function outcome(s, side, T, minutes) {
  const tg = s.targets[0], risk = Math.abs(s.stop - s.entry), short = side === 'sell';
  let best = 0, worst = 0;
  const after = minutes.filter(m => m.t >= T && m.t < T + DAY);
  for (const m of after) {
    const fav = short ? s.entry - m.l : m.h - s.entry, adv = short ? m.h - s.entry : s.entry - m.l;
    best = Math.max(best, fav); worst = Math.max(worst, adv);
    const hitStop = short ? m.h >= s.stop : m.l <= s.stop;
    const hitTg = tg && (short ? m.l <= tg.price : m.h >= tg.price);
    if (hitStop) return { result: 'stop', R: -1, mins: (m.t - T) / 6e4, best: best / risk };
    if (hitTg) return { result: 'target', R: tg.r, mins: (m.t - T) / 6e4, best: best / risk };
  }
  const last = after[after.length - 1];
  const R = last ? (short ? s.entry - last.c : last.c - s.entry) / risk : 0;
  return { result: 'neither in 24h', R: R, mins: null, best: best / risk, worst: worst / risk };
}

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
    if (t.fire) signals.push({ day: ymd(D), T, side: dec.action, spot, s: d.setup, out: outcome(d.setup, dec.action, T, minutes) });
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
