// Strategies from outside sources (not the owner's own), tested on ETH (asked 2 Nov 2026:
// "Test 1 2 and 3" after a web search of GitHub / papers / quant blogs):
//   1. Trend following (time-series momentum; e.g. Zarattini, Pagani & Barbon 2025,
//      "Catching Crypto Trends"): daily closes, several common versions.
//   2. Funding-rate carry (delta-neutral basis): hold ETH, short the same amount of the
//      perpetual, collect funding.
//   3. Selling options (volatility risk premium): sell an at-the-money straddle and hold
//      to expiry. No free history of option prices, so each straddle is priced with
//      Black–Scholes at Deribit's DVOL (30-day implied vol) minus 1 point for the spread.
//
//   node test/outside-strategies.mjs [cache=.bt-cache]
//
// Data (all free, every day): Deribit ETH-PERPETUAL hourly candles, Deribit perpetual
// funding (interest_1h per hour), Deribit ETH DVOL hourly. Test period: the 36 months
// Nov 2023 – Oct 2026 (trend look-backs use the year before). Daily close = 00:00 UTC.
// Results in % of ETH price on a full position (1 ETH), compounded per strategy;
// costs 0.05% per side on ETH / the perpetual; option fees as Deribit's
// (0.03% of the underlying per option traded + 0.015% at settlement).
import { mkdirSync } from 'node:fs';
import { cached, getJson, setCache } from './bt-data.mjs';

const CACHE = process.argv[2] || '.bt-cache';
setCache(CACHE); mkdirSync(CACHE, { recursive: true });
const H = 36e5, DAY = 864e5, SIDE = 0.0005;
const T0 = Date.UTC(2023, 10, 1), T1 = Date.UTC(2026, 10, 1);
const API = 'https://www.deribit.com/api/v2/public/';

async function hourly() {
  const out = [];
  for (let a = Date.UTC(2022, 9, 1); a < Date.now(); a += 4000 * H) {
    const b = Math.min(a + 4000 * H, Date.now());
    const part = await Promise.resolve(cached('os-h-' + a + '.json', async () => {
      const r = (await getJson(`${API}get_tradingview_chart_data?instrument_name=ETH-PERPETUAL&start_timestamp=${a}&end_timestamp=${b - 1}&resolution=60`)).result;
      return r.ticks.map((t, i) => ({ t, o: r.open[i], h: r.high[i], l: r.low[i], c: r.close[i] }));
    }));
    out.push(...part.filter(x => x.t >= a && x.t < b && x.t + H <= Date.now()));
  }
  return out;
}
async function funding() {
  const by = {};
  for (let a = Date.UTC(2023, 9, 1); a < Date.now(); a += 25 * DAY) {
    const b = Math.min(a + 25 * DAY, Date.now());
    const part = await Promise.resolve(cached('os-f-' + a + '.json', async () =>
      (await getJson(`${API}get_funding_rate_history?instrument_name=ETH-PERPETUAL&start_timestamp=${a}&end_timestamp=${b}`)).result));
    part.forEach(x => { by[x.timestamp] = x.interest_1h; });
  }
  return by;   // hour end → funding paid by longs that hour (fraction of notional)
}
async function dvol() {
  const by = {};
  for (let a = Date.UTC(2023, 9, 1); a < Date.now(); a += 900 * H) {
    const b = Math.min(a + 900 * H, Date.now());
    const part = await Promise.resolve(cached('os-v-' + a + '.json', async () =>
      (await getJson(`${API}get_volatility_index_data?currency=ETH&start_timestamp=${a}&end_timestamp=${b}&resolution=3600`)).result.data));
    part.forEach(x => { by[x[0]] = x[4]; });
  }
  return by;   // hour start → DVOL close (annual %)
}

const [hr, fund, dv] = await Promise.all([hourly(), funding(), dvol()]);
const priceAt = {}; hr.forEach(x => { priceAt[x.t] = x.o; });           // price at the start of each hour
const daily = [];                                                         // 00:00 UTC closes
hr.forEach(x => { if ((x.t + H) % DAY === 0) daily.push({ t: x.t + H, c: x.c }); });
const fundDay = t => { let s = 0; for (let h = t - DAY + H; h <= t; h += H) s += fund[h] || 0; return s; };  // funding for the day ending at t

// Results bookkeeping: one return per period (fraction), with its time.
function summary(name, rets) {
  const R = rets.filter(r => r.t >= T0 && r.t < T1 + DAY);
  let eq = 1, peak = 1, dd = 0; const months = {}, years = {};
  R.forEach(r => {
    eq *= 1 + r.x; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
    const d = new Date(r.t - 1), m = d.toISOString().slice(0, 7), y = m.slice(0, 4);
    months[m] = (months[m] || 1) * (1 + r.x); years[y] = (years[y] || 1) * (1 + r.x);
  });
  const mv = Object.values(months).map(v => v - 1);
  return { name, total: (eq - 1) * 100, dd: dd * 100, years, months, up: mv.filter(v => v > 0).length, down: mv.filter(v => v < 0).length,
    trades: rets.trades || null, worst: R.length ? Math.min(...R.map(r => r.x)) * 100 : 0 };
}

