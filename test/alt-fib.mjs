// Run: node test/alt-fib.mjs [months=36] [cacheDir=.bt-cache]   (LIST=ichi|bounce1|up4|hold4 prints trades)
// The owner's Fibonacci entry for Alt Tactics (asked 1 Nov 2026, with a screen recording):
// "Once it's crossed gamma level, for example 2200, I am waiting for noticeable reverse,
//  in this case 2169, then starting to measure Fibonacci and my aim would be 62 of
//  retracement." His drawing: 1 = the low of the dip, 0 = the top of the bounce after it,
//  entry at the 0.62 line (~2,203 on Oct 30). Stop at the low (1), target the biggest huge
//  level above, once per level, as in the tab.
// "Noticeable reverse" needs a definition for a computer; two are tested:
//   ichi    = the 5-minute Ichimoku score crosses up through 80 (the tab's signal)
//   bounce1 = a 5-minute close 1% or more above the low
//   up4     = 4 fifteen-minute candles after the low, each closing higher than the last
//   hold4   = 4 fifteen-minute candles after the low's candle with no lower low (1 hour)
//   (the last two asked for instead of Ichimoku: "at least 4 candles 15 minutes reversal")
// After that, 0 = the highest price since the low (it moves up with new highs); a buy
// order sits at 0.62 and fills when a later candle trades down to it (no fill in the
// candle that made the new high). No fill before the target is reached or within 48 h
// of the cross = no trade. Same data as test/alt-backtest.mjs; 0.1% costs.
import { setCache, cached, chainAt, getJson, DAY } from './bt-data.mjs';
import { pickHuge, ichimoku, to15, oncePerLevel, pickTarget, findSetups } from '../tools/alt-tactics/model.js';
import { ALT_CONFIG } from '../tools/alt-tactics/config.js';

const MONTHS = +(process.argv[2] || 36);
setCache(process.argv[3] || '.bt-cache');
const FEE = 0.001, M5 = 5 * 6e4, FIB = 0.62;
const now = Date.now();
const months = [];
for (let k = MONTHS; k >= 0; k--) { const d = new Date(now); months.push(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1)); }
const START = months[0] - 3 * DAY;

async function candles5() {
  const out = [];
  for (let a = START; a < now; a += 10 * DAY) {
    const b = Math.min(a + 10 * DAY, now);
    const part = await Promise.resolve().then(() => cached('c5-' + a + '.json', async () => {
      const j = await getJson(`https://www.deribit.com/api/v2/public/get_tradingview_chart_data?instrument_name=ETH-PERPETUAL&start_timestamp=${a}&end_timestamp=${b - 1}&resolution=5`);
      const r = j.result;
      return r.ticks.map((t, i) => ({ t, h: r.high[i], l: r.low[i], c: r.close[i] }));
    })).catch(() => []);
    out.push(...part.filter(c => c.t >= a && c.t < b && c.t + M5 <= now));
  }
  const seen = new Set();
  return out.sort((x, y) => x.t - y.t).filter(c => !seen.has(c.t) && seen.add(c.t));
}
const c5 = await candles5();
const ch = [];
for (const m of months) ch.push(await Promise.resolve().then(() => chainAt(m)).catch(() => []));
function idx(t) { let lo = 0, hi = c5.length; while (lo < hi) { const m = (lo + hi) >> 1; if (c5[m].t < t) lo = m + 1; else hi = m; } return lo; }
const monthLevels = months.map((m, i) => {
  const spot = c5[Math.min(idx(m), c5.length - 1)].c;
  return pickHuge((ch[i] || []).map(o => ({ strike: o.strike, oi: o.oi, expiry: o.expiry > 1e14 ? o.expiry / 1000 : o.expiry })), spot, m, ALT_CONFIG);
});
const ICH = ichimoku(c5);
// 15-minute candles for the "4 candles" reversal (owner: "let's at least 4 candles 15 minutes reversal").
const C15 = to15(c5), I15 = new Map(C15.map((c, i) => [c.t, i])), M15 = 9e5;
function fourCandles(how, lowT, x) {
  if ((x.t + M5) % M15 !== 0) return false;              // only when a 15-minute candle has just closed
  const j = I15.get(x.t + M5 - M15), j0 = I15.get(Math.floor(lowT / M15) * M15);
  if (j === undefined || j0 === undefined || j - j0 < 4) return false;
  if (how === 'hold4') return true;                       // 4 closed candles after the low's candle, no lower low
  for (let q = j - 3; q <= j; q++) if (!(C15[q].c > C15[q - 1].c)) return false;
  return true;                                            // 'up4': the last 4 closes each higher than the one before
}

