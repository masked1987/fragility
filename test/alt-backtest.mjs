// Run: node test/alt-backtest.mjs [months=36] [cacheDir=.bt-cache]
// Backtest of the Alt Tactics tab with the tab's own code (tools/alt-tactics/model.js):
// findSetups + oncePerLevel, buys and sells-after-a-winning-buy, comparing target rules
// (asked Nov 2026: "I wouldn't aim 2300 ... most likely 2500", "huge biggest level above,
// 100 points is too small").
// Levels: pickHuge() on the ETH option chain of the 1st of each month (Tardis free
// sample, the only free past snapshots), held for that month. Price: Deribit
// ETH-PERPETUAL 5-minute candles. Costs 0.1% of the entry per round trip, in R.
// Trades still open at the end of the data count at the last close.
import { setCache, cached, chainAt, getJson, DAY } from './bt-data.mjs';
import { pickHuge, findSetups, oncePerLevel, follow, pickTarget, ichimoku } from '../tools/alt-tactics/model.js';
import { ALT_CONFIG } from '../tools/alt-tactics/config.js';

const MONTHS = +(process.argv[2] || 36);
setCache(process.argv[3] || '.bt-cache');
const FEE = 0.001, M5 = 5 * 6e4;
const now = Date.now();
const months = [];
for (let k = MONTHS; k >= 0; k--) { const d = new Date(now); months.push(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1)); }
const START = months[0] - 3 * DAY; // warm-up for Ichimoku

async function candles5() {
  const out = [], chunks = [];
  for (let a = START; a < now; a += 10 * DAY) chunks.push(a);
  let next = 0;
  async function worker() {
    while (next < chunks.length) {
      const a = chunks[next++], b = Math.min(a + 10 * DAY, now);
      const part = await Promise.resolve(cached('c5-' + a + '.json', async () => {
        const j = await getJson(`https://www.deribit.com/api/v2/public/get_tradingview_chart_data?instrument_name=ETH-PERPETUAL&start_timestamp=${a}&end_timestamp=${b - 1}&resolution=5`);
        const r = j.result;
        return r.ticks.map((t, i) => ({ t, h: r.high[i], l: r.low[i], c: r.close[i] }));
      })).catch(() => []);
      out.push(...part.filter(c => c.t >= a && c.t < b && c.t + M5 <= now));
    }
  }
  await Promise.all([1, 2, 3, 4].map(worker));
  const seen = new Set();
  return out.sort((x, y) => x.t - y.t).filter(c => !seen.has(c.t) && seen.add(c.t));
}

async function chains() {
  const out = [];
  let next = 0;
  async function worker() {
    while (next < months.length) {
      const i = next++;
      out[i] = await Promise.resolve().then(() => chainAt(months[i])).catch(e => { console.error('chain failed', new Date(months[i]).toISOString().slice(0, 10), e.message); return []; });
    }
  }
  await Promise.all([1, 2, 3].map(worker));
  return out;
}

const [c5, ch] = await Promise.all([candles5(), chains()]);
console.error(`candles ${c5.length}, chains ${ch.map(c => c.length).join(' ')}`);
function idx(t) { let lo = 0, hi = c5.length; while (lo < hi) { const m = (lo + hi) >> 1; if (c5[m].t < t) lo = m + 1; else hi = m; } return lo; }

// Huge levels per month, with their open contracts (pickHuge needs options with expiry in ms).
const monthLevels = months.map((m, i) => {
  const k = idx(m), spot = c5[Math.min(k, c5.length - 1)].c;
  const opts = (ch[i] || []).map(o => ({ strike: o.strike, oi: o.oi, expiry: o.expiry > 1e14 ? o.expiry / 1000 : o.expiry }));
  return pickHuge(opts, spot, m, ALT_CONFIG);
});

function run(cfg) {
  let setups = [];
  months.forEach((m, i) => {
    const end = i + 1 < months.length ? months[i + 1] : now;
    const lv = monthLevels[i];
    if (!lv.length) return;
    const a = Math.max(0, idx(m) - 100), b = idx(end + (cfg.windowHours + 1) * 36e5);
    const part = findSetups(c5.slice(a, b), lv, cfg).filter(s => s.t0 >= m && s.t0 < end);
    part.forEach(s => { s.month = i; });
    setups.push(...part);
  });
  setups.sort((x, y) => x.t0 - y.t0);
  oncePerLevel(setups, c5, cfg.sides, cfg);
  return setups.filter(s => s.taken).map(s => {
    const g = s.signal, risk = Math.abs(g.entry - g.stop), buy = s.side === 'buy';
    let R;
    if (s.trade.result === 'target') R = Math.abs(g.target - g.entry) / risk;
    else if (s.trade.result === 'stopped') R = -1;
    else R = (buy ? c5[c5.length - 1].c - g.entry : g.entry - c5[c5.length - 1].c) / risk;
    // cfg.split: half the position at the next huge level, the rest to the target;
    // 'be' also moves the rest's stop to the entry once the first half is taken.
    if (cfg.split && buy) {
      const nx = pickTarget(monthLevels[s.month], s.level, 1, { target: 'next' });
      if (nx && nx < g.target && nx > g.entry) {
        const h1 = follow({ t: g.t, stop: g.stop, target: nx }, c5);
        const r1 = h1.result === 'target' ? (nx - g.entry) / risk : h1.result === 'stopped' ? -1 : (c5[c5.length - 1].c - g.entry) / risk;
        let r2 = R;
        if (cfg.split === 'be' && h1.result === 'target') {
          const h2 = follow({ t: h1.at + M5, stop: g.entry, target: g.target }, c5);
          r2 = h2.result === 'target' ? (g.target - g.entry) / risk : h2.result === 'stopped' ? 0 : (c5[c5.length - 1].c - g.entry) / risk;
        }
        R = (r1 + r2) / 2;
      }
    }
    return { side: s.side, level: s.level, target: g.target, T: g.t, entry: g.entry, stop: g.stop, rr: g.rr, result: s.trade.result, at: s.trade.at,
      net: R - FEE * g.entry / risk };
  });
}

