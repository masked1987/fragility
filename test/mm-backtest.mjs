// Run: node test/mm-backtest.mjs [months=36] [cacheDir=.bt-cache]
// Backtest of entries built from the Market Maker tab (asked 2 Nov 2026: "choose the
// best entry for market maker model and do the backtest ... comparing to my strategy").
// The tab's own reading, every hour: DVOL (Deribit) vs 7-day realized vol from hourly
// prices (realizedVol() in tools/market-maker/model.js), gap = 7-day average implied
// − realized, dealers winning / balanced / losing with dealerSide() (±5 points, 1-point
// buffer). Sizes are in the day's implied move (DVOL / √365), like the Playbook.
// Entry families (one trade at a time each, hourly closes, ETH-PERPETUAL):
//   fade   dealers winning (calm, range): price stretched k day-moves from its 24h
//          high (buy) / low (sell) -> trade back toward the middle.
//   trend  dealers losing (moves keep going): close through the 24h high (buy) /
//          low (sell) -> go with it.
//   flip   dealers just turned losing -> go the way of the last 24h.
//   fear   implied vol up ≥5 points in 24h and price down ≥ k day-moves -> buy.
// Stop s day-moves, target t day-moves, 3 days max then out at the close. Exits on
// Deribit 5-minute highs / lows (a candle touching both = stopped). Costs 0.1% round
// trip, in R. The best version is picked on the first 2 years, checked on the last year.
import { setCache, cached, getJson, DAY } from './bt-data.mjs';
import { realizedVol, dailyMove } from '../tools/market-maker/model.js';
import { dealerSide } from '../tools/market-maker/read.js';
import { MM_CONFIG } from '../tools/market-maker/config.js';

const MONTHS = +(process.argv[2] || 36);
setCache(process.argv[3] || '.bt-cache');
const FEE = 0.001, M5 = 5 * 6e4, H = 36e5, MAXHOLD = 3 * DAY;
const now = Date.now();
const d0 = new Date(now);
const FROM = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - MONTHS, 1);
const START = FROM - 10 * DAY; // warm-up: 7-day realized + 24h windows
const SPLIT = Date.UTC(2025, 10, 1);

async function pool(items, n, fn) {
  const out = []; let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out.flat();
}
function chunks(step) { const c = []; for (let a = START; a < now; a += step) c.push(a); return c; }

// Same cache names as test/alt-backtest.mjs, so the 5-minute candles are shared.
const c5raw = await pool(chunks(10 * DAY), 4, a => Promise.resolve(cached('c5-' + a + '.json', async () => {
  const b = Math.min(a + 10 * DAY, now);
  const j = await getJson(`https://www.deribit.com/api/v2/public/get_tradingview_chart_data?instrument_name=ETH-PERPETUAL&start_timestamp=${a}&end_timestamp=${b - 1}&resolution=5`);
  const r = j.result;
  return r.ticks.map((t, i) => ({ t, h: r.high[i], l: r.low[i], c: r.close[i] }));
})).catch(() => []));
const seen = new Set();
const c5 = c5raw.filter(c => c.t + M5 <= now).sort((x, y) => x.t - y.t).filter(c => !seen.has(c.t) && seen.add(c.t));