// Dips through each huge level (price was above on 15-minute candles, one trades below),
// with the low followed until the reversal is confirmed ('how'), then the 0.62 order.
function fibSetups(i, how, cfg) {
  const m = months[i], end = i + 1 < months.length ? months[i + 1] : now, lv = monthLevels[i];
  const a = idx(m - 2 * DAY), b = idx(end + 3 * DAY), part = c5.slice(a, b), c15 = to15(part), win = cfg.windowHours * 36e5;
  const out = [];
  lv.forEach(({ price: L }) => {
    const target = pickTarget(lv, L, 1, cfg);
    let pos = null;
    for (let q = 0; q < c15.length; q++) {
      const c = c15[q];
      if (pos === null || !(pos === 'above' && c.l < L)) { pos = c.c >= L ? 'above' : 'below'; continue; }
      const t0 = c.t;
      if (t0 < m || t0 >= end) { pos = c.c >= L ? 'above' : 'below'; continue; }
      const s = { side: 'buy', level: L, target, t0, low: Infinity, state: 'waiting', signal: null };
      let k = idx(t0), conf = false, hi = -Infinity, endT = null;
      for (; k < c5.length && c5[k].t - t0 <= win; k++) {
        const x = c5[k];
        if (!conf) {
          if (x.l < s.low) { s.low = x.l; s.lowK = k; s.lowT = x.t; }
          if ((L - s.low) / L * 100 > cfg.maxDepthPct) { s.state = 'broken'; endT = x.t; break; }
          const p = ICH[k - 1], n = ICH[k];
          conf = how === 'ichi' ? !!(p && n && p.score < cfg.scoreBuy && n.score >= cfg.scoreBuy)
            : how === 'bounce1' ? x.c >= s.low * 1.01 : fourCandles(how, s.lowT, x);
          if (conf) { hi = Math.max(...c5.slice(s.lowK, k + 1).map(y => y.h)); s.confT = x.t; } // 0 = the top since the low
          continue;
        }
        const entry = hi - FIB * (hi - s.low);
        if (x.l <= entry) {
          const fill = Math.min(entry, Math.max(x.l, x.h >= entry ? entry : x.h));
          s.state = 'signal';
          s.signal = { t: x.t, entry: fill, stop: s.low, target, rr: target ? (target - fill) / (fill - s.low) : null, hi };
          endT = x.t;
          break;
        }
        if (target && x.h >= target) { s.state = 'missed'; endT = x.t; break; }
        hi = Math.max(hi, x.h);
      }
      if (s.state === 'waiting') { s.state = 'lapsed'; endT = c5[Math.min(k, c5.length - 1)].t; }
      out.push(s);
      while (q + 1 < c15.length && c15[q + 1].t <= endT) q++;
      pos = c15[q].c >= L ? 'above' : 'below';
    }
  });
  return out;
}

// The tab's own entry (Ichimoku 80 close) on the same footing, for comparison.
function tabSetups(i, cfg) {
  const m = months[i], end = i + 1 < months.length ? months[i + 1] : now, lv = monthLevels[i];
  const a = Math.max(0, idx(m) - 100), b = idx(end + (cfg.windowHours + 1) * 36e5);
  return findSetups(c5.slice(a, b), lv, cfg).filter(s => s.t0 >= m && s.t0 < end);
}
// Crosses up through a level are not traded here (sells off) but, as in the tab, they
// count as "price crossed another level" for once-per-level, so every version gets them.
const ups = i => tabSetups(i, cfg).filter(s => s.side === 'sell');

