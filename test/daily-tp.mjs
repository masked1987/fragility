// Owner's DAILY approach (2 Nov 2026), kept apart from every other strategy:
// price touches a blue zone on the Gamma Detrite "Daily" view, then wait for the
// 5-minute Ichimoku Tenkan / Kijun cross the way of the turn, stop at the low / high
// of the touch. Asked: "do the test to find best take profit". This compares take
// profits on the same entries.
//
//   node test/daily-tp.mjs [months=37] [cache=.bt-cache] [parallel=6]
//   LIST=<tp name> prints every trade for that take profit.
//
// Data: past option open interest per strike is only free for the 1st of each month
// (Tardis, the ~00:00–00:20 snapshot, held for the day), so the test days are the 1st
// of each month. Each test day has two Daily windows, as the page would show them:
//   00:20 → 08:00 day D  : the options expiring 08:00 day D
//   08:00 D → 08:00 D+1  : the options expiring 08:00 day D+1 (snapshot OI, 8 h older)
// Gamma as on the page (dealers long calls, short puts; $ per 1% move), worked out at
// the window start with the price then; a strike is a blue zone when its value is at
// least +$5K (the page draws nothing smaller), within ±8% of the price (≈ the Near view).
// Candles: Deribit ETH-PERPETUAL 5-minute. Costs 0.1% of the entry per round trip.
// Rules as simulated:
//   touch (buy): a candle's low reaches a blue strike that the previous close was above
//   (sell: the high reaches a blue strike the previous close was below);
//   the stop is the lowest low since the touch (sell: highest high), no extra points;
//   entry at the close of the first 5-minute candle where Tenkan (9) crosses above
//   Kijun (26) (sell: below), while that setup is live and the close is past the stop;
//   one trade at a time; setups reset when a trade opens; setups and open trades end
//   at the window's expiry (08:00 UTC), closed at that candle's close.
//   Stop checked first when stop and target are in the same candle.
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setCache, getJson, cached, ymd, DAY } from './bt-data.mjs';
const exec = promisify(execCb);

const MONTHS = +(process.argv[2] || 37), CACHE = process.argv[3] || '.bt-cache', PAR = +(process.argv[4] || 6);
setCache(CACHE);
const M5 = 5 * 6e4, H = 36e5, FEE = 0.001, MIN_BLUE = 5000, RANGE = 0.08;

// The 1st of each month, newest first, only days whose next 08:00 has passed.
const days = [];
{
  const now = new Date();
  let y = now.getUTCFullYear(), m = now.getUTCMonth();
  while (days.length < MONTHS) {
    const D = Date.UTC(y, m, 1);
    if (D + DAY + 8 * H <= Date.now()) days.push(D);
    if (--m < 0) { m = 11; y--; }
  }
  days.reverse();
}