// ---------- 1. Trend following (daily) ----------
const C = daily.map(d => d.c);
const sma = (i, n) => { if (i < n - 1) return NaN; let s = 0; for (let k = i - n + 1; k <= i; k++) s += C[k]; return s / n; };
const hiN = (i, n) => { let m = -Infinity; for (let k = i - n; k < i; k++) m = Math.max(m, C[k]); return m; };
const loN = (i, n) => { let m = Infinity; for (let k = i - n; k < i; k++) m = Math.min(m, C[k]); return m; };
// target(i, prev) → position after the close of day i (−1..1); perp = pays / gets funding.
function runTrend(target, perp) {
  const rets = []; let pos = 0, trades = 0;
  for (let i = 1; i < daily.length; i++) {
    const r = C[i] / C[i - 1] - 1, f = perp ? fundDay(daily[i].t) : 0;
    let x = pos * r - pos * f;                     // longs pay positive funding, shorts receive it
    const np = i >= 361 ? target(i, pos) : 0;
    if (np !== pos) { x -= SIDE * Math.abs(np - pos); if (Math.sign(np) !== Math.sign(pos) && np !== 0) trades++; }
    pos = np;
    rets.push({ t: daily[i].t, x });
  }
  rets.trades = trades;
  return rets;
}
const LB = [5, 10, 20, 30, 60, 90, 150, 250, 360];
const trends = [
  ['Buy and hold ETH (for comparison)', runTrend(() => 1, false)],
  ['20-day breakout, long + short (perp)', runTrend((i, p) => C[i] > hiN(i, 20) ? 1 : C[i] < loN(i, 20) ? -1 : p, true)],
  ['20-day high in, 10-day low out, long only', runTrend((i, p) => C[i] > hiN(i, 20) ? 1 : C[i] < loN(i, 10) ? 0 : p, false)],
  ['Above 50-day average, long only', runTrend(i => C[i] > sma(i, 50) ? 1 : 0, false)],
  ['50-day average, long + short (perp)', runTrend(i => C[i] > sma(i, 50) ? 1 : -1, true)],
  ['Above 200-day average, long only', runTrend(i => C[i] > sma(i, 200) ? 1 : 0, false)],
  // neighbours of the 50-day average (is 50 a lucky pick?)
  ...[30, 40, 60, 75, 100, 150].map(n => [`Above ${n}-day average, long only`, runTrend(i => C[i] > sma(i, n) ? 1 : 0, false)]),
  ['9 look-backs blended (5–360 d), long only', runTrend(i => Math.round(LB.filter(n => C[i] > sma(i, n)).length / LB.length * 100) / 100, false)],
  ['9 look-backs blended, long + short (perp)', runTrend(i => Math.round(LB.reduce((s, n) => s + (C[i] > sma(i, n) ? 1 : -1), 0) / LB.length * 100) / 100, true)],
].map(([n, r]) => summary(n, r));

// ---------- 2. Funding carry (long ETH + short perpetual) ----------
function runCarry(onRule) {
  const rets = []; let on = false, switches = 0;
  for (let i = 1; i < daily.length; i++) {
    const t = daily[i].t;
    let x = on ? fundDay(t) : 0;                   // short perp receives what longs pay
    const want = onRule(i);
    if (want !== on) { x -= 2 * SIDE; switches++; on = want; }  // both legs, one side each
    rets.push({ t, x });
  }
  rets.trades = switches;
  return rets;
}
const fundAvg = (i, d) => { let s = 0; for (let k = 0; k < d; k++) s += fundDay(daily[i - k].t); return s / d; };
const carries = [
  ['Always on', runCarry(i => daily[i].t >= T0 - DAY && daily[i].t < T1)],
  ['On when last 24 h funding > 0', runCarry(i => daily[i].t >= T0 - DAY && daily[i].t < T1 && fundDay(daily[i].t) > 0)],
  ['On when last 7 days funding > 5% a year', runCarry(i => daily[i].t >= T0 - DAY && daily[i].t < T1 && fundAvg(i, 7) * 365 > 0.05)],
].map(([n, r]) => summary(n, r));
const fYear = (() => { let s = 0, n = 0; for (let t = T0 + DAY; t <= T1; t += DAY) { s += fundDay(t); n++; } return s / n * 365 * 100; })();