function stats(L) {
  const n = L.length;
  if (!n) return '   0 trades';
  const R = L.reduce((a, t) => a + t.net, 0), hit = L.filter(t => t.result === 'target').length;
  let run = 0, worst = 0;
  L.slice().sort((a, b) => a.T - b.T).forEach(t => { run = t.net < 0 ? run + 1 : 0; worst = Math.max(worst, run); });
  const yrs = {};
  L.forEach(t => (yrs[new Date(t.T).getUTCFullYear()] ||= []).push(t.net));
  const top = L.map(t => t.net).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  const days = L.filter(t => t.at).map(t => (t.at - t.T) / DAY).sort((a, b) => a - b);
  const rr = L.map(t => t.rr).sort((a, b) => a - b)[Math.floor(n / 2)];
  return `${String(n).padStart(3)} trades  ${String(Math.round(hit / n * 100)).padStart(2)}% reached target  ${(R / n >= 0 ? '+' : '') + (R / n).toFixed(2)}R/trade  total ${(R >= 0 ? '+' : '') + R.toFixed(1)}R  ` +
    `typical target ${rr.toFixed(1)}R  worst losing run ${worst}  top-5 wins ${top.toFixed(0)}R  median days in trade ${days.length ? days[Math.floor(days.length / 2)].toFixed(1) : '-'}  open ${L.filter(t => t.result === 'open').length}\n` +
    '        by year  ' + Object.keys(yrs).sort().map(y => `${y}: ${yrs[y].length} ${(yrs[y].reduce((a, b) => a + b, 0) / yrs[y].length >= 0 ? '+' : '')}${(yrs[y].reduce((a, b) => a + b, 0) / yrs[y].length).toFixed(2)}R`).join('  ');
}

console.log(`Alt Tactics backtest, ETH ${new Date(months[0]).toISOString().slice(0, 7)} to now, huge levels ${Math.round(ALT_CONFIG.hugeShare * 100)}%, ` +
  `${ALT_CONFIG.candleMinutes}-min Ichimoku, once per level, 0.1% costs`);
