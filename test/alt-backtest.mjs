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
import { pickHuge, findSetups, oncePerLevel } from '../tools/alt-tactics/model.js';
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