const dvRaw = await pool(chunks(40 * DAY), 3, a => Promise.resolve(cached('dvol-' + a + '.json', async () => {
  const b = Math.min(a + 40 * DAY, now);
  const j = await getJson(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=ETH&start_timestamp=${a}&end_timestamp=${b - 1}&resolution=3600`);
  return j.result.data.map(r => ({ t: r[0], iv: r[4] }));
})).catch(() => []));
const ivAt = new Map(dvRaw.map(p => [p.t, p.iv]));
console.error(`5-min candles ${c5.length}, DVOL hours ${ivAt.size}`);

// Hourly closes from the 5-minute candles (close of the last candle in the hour).
const hours = [];
for (const c of c5) {
  const h = Math.floor(c.t / H) * H;
  const last = hours[hours.length - 1];
  if (!last || last.t !== h) hours.push({ t: h, close: c.c, high: c.h, low: c.l });
  else { last.close = c.c; last.high = Math.max(last.high, c.h); last.low = Math.min(last.low, c.l); }
}
// The tab's reading for every hour (t = the hour's close time).
const rvH = MM_CONFIG.rvDays * 24;
let side = 'even';
const read = hours.map((p, i) => {
  const iv = ivAt.get(p.t);
  if (iv == null || i < rvH + 24) return null;
  const rv = realizedVol(hours, i, rvH);
  let ivs = 0, n = 0;
  for (let j = i - rvH + 1; j <= i; j++) { const v = ivAt.get(hours[j].t); if (v != null) { ivs += v; n++; } }
  const gap = ivs / n - rv;
  const prev = side; side = dealerSide(gap, side, MM_CONFIG);
  let hi = -Infinity, lo = Infinity;
  for (let j = i - 24; j < i; j++) { hi = Math.max(hi, hours[j].high); lo = Math.min(lo, hours[j].low); }
  const iv24 = ivAt.get(hours[i - 24].t);
  return { t: p.t + H, price: p.close, iv, m: dailyMove(iv) / 100, gap, side, prev, hi, lo,
    ret24: p.close / hours[i - 24].close - 1, dIv: iv24 == null ? 0 : iv - iv24 };
}).filter(r => r && r.t >= FROM);

function c5idx(t) { let lo = 0, hi = c5.length; while (lo < hi) { const m = (lo + hi) >> 1; if (c5[m].t < t) lo = m + 1; else hi = m; } return lo; }

function follow(buy, entry, stop, target, t) {
  for (let k = c5idx(t); k < c5.length; k++) {
    const c = c5[k];
    if (buy ? c.l <= stop : c.h >= stop) return { result: 'stopped', exit: stop, at: c.t + M5 };
    if (buy ? c.h >= target : c.l <= target) return { result: 'target', exit: target, at: c.t + M5 };
    if (c.t + M5 >= t + MAXHOLD) return { result: 'time', exit: c.c, at: c.t + M5 };
  }
  const c = c5[c5.length - 1];
  return { result: 'open', exit: c.c, at: c.t + M5 };
}

// When a family wants in: 1 = buy, -1 = sell, 0 = nothing.
const ENTRY = {
  fade: (r, v) => r.side === 'win' ?
    (r.price <= r.hi * (1 - v.k * r.m) ? 1 : r.price >= r.lo * (1 + v.k * r.m) ? -1 : 0) : 0,
  fadeAny: (r, v) => r.side !== 'lose' ?
    (r.price <= r.hi * (1 - v.k * r.m) ? 1 : r.price >= r.lo * (1 + v.k * r.m) ? -1 : 0) : 0,
  trend: (r) => r.side === 'lose' ? (r.price > r.hi ? 1 : r.price < r.lo ? -1 : 0) : 0,
  flip: (r) => r.side === 'lose' && r.prev !== 'lose' ? (r.ret24 >= 0 ? 1 : -1) : 0,
  fear: (r, v) => r.dIv >= MM_CONFIG.ivMovePts && r.ret24 <= -v.k * r.m ? 1 : 0,
};

function run(fam, v) {
  const out = []; let busy = 0;
  for (const r of read) {
    if (r.t < busy) continue;
    let dir = ENTRY[fam](r, v);
    if (v.only === 'buy' && dir < 0) dir = 0;
    if (!dir) continue;
    const buy = dir > 0, risk = v.s * r.m * r.price;
    const stop = buy ? r.price - risk : r.price + risk, target = buy ? r.price + v.t * r.m * r.price : r.price - v.t * r.m * r.price;
    const f = follow(buy, r.price, stop, target, r.t);
    const R = (buy ? f.exit - r.price : r.price - f.exit) / risk - FEE * r.price / risk;
    out.push({ T: r.t, buy, entry: r.price, stop, target, result: f.result, net: R });
    busy = f.at;
  }
  return out;
}

const avg = L => L.length ? L.reduce((a, t) => a + t.net, 0) / L.length : NaN;
const f2 = x => isNaN(x) ? '   -  ' : (x >= 0 ? '+' : '') + x.toFixed(2);
function worstRun(L) { let r = 0, w = 0; L.forEach(t => { r = t.net < 0 ? r + 1 : 0; w = Math.max(w, r); }); return w; }
function line(name, L) {
  const a = L.filter(t => t.T < SPLIT), b = L.filter(t => t.T >= SPLIT);
  const hit = L.filter(t => t.result === 'target').length;
  const top2 = L.slice().sort((x, y) => y.net - x.net).slice(2);
  return `${name.padEnd(30)} ${String(L.length).padStart(4)} ${String(L.length ? Math.round(hit / L.length * 100) : 0).padStart(3)}% ${f2(avg(L)).padStart(6)}R ` +
    `${f2(L.reduce((s, t) => s + t.net, 0)).padStart(7)}R run ${String(worstRun(L)).padStart(2)} | first 2y ${f2(avg(a)).padStart(6)}R (${String(a.length).padStart(3)}) | ` +
    `last year ${f2(avg(b)).padStart(6)}R (${String(b.length).padStart(3)}) | without best 2 ${f2(avg(top2)).padStart(6)}R`;
}
function years(L) {
  const y = {}; L.forEach(t => (y[new Date(t.T).getUTCFullYear()] ||= []).push(t));
  return Object.keys(y).sort().map(k => `${k}: ${y[k].length} ${f2(avg(y[k]))}R`).join('  ');
}

const share = {}; read.forEach(r => { share[r.side] = (share[r.side] || 0) + 1; });
console.log(`Market Maker entries backtest, ETH ${new Date(FROM).toISOString().slice(0, 10)} to ${new Date(read[read.length - 1].t).toISOString().slice(0, 10)}, ` +
  `hourly reading, Deribit 5-min exits, 0.1% costs, 3 days max hold`);
console.log(`Hours: dealers winning ${Math.round(share.win / read.length * 100)}%, balanced ${Math.round(share.even / read.length * 100)}%, losing ${Math.round(share.lose / read.length * 100)}%` +
  `; typical day's implied move ±${(read.reduce((a, r) => a + r.m, 0) / read.length * 100).toFixed(1)}%`);
console.log('\nversion                        trades hit  per-trade total  worst | first 2 years          | last year (unseen)    |');

const grid = [];
const K = [0.5, 1, 1.5], S = [0.5, 1], T = [0.5, 1, 2];
for (const fam of ['fade', 'fadeAny', 'trend', 'flip', 'fear']) {
  const ks = fam === 'trend' || fam === 'flip' ? [0] : K;
  for (const only of ['both', 'buy']) {
    if (fam === 'fear' && only === 'both') continue;
    for (const k of ks) for (const s of S) for (const t of T) {
      const v = { k, s, t, only }, L = run(fam, v);
      grid.push({ fam, v, L, name: `${fam}${k ? ' k' + k : ''} stop ${s} tgt ${t}${only === 'buy' ? ' buys' : ''}` });
    }
  }
}
// Best per family, chosen on the first 2 years only (at least 20 trades there; the
// "flip" event happens ~13 times a year, about as often as Alt Tactics trades).
const fams = [...new Set(grid.map(g => g.fam + (g.v.only === 'buy' ? ' buys' : '')))];
const best = fams.map(fk => grid.filter(g => g.fam + (g.v.only === 'buy' ? ' buys' : '') === fk)
  .map(g => ({ ...g, first: avg(g.L.filter(t => t.T < SPLIT)), nFirst: g.L.filter(t => t.T < SPLIT).length }))
  .filter(g => g.nFirst >= 20).sort((a, b) => b.first - a.first)[0]).filter(Boolean);
console.log('Best of each family (picked on the first 2 years):');
best.forEach(g => console.log(line(g.name, g.L)));
const top = best.slice().sort((a, b) => b.first - a.first)[0];
console.log(`\nPick: ${top.name}\n  by year  ${years(top.L)}`);
const bb = top.L.filter(t => t.buy), ss = top.L.filter(t => !t.buy);
if (ss.length) { console.log(line('  buys only', bb)); console.log(line('  sells only', ss)); }
console.log('  results: ' + ['target', 'stopped', 'time', 'open'].map(k => k + ' ' + top.L.filter(t => t.result === k).length).join(', '));

console.log('\nTrades of the pick:');
top.L.forEach(t => console.log(`  ${new Date(t.T).toISOString().slice(0, 16)} ${t.buy ? 'BUY ' : 'SELL'} ${t.entry.toFixed(0).padStart(5)} stop ${t.stop.toFixed(0).padStart(5)} target ${t.target.toFixed(0).padStart(5)}  ${t.result.padEnd(7)} ${f2(t.net)}R`));

if (process.env.ALL) { console.log('\nEvery version:'); grid.forEach(g => console.log(line(g.name, g.L))); }