console.log('Levels per month: ' + months.map((m, i) => new Date(m).toISOString().slice(2, 7) + ' ' + monthLevels[i].map(x => Math.round(x.price)).join('/')).join(', '));
// GRID=1: one tweak at a time from the tab's rules (buys), judged on the first two
// years and checked on the last year, which the choice never sees.
if (process.env.GRID) {
  const SPLIT = Date.UTC(2025, 10, 1);
  const avg = L => L.length ? L.reduce((a, t) => a + t.net, 0) / L.length : 0;
  const f = x => (x >= 0 ? '+' : '') + x.toFixed(2);
  const row = (name, v) => {
    const t = run({ ...ALT_CONFIG, sides: { buy: true, sell: false }, ...v }).filter(x => x.side === 'buy');
    let r = 0, worst = 0; t.forEach(x => { r = x.net < 0 ? r + 1 : 0; worst = Math.max(worst, r); });
    const a = t.filter(x => x.T < SPLIT), b = t.filter(x => x.T >= SPLIT), top2 = t.slice().sort((x, y) => y.net - x.net).slice(2);
    const hit = t.filter(x => x.result === 'target').length;
    console.log(`${name.padEnd(34)} ${String(t.length).padStart(3)} ${String(Math.round(hit / t.length * 100)).padStart(3)}% ${f(avg(t)).padStart(6)}R ${f(t.reduce((s, x) => s + x.net, 0)).padStart(7)}R  run ${String(worst).padStart(2)} | ` +
      `first 2y ${f(avg(a)).padStart(6)}R (${a.length}) | last year ${f(avg(b)).padStart(6)}R (${b.length}) | without best 2 ${f(avg(top2)).padStart(6)}R`);
  };
  console.log('tweak                              buys hit  per-buy  total   worst | first 2 years      | last year (unseen) | ');
  // GRID=ichi: Ichimoku on bigger candles (built from 5-minute ones; the score changes
  // only when a bigger candle closes) and with other look-back lengths.
  const onTF = (min, p) => c => {
    const ms = min * 6e4, out = new Array(c.length).fill(null), big = [], at = [];
    for (let k = 0; k < c.length; k++) {
      const x = c[k], key = Math.floor(x.t / ms) * ms, last = big[big.length - 1];
      if (!last || last.t !== key) big.push({ t: key, h: x.h, l: x.l, c: x.c, n: 1 }); else { last.h = Math.max(last.h, x.h); last.l = Math.min(last.l, x.l); last.c = x.c; last.n++; }
      at.push((x.t + M5) % ms === 0 && big[big.length - 1].n === min / 5 ? big.length - 1 : -1);
    }
    const sc = ichimoku(big, p);
    let cur = null;
    for (let k = 0; k < c.length; k++) { if (at[k] >= 0) cur = sc[at[k]]; out[k] = cur; }
    return out;
  };
  if (process.env.GRID === 'ichi') {
    [['5-min candles, 9/26/52 (the tab now)', {}],
     ['10-min candles', { ichSeries: onTF(10) }], ['15-min candles', { ichSeries: onTF(15) }],
     ['30-min candles', { ichSeries: onTF(30) }], ['1-hour candles', { ichSeries: onTF(60) }],
     ['5-min, faster 6/18/36', { ichSeries: c => ichimoku(c, { t: 6, k: 18, s: 36 }) }],
     ['5-min, slower 12/36/72', { ichSeries: c => ichimoku(c, { t: 12, k: 36, s: 72 }) }],
     ['5-min, slower 18/52/104', { ichSeries: c => ichimoku(c, { t: 18, k: 52, s: 104 }) }],
     ['5-min, crypto 20/60/120', { ichSeries: c => ichimoku(c, { t: 20, k: 60, s: 120 }) }],
    ].forEach(([n, v]) => row(n, v));
    process.exit(0);
  }
  const grid = (process.env.GRID === '1' ? [
    ['the tab now (biggest level)', {}],
    ['target: next level', { target: 'next' }],
    ['half at next level, rest to biggest', { split: 'half' }],
    ['  ... and stop to entry after half', { split: 'be' }],
    ['Ichimoku 60', { scoreBuy: 60 }], ['Ichimoku 70', { scoreBuy: 70 }], ['Ichimoku 90', { scoreBuy: 90 }],
    ['stop 0.2% under the low', { stopBufferPct: 0.2 }], ['stop 0.5% under the low', { stopBufferPct: 0.5 }], ['stop 1% under the low', { stopBufferPct: 1 }],
    ['dip at most 1.5% deep', { maxDepthPct: 1.5 }], ['dip at most 2% deep', { maxDepthPct: 2 }], ['dip at most 5% deep', { maxDepthPct: 5 }],
    ['wait at most 24 h for the signal', { windowHours: 24 }], ['wait at most 72 h', { windowHours: 72 }],
  ] : JSON.parse(process.env.GRID));
  grid.forEach(([n, v]) => row(n, v));
  process.exit(0);
}
// LIST=next|biggest prints every trade of that target rule instead.
if (process.env.LIST) {
  run({ ...ALT_CONFIG, target: process.env.LIST, minTargetPct: 0, sides: { buy: true, sell: true } }).forEach(t => console.log(
    new Date(t.T).toISOString().slice(0, 16), t.side.padEnd(4), Math.round(t.level), '->', Math.round(t.target), 'in', t.entry.toFixed(0), 'stop', t.stop.toFixed(0),
    t.result.padEnd(7), (t.net >= 0 ? '+' : '') + t.net.toFixed(2) + 'R', t.at ? ((t.at - t.T) / DAY).toFixed(1) + 'd' : ''));
  process.exit(0);
}
const variants = [
  ['next huge level (the tab so far)', { target: 'next', minTargetPct: 0 }],
  ['next huge level, at least 5% away', { target: 'next', minTargetPct: 5 }],
  ['biggest huge level that way', { target: 'biggest', minTargetPct: 0 }],
  ['biggest huge level, at least 5% away', { target: 'biggest', minTargetPct: 5 }],
  ['biggest huge level, at least 3% away', { target: 'biggest', minTargetPct: 3 }],
  ['biggest huge level, at least 8% away', { target: 'biggest', minTargetPct: 8 }],
];
for (const [name, v] of variants) {
  const t = run({ ...ALT_CONFIG, ...v, sides: { buy: true, sell: true } });
  console.log(`\n== Target: ${name}`);
  console.log('  BUY   ' + stats(t.filter(x => x.side === 'buy')));
  console.log('  SELL  ' + stats(t.filter(x => x.side === 'sell')) + '   (only after a buy reached its target)');
  console.log('  BOTH  ' + stats(t));
}