function run(make, cfg) {
  const setups = [];
  months.forEach((m, i) => { if (monthLevels[i].length) setups.push(...make(i)); });
  setups.sort((x, y) => x.t0 - y.t0);
  oncePerLevel(setups, c5, { buy: true, sell: false }, cfg);
  return setups.filter(s => s.taken && s.side === 'buy').map(s => {
    const g = s.signal, risk = g.entry - g.stop;
    const R = s.trade.result === 'target' ? (g.target - g.entry) / risk : s.trade.result === 'stopped' ? -1 : (c5[c5.length - 1].c - g.entry) / risk;
    return { ...s, R, net: R - FEE * g.entry / risk };
  });
}

const cfg = { ...ALT_CONFIG, sides: { buy: true, sell: false } };
const SPLIT = Date.UTC(2025, 10, 1);
const avg = L => L.length ? L.reduce((a, t) => a + t.net, 0) / L.length : 0;
const f = x => (x >= 0 ? '+' : '') + x.toFixed(2);
const versions = {
  tab: ['The tab now: buy on the Ichimoku 80 close', () => run(i => tabSetups(i, cfg), cfg)],
  ichi: ['Fib 0.62 after Ichimoku 80', () => run(i => fibSetups(i, 'ichi', cfg).concat(ups(i)), cfg)],
  bounce1: ['Fib 0.62 after a 1% bounce', () => run(i => fibSetups(i, 'bounce1', cfg).concat(ups(i)), cfg)],
  up4: ['Fib 0.62 after 4 rising 15-min candles', () => run(i => fibSetups(i, 'up4', cfg).concat(ups(i)), cfg)],
  hold4: ['Fib 0.62 after the low holds 4 candles', () => run(i => fibSetups(i, 'hold4', cfg).concat(ups(i)), cfg)],
};
if (process.env.LIST) {
  versions[process.env.LIST][1]().forEach(t => console.log(new Date(t.signal.t).toISOString().slice(0, 16), Math.round(t.level), '-> ' + Math.round(t.target),
    'low', t.low.toFixed(0), 'top', (t.signal.hi || 0).toFixed(0), 'in', t.signal.entry.toFixed(0), t.trade.result.padEnd(7), f(t.net) + 'R'));
  process.exit(0);
}
console.log(`ETH buys, ${new Date(months[0]).toISOString().slice(0, 7)} to now, huge levels, target the biggest huge level above, stop at the low, once per level, 0.1% costs`);
console.log('version                                    buys  hit  per-buy   total  worst | first 2 years   | last year       | without best 2');
for (const [name, fn] of Object.values(versions)) {
  const t = fn();
  let r = 0, worst = 0; t.slice().sort((a, b) => a.signal.t - b.signal.t).forEach(x => { r = x.net < 0 ? r + 1 : 0; worst = Math.max(worst, r); });
  const a = t.filter(x => x.signal.t < SPLIT), b = t.filter(x => x.signal.t >= SPLIT), rest = t.slice().sort((x, y) => y.net - x.net).slice(2);
  const hit = t.filter(x => x.trade.result === 'target').length;
  console.log(`${name.padEnd(42)} ${String(t.length).padStart(4)} ${String(Math.round(hit / t.length * 100)).padStart(3)}% ${f(avg(t)).padStart(6)}R ${f(t.reduce((s, x) => s + x.net, 0)).padStart(7)}R ${String(worst).padStart(5)} | ` +
    `${f(avg(a)).padStart(6)}R (${String(a.length).padStart(2)}) | ${f(avg(b)).padStart(6)}R (${String(b.length).padStart(2)}) | ${f(avg(rest)).padStart(6)}R`);
}