// ---------- 3. Selling at-the-money straddles ----------
const N = x => { const a = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * a), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a); return 0.5 * (1 + (x < 0 ? -y : y)); };
const straddle = (S, iv, T) => { const s = iv * Math.sqrt(T), d1 = 0.5 * s; return S * (N(d1) - N(-d1)) * 2; };  // ATM, r = 0: call + put
const rv7 = t => { const xs = []; for (let h = t - 7 * DAY + H; h <= t; h += H) if (priceAt[h] && priceAt[h - H]) xs.push(Math.log(priceAt[h] / priceAt[h - H])); const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1) * 24 * 365) * 100; };
function runStraddles(days, filter, cut = 1) {
  const rets = []; let n = 0;
  for (let t = Date.UTC(2023, 9, 27, 8); t + days * DAY <= Math.min(T1 + 8 * H, Date.now()); t += DAY) {
    if (days === 7 && new Date(t).getUTCDay() !== 5) continue;          // weeklies: Friday 08:00 → Friday 08:00
    const S = priceAt[t], ST = priceAt[t + days * DAY], v = dv[t - H] ?? dv[t];
    if (!S || !ST || !v) continue;
    if (filter && !filter(t, v)) continue;
    const prem = straddle(S, Math.max(v - cut, 5) / 100, days / 365);
    const fee = 2 * Math.min(0.0003 * S, 0.125 * prem / 2) + 2 * Math.min(0.00015 * S, 0.125 * prem / 2);
    rets.push({ t: t + days * DAY, x: (prem - Math.abs(ST - S) - fee) / S, prem: prem / S });
    n++;
  }
  rets.trades = n;
  return rets;
}
const straddles = [
  ['Weekly, every Friday (DVOL − 1)', runStraddles(7)],
  ['Weekly, only when DVOL > last 7 days realized', runStraddles(7, (t, v) => v > rv7(t))],
  ['Daily (08:00 → 08:00), every day (DVOL − 1)', runStraddles(1)],
  ['Daily, only when DVOL > last 7 days realized', runStraddles(1, (t, v) => v > rv7(t))],
];
// Robustness (asked to check after the first run looked too good): real 1-day options
// sell at the bid ~3–4 vol points under mark (spread 11–15% of the price on 2 Nov 2026),
// weeklies ~1.5 points; short-dated mark IV can also sit under DVOL. Same straddles
// priced at DVOL − 3 / − 5 / − 10 points.
for (const cut of [3, 5, 10]) {
  straddles.push([`Weekly, every Friday (DVOL − ${cut})`, runStraddles(7, null, cut)]);
  straddles.push([`Daily, every day (DVOL − ${cut})`, runStraddles(1, null, cut)]);
}
straddles.splice(0, straddles.length, ...straddles.map(([n, r]) => summary(n, r)));

// ---------- Print ----------
const f1 = x => (x >= 0 ? '+' : '') + x.toFixed(1);
const yr = (s, y) => s.years[y] ? f1((s.years[y] - 1) * 100) : '-';
function table(title, rows, extra) {
  console.log('\n' + title);
  console.log('strategy'.padEnd(46), 'total %'.padStart(8), '2023*'.padStart(7), '2024'.padStart(7), '2025'.padStart(7), '2026*'.padStart(7), 'max drop %'.padStart(11), 'months up/down'.padStart(15), 'trades'.padStart(7), 'worst day/trade %'.padStart(18));
  rows.forEach(s => console.log(s.name.padEnd(46), f1(s.total).padStart(8), yr(s, '2023').padStart(7), yr(s, '2024').padStart(7), yr(s, '2025').padStart(7), yr(s, '2026').padStart(7),
    s.dd.toFixed(1).padStart(11), (s.up + ' / ' + s.down).padStart(15), String(s.trades ?? '-').padStart(7), f1(s.worst).padStart(18)));
  if (extra) console.log(extra);
}
console.log('ETH, Nov 2023 – Oct 2026 (36 months). % of ETH price, full position, compounded, after costs. *2023 = Nov–Dec, 2026 = Jan–Oct.');
table('1. TREND FOLLOWING (daily closes 00:00 UTC; perp versions pay/receive funding)', trends);
table('2. FUNDING CARRY (hold ETH + short the Deribit perpetual; % on the ETH held)', carries,
  `   Deribit ETH perpetual funding over the period averaged ${fYear.toFixed(1)}% a year (Binance / OKX funding is usually higher; not fetchable here).`);
table('3. SELLING ATM STRADDLES (Black–Scholes at DVOL minus the points shown; % of ETH price per straddle, 1 ETH each)', straddles);
if (process.env.MONTHS) {
  const pick = [...trends, ...carries, ...straddles].filter(s => process.env.MONTHS.split('|').includes(s.name));
  console.log('\nMonth by month (%):');
  console.log('month   ' + pick.map(s => s.name.slice(0, 22).padStart(24)).join(''));
  const ms = Object.keys(pick[0].months).sort();
  ms.forEach(m => console.log(m + ' ' + pick.map(s => f1(((s.months[m] || 1) - 1) * 100).padStart(24)).join('')));
}