// Same as chainAt() in bt-data.mjs, but the free Tardis server answers 429 (too many
// requests) when pulled hard: fail on HTTP errors, wait and retry, never cache an empty chain.
async function chainDay(D) {
  const f = join(CACHE, 'chain-' + ymd(D).replace(/\//g, '') + '.json');
  if (existsSync(f)) { const v = JSON.parse(readFileSync(f, 'utf8')); if (v.length) return v; }
  for (let k = 0; k < 8; k++) {
    try {
      const raw = (await exec(`set -o pipefail; curl -sf -r 0-209715199 "https://datasets.tardis.dev/v1/deribit/options_chain/${ymd(D)}/OPTIONS.csv.gz" | (gunzip 2>/dev/null || true) | (grep '^deribit,ETH-' || true)`,
        { maxBuffer: 2e9, shell: '/bin/bash' })).stdout;
      const last = {};
      for (const line of raw.split('\n')) {
        const x = line.split(',');
        if (x.length < 17) continue;
        last[x[1]] = { strike: +x[5], type: x[4] === 'call' ? 'C' : 'P', expiry: +x[6] / 1000, oi: +x[7], iv: +x[16] / 100 };
      }
      const v = Object.values(last).filter(o => o.oi > 0 && o.iv > 0 && o.strike > 0);
      if (v.length) { writeFileSync(f, JSON.stringify(v)); return v; }
    } catch (e) { /* 429 or network: wait and retry */ }
    await new Promise(r => setTimeout(r, 15000 * (k + 1)));
  }
  console.error('no chain for', ymd(D));
  return [];
}

function candles(D) {
  return cached('d5-' + D + '.json', async () => {
    const a = D - 6 * H, b = D + DAY + 9 * H;
    const j = await getJson(`https://www.deribit.com/api/v2/public/get_tradingview_chart_data?instrument_name=ETH-PERPETUAL&start_timestamp=${a}&end_timestamp=${b}&resolution=5`);
    const r = j.result;
    return r.ticks.map((t, i) => ({ t, o: r.open[i], h: r.high[i], l: r.low[i], c: r.close[i] }));
  });
}

function gam(F, K, s, T) {
  const d1 = (Math.log(F / K) + 0.5 * s * s * T) / (s * Math.sqrt(T));
  return Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI) / (F * s * Math.sqrt(T));
}

// The Daily view for one expiry at time t: $ gamma per strike, blue strikes, the flip.
function dailyView(chain, E, t, spot) {
  const T = (E - t) / (365 * DAY), by = {};
  chain.forEach(function (o) {
    if (o.expiry !== E || Math.abs(o.strike / spot - 1) > RANGE) return;
    const g = gam(spot, o.strike, o.iv, T) * o.oi * spot * spot * 0.01;
    by[o.strike] = (by[o.strike] || 0) + (o.type === 'C' ? g : -g);
  });
  const rows = Object.keys(by).map(Number).sort((a, b) => a - b).map(k => ({ k, v: by[k] }));
  let flip = null, bd = Infinity;
  for (let i = 0; i < rows.length - 1; i++) {
    const g0 = rows[i].v, g1 = rows[i + 1].v;
    if ((g0 < 0 && g1 >= 0) || (g0 >= 0 && g1 < 0)) {
      const x = rows[i].k + Math.abs(g0) / (Math.abs(g0) + Math.abs(g1)) * (rows[i + 1].k - rows[i].k);
      if (Math.abs(x - spot) < bd) { bd = Math.abs(x - spot); flip = x; }
    }
  }
  return { rows, blue: rows.filter(r => r.v >= MIN_BLUE), flip };
}

function tk(c, i) {
  const mid = n => { let hi = -Infinity, lo = Infinity; for (let k = i - n + 1; k <= i; k++) { hi = Math.max(hi, c[k].h); lo = Math.min(lo, c[k].l); } return (hi + lo) / 2; };
  return i >= 26 ? { t: mid(9), k: mid(26) } : null;
}

// Take profits compared on the same entries. Each returns a price or null (no target:
// held to the stop or the 08:00 expiry).
const TPS = {
  'next blue': (e, buy, v) => { const b = v.blue.filter(r => buy ? r.k > e : r.k < e).sort((x, y) => buy ? x.k - y.k : y.k - x.k)[0]; return b ? b.k : null; },
  'biggest blue': (e, buy, v) => { const b = v.blue.filter(r => buy ? r.k > e : r.k < e).sort((x, y) => y.v - x.v)[0]; return b ? b.k : null; },
  'flip line': (e, buy, v) => v.flip != null && (buy ? v.flip > e : v.flip < e) ? v.flip : null,
  '1R': (e, buy, v, risk) => buy ? e + risk : e - risk,
  '1.5R': (e, buy, v, risk) => buy ? e + 1.5 * risk : e - 1.5 * risk,
  '2R': (e, buy, v, risk) => buy ? e + 2 * risk : e - 2 * risk,
  '3R': (e, buy, v, risk) => buy ? e + 3 * risk : e - 3 * risk,
  '4R': (e, buy, v, risk) => buy ? e + 4 * risk : e - 4 * risk,
  'no target (out at 08:00)': () => null,
};

// One Daily window for one take profit. One trade at a time: a trade that is still
// open blocks new entries, so each take profit gets its own trade list.
function windowTrades(c, chain, start, E, name) {
  const i0 = c.findIndex(x => x.t >= start), iEnd = c.findIndex(x => x.t + M5 > E);
  if (i0 < 27 || iEnd < 0) return [];
  const spot = c[i0 - 1].c, v = dailyView(chain, E, start, spot), TP = TPS[name];
  if (!v.rows.length) return [];
  const out = [];
  let buyS = null, sellS = null, i = i0;
  while (i <= iEnd) {
    const x = c[i], prev = c[i - 1];
    const tb = v.blue.filter(r => x.l <= r.k && prev.c > r.k), ts = v.blue.filter(r => x.h >= r.k && prev.c < r.k);
    if (buyS) buyS.ext = Math.min(buyS.ext, x.l); else if (tb.length) buyS = { k: tb[tb.length - 1].k, ext: x.l };
    if (sellS) sellS.ext = Math.max(sellS.ext, x.h); else if (ts.length) sellS = { k: ts[0].k, ext: x.h };
    const a = tk(c, i), b = tk(c, i - 1);
    let side = null;
    if (a && b && i < iEnd) {
      if (buyS && a.t > a.k && b.t <= b.k && x.c > buyS.ext) side = 'buy';
      else if (sellS && a.t < a.k && b.t >= b.k && x.c < sellS.ext) side = 'sell';
    }
    if (!side) { i++; continue; }
    const buy = side === 'buy', S = buy ? buyS : sellS, entry = x.c, stop = S.ext, risk = Math.abs(entry - stop);
    const tp = TP(entry, buy, v, risk);
    let exit = null, how = 'expiry', j = i + 1;
    for (; j <= iEnd; j++) {
      const y = c[j];
      if (buy ? y.l <= stop : y.h >= stop) { exit = stop; how = 'stop'; break; }
      if (tp != null && (buy ? y.h >= tp : y.l <= tp)) { exit = tp; how = 'target'; break; }
    }
    if (exit == null) { j = iEnd; exit = c[iEnd].c; }
    const move = buy ? exit - entry : entry - exit;
    out.push({ t: x.t, side, zone: S.k, entry, stop, riskPct: risk / entry * 100,
      r: { pct: move / entry * 100 - FEE * 100, R: (move - FEE * entry) / risk, how, tp } });
    buyS = sellS = null;
    i = j + 1;
  }
  return out;
}

async function pool(items, fn) {
  const out = new Array(items.length); let k = 0;
  await Promise.all(Array.from({ length: PAR }, async () => { while (k < items.length) { const i = k++; out[i] = await fn(items[i]); } }));
  return out;
}

const data = await pool(days, async D => {
  const [chain, c] = await Promise.all([chainDay(D), candles(D)]);
  process.stderr.write('.');
  return { D, chain, c };
});
process.stderr.write('\n');

const names = Object.keys(TPS), lists = {};
for (const name of names) {
  lists[name] = [];
  for (const d of data) {
    if (!d.c.length || !d.chain.length) continue;
    lists[name].push(...windowTrades(d.c, d.chain, d.D + 20 * 6e4, d.D + 8 * H, name));
    lists[name].push(...windowTrades(d.c, d.chain, d.D + 8 * H, d.D + DAY + 8 * H, name));
  }
}

const f2 = x => (x >= 0 ? '+' : '') + x.toFixed(2);
const lastYear = Date.now() - 365 * DAY;
function stats(L) {
  if (!L.length) return { n: 0 };
  const p = L.map(t => t.r.pct), sum = p.reduce((a, b) => a + b, 0);
  let run = 0, worst = 0, eq = 0, peak = 0, dd = 0;
  p.forEach(x => { run = x < 0 ? run + 1 : 0; worst = Math.max(worst, run); eq += x; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); });
  const sorted = p.slice().sort((a, b) => b - a), top2 = sorted.slice(0, 2).reduce((a, b) => a + b, 0);
  return {
    n: L.length, win: L.filter(t => t.r.pct > 0).length / L.length * 100, hit: L.filter(t => t.r.how === 'target').length / L.length * 100,
    avg: sum / L.length, sum, worst, dd, noTop2: L.length > 2 ? (sum - top2) / (L.length - 2) : null,
    avgR: L.reduce((a, t) => a + t.r.R, 0) / L.length,
  };
}
const usedDays = data.filter(d => d.c.length && d.chain.length).length;
console.log(`Daily approach: blue zone touch + 5-min Tenkan/Kijun cross, stop at the touch low/high`);
console.log(`${usedDays} test days (1st of each month ${new Date(days[0]).toISOString().slice(0, 7)} – ${new Date(days[days.length - 1]).toISOString().slice(0, 7)}), 2 Daily windows each, buys + sells together, 0.1% costs`);
const any = lists[names[0]];
const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
console.log(`median stop distance ${med(any.map(t => t.riskPct)).toFixed(2)}% of price\n`);
console.log('take profit                trades  win%  target%  avg %/trade  total %  worst run  max drop %  w/o best 2  avg R   | first 2y %/tr  last year %/tr (n)');
for (const name of names) {
  const L = lists[name], s = stats(L), a = stats(L.filter(t => t.t < lastYear)), b = stats(L.filter(t => t.t >= lastYear));
  if (!s.n) { console.log(name.padEnd(26), 'no trades'); continue; }
  console.log(name.padEnd(26), String(s.n).padStart(6), s.win.toFixed(0).padStart(5), s.hit.toFixed(0).padStart(8), f2(s.avg).padStart(12), f2(s.sum).padStart(8),
    String(s.worst).padStart(10), s.dd.toFixed(1).padStart(11), (s.noTop2 == null ? '-' : f2(s.noTop2)).padStart(11), f2(s.avgR).padStart(7), ' |',
    (a.n ? f2(a.avg) : '-').padStart(13), ((b.n ? f2(b.avg) : '-') + ' (' + b.n + ')').padStart(16));
}
const byS = side => stats(lists[names[0]].filter(t => t.side === side));
console.log(`\nbuys ${byS('buy').n} / sells ${byS('sell').n} (next blue)`);
if (process.env.LIST) {
  console.log('\n' + process.env.LIST + ':');
  (lists[process.env.LIST] || []).forEach(t => console.log(new Date(t.t).toISOString().slice(0, 16), t.side.padEnd(4), 'zone', t.zone, 'entry', t.entry.toFixed(1), 'stop', t.stop.toFixed(1),
    'tp', t.r.tp == null ? '-' : t.r.tp.toFixed(1), t.r.how.padEnd(7), f2(t.r.pct) + '%'));
}
