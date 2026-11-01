// Run: node test/levels-reversal.mjs [months=36] [cacheDir]
// Backtest of the owner's own method on the big gamma levels (asked Nov 2026):
//   "Once a level is crossed I wait for price to reverse a little; my stop goes at
//    the lowest (or highest) point of the move; usually price doesn't revisit it
//    when it truly reverses. E.g. 2,200 crossed, low ~2,169, wait for buys."
// BUY: price was above a level, trades below it, makes a low, turns back up.
// SELL: the mirror image (trades above a level, makes a high, turns down).
//
// Levels: pickLevels() from shared/levels.js with the live key-level settings
// (5 biggest strikes by open contracts, calls + puts, within ±15%), from the option
// chain on the 1st of each month (the only free past snapshots), held for the month.
// Price: Deribit ETH-PERPETUAL 5-minute candles (15-minute built from them).
// Buy/sell (taker) volume: Gate 15-minute stats, only the last ~180 days exist.
//
// A setup ends without a trade if price runs more than DEPTH% past the level (a real
// breakdown) or nothing confirms within 48 hours. Entries, each tested on its own:
//   reclaim - a 15-minute close back over the level
//   bounce  - price comes BOUNCE% off the extreme
//   flow    - a 15-minute candle near the extreme, closing the trade's way, with
//             most aggressive volume on the trade's side (last ~180 days only)
// Stop at the extreme (or a buffer past it); target = the next big level beyond the
// crossed one. Outcome on 5-minute candles, a stop and target in one candle counts
// as a stop; open after 7 days = the move at that point in R. No fees or slippage.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setCache, cached, chainAt, getJson, ymd, px, DAY } from './bt-data.mjs';
import { pickLevels } from '../shared/levels.js';
import { CONFIG } from '../tools/fragility/config.js';

const MONTHS = +(process.argv[2] || 36);
const CACHE = process.argv[3] || '.bt-cache';
// Which levels: 'key' = the live key levels (5 biggest within ±15%); 'huge60' / 'huge70' =
// only the huge strikes, at least 60% / 70% the size of the biggest within ±35% (the owner:
// "I take only levels which are huge", e.g. 2,000 / 2,200 / 2,500 / 3,000).
const MODE = process.argv[4] || 'key';
setCache(CACHE);
const KL = CONFIG.keyLevels;
const DEPTH = 3, BOUNCE = 0.5, WINDOW = 48 * 36e5, HOLD = 7 * DAY, M5 = 5 * 6e4, M15 = 15 * 6e4;
const BUFFERS = [0, 0.1];
const now = Date.now();
const months = [];
for (let k = MONTHS; k >= 1; k--) { const d = new Date(now); months.push(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1)); }
const START = months[0];

// 5-minute candles, in 10-day chunks, cached per chunk.
async function candles5() {
  const out = [];
  for (let a = START; a < now; a += 10 * DAY) {
    const b = Math.min(a + 10 * DAY, now);
    const part = await Promise.resolve(cached('c5-' + a + '.json', async () => {
      const j = await getJson(`https://www.deribit.com/api/v2/public/get_tradingview_chart_data?instrument_name=ETH-PERPETUAL&start_timestamp=${a}&end_timestamp=${b - 1}&resolution=5`);
      const r = j.result;
      return r.ticks.map((t, i) => ({ t, o: r.open[i], h: r.high[i], l: r.low[i], c: r.close[i] }));
    })).catch(() => []);
    out.push(...part.filter(c => c.t >= a && c.t < b && (b < now || c.t + M5 <= now)));
  }
  return out;
}
function to15(c5) {
  const by = new Map();
  for (const c of c5) {
    const k = Math.floor(c.t / M15) * M15, x = by.get(k);
    if (!x) by.set(k, { t: k, o: c.o, h: c.h, l: c.l, c: c.c, n: 1 });
    else { x.h = Math.max(x.h, c.h); x.l = Math.min(x.l, c.l); x.c = c.c; x.n++; }
  }
  return [...by.values()].filter(x => x.n === 3).sort((a, b) => a.t - b.t);
}
// Gate taker buy / sell size per 15 minutes (last ~180 days).
async function taker() {
  const from0 = Math.floor(now / 1000) - 179 * 86400, rows = new Map();
  let from = from0;
  for (let i = 0; i < 400 && from < now / 1000; i++) {
    const j = await getJson(`https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=ETH_USDT&interval=15m&from=${from}&limit=1000`).catch(() => []);
    if (!j.length) break;
    j.forEach(r => rows.set(r.time * 1000, { buy: r.long_taker_size, sell: r.short_taker_size }));
    const last = j[j.length - 1].time;
    if (last + 900 <= from) break;
    from = last + 900;
  }
  return rows;
}

const c5 = await candles5();
const c15 = to15(c5);
const flowMap = await taker();
const flowFrom = Math.min(...flowMap.keys());
console.log(`5-minute candles ${c5.length} (${ymd(c5[0].t)}–${ymd(c5.at(-1).t)}), 15-minute ${c15.length}, taker rows ${flowMap.size} from ${ymd(flowFrom)}`);

// Huge strikes: open contracts (calls + puts, expiring after 2 days) within ±35%, at
// least `share` of the biggest one, and at least 0.5% apart.
function pickHuge(chain, spot, now, share) {
  const by = {};
  chain.forEach(o => { if (o.expiry - now > 2 * DAY && Math.abs(o.strike / spot - 1) <= 0.35) by[o.strike] = (by[o.strike] || 0) + o.oi; });
  const rows = Object.entries(by).map(([k, v]) => ({ k: +k, v })).sort((a, b) => b.v - a.v);
  const top = rows.length ? rows[0].v : 0, out = [];
  rows.forEach(r => { if (r.v >= share * top && !out.some(x => Math.abs(x / r.k - 1) < 0.005)) out.push(r.k); });
  return out.sort((a, b) => a - b);
}

// Levels per month.
const levelsBy = [];
for (const M of months) {
  let chain;
  try { chain = await chainAt(M); } catch (e) { console.log('no chain', ymd(M), e.message); continue; }
  const first = c15.find(c => c.t >= M);
  if (!first || chain.length < 100) continue;
  const lv = MODE === 'key' ? pickLevels(chain, first.o, M, KL).map(x => x.price) : pickHuge(chain, first.o, M, +MODE.slice(4) / 100);
  levelsBy.push({ from: M, levels: lv });
}
levelsBy.forEach((x, i) => { x.to = i + 1 < levelsBy.length ? levelsBy[i + 1].from : now; });
console.log('levels per month:\n' + levelsBy.map(x => `  ${ymd(x.from)}  ${x.levels.map(px).join(' / ')}`).join('\n'));

// Trade outcome on 5-minute candles from entry time.
let i5 = 0;
function outcome(side, entryT, entry, stop, target) {
  const buy = side === 'buy', risk = Math.abs(entry - stop);
  while (i5 > 0 && c5[i5].t > entryT) i5--;
  while (i5 < c5.length && c5[i5].t < entryT) i5++;
  for (let k = i5; k < c5.length && c5[k].t < entryT + HOLD; k++) {
    const c = c5[k];
    const hitS = buy ? c.l <= stop : c.h >= stop, hitT = buy ? c.h >= target : c.l <= target;
    if (hitS) return { result: 'stop', R: -1, mins: (c.t - entryT) / 6e4 };
    if (hitT) return { result: 'target', R: Math.abs(target - entry) / risk, mins: (c.t - entryT) / 6e4 };
  }
  const last = c5[Math.min(c5.length - 1, i5 + HOLD / M5)];
  return { result: 'open', R: (buy ? last.c - entry : entry - last.c) / risk, mins: null };
}

// Walk each month's levels through the 15-minute candles.
const trades = [];
let setups = 0, breakdowns = 0, timeouts = 0, noTarget = 0;
for (const blk of levelsBy) {
  const cs = c15.filter(c => c.t >= blk.from && c.t < blk.to);
  const lv = blk.levels;
  for (const L of lv) {
    const upNext = lv.filter(x => x > L).sort((a, b) => a - b)[0], dnNext = lv.filter(x => x < L).sort((a, b) => b - a)[0];
    let pos = null; // which side of L the last close was on
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (pos === null) { pos = c.c >= L ? 'above' : 'below'; continue; }
      const side = pos === 'above' && c.l < L ? 'buy' : pos === 'below' && c.h > L ? 'sell' : null;
      if (!side) { pos = c.c >= L ? 'above' : 'below'; continue; }
      // A cross: follow it until it confirms, breaks down or times out.
      setups++;
      const buy = side === 'buy', target = buy ? upNext : dnNext, t0 = c.t;
      let ext = buy ? c.l : c.h;
      const pending = { reclaim: true, bounce: true, flow: c.t >= flowFrom };
      let j = i, ended = false;
      for (; j < cs.length && cs[j].t - t0 <= WINDOW; j++) {
        const k = cs[j], before = ext;
        ext = buy ? Math.min(ext, k.l) : Math.max(ext, k.h);
        if ((buy ? (L - ext) / L : (ext - L) / L) * 100 > DEPTH) { breakdowns++; ended = true; break; }
        const enter = (how, T, entry, extreme) => {
          pending[how] = false;
          if (!target) { noTarget++; return; }
          for (const b of BUFFERS) {
            const stop = buy ? extreme * (1 - b / 100) : extreme * (1 + b / 100);
            if (buy ? !(entry > stop && entry < target) : !(entry < stop && entry > target)) continue;
            trades.push({ how, buffer: b, side, level: L, target, t0, T, entry, stop, ext: extreme, rr: Math.abs(target - entry) / Math.abs(entry - stop), depth: Math.abs(extreme - L) / L * 100,
              recent: t0 >= flowFrom, out: outcome(side, T, entry, stop, target) });
          }
        };
        // bounce: off the extreme seen before this candle (a new extreme inside it waits for the next one)
        if (pending.bounce && j > i) {
          const lvl = buy ? before * (1 + BOUNCE / 100) : before * (1 - BOUNCE / 100);
          if (buy ? k.h >= lvl && k.l >= before : k.l <= lvl && k.h <= before) enter('bounce', k.t, lvl, before);
        }
        if (pending.reclaim && (buy ? k.c > L : k.c < L)) enter('reclaim', k.t + M15, k.c, ext);
        if (pending.flow) {
          const f = flowMap.get(k.t), near = buy ? k.l <= ext * 1.003 : k.h >= ext * 0.997;
          if (f && near && (buy ? k.c > k.o : k.c < k.o) && (buy ? f.buy : f.sell) >= 0.55 * (f.buy + f.sell)) enter('flow', k.t + M15, k.c, ext);
        }
        if (!pending.reclaim && !pending.bounce && !pending.flow) { ended = true; break; }
      }
      if (!ended) timeouts++;
      // Re-arm only after price is back on one side of the level.
      i = Math.max(i, j);
      pos = cs[Math.min(i, cs.length - 1)].c >= L ? 'above' : 'below';
    }
  }
}

// Costs: about 0.1% of the price for the round trip (taker fee in and out), in R.
const FEE = 0.1;
const netR = x => x.out.R - FEE / 100 * x.entry / Math.abs(x.entry - x.stop);
function stats(list) {
  const n = list.length, R = list.reduce((a, x) => a + netR(x), 0);
  const tg = list.filter(x => x.out.result === 'target').length, sp = list.filter(x => x.out.result === 'stop').length;
  const rr = n ? list.slice().map(x => x.rr).sort((a, b) => a - b)[Math.floor(n / 2)] : 0;
  let streak = 0, worst = 0;
  list.slice().sort((a, b) => a.T - b.T).forEach(x => { if (netR(x) < 0) { streak++; worst = Math.max(worst, streak); } else streak = 0; });
  const top = list.map(netR).sort((a, b) => b - a).slice(0, 10).reduce((a, b) => a + b, 0);
  return { n, tg, sp, win: n ? tg / n : 0, avgR: n ? R / n : 0, totalR: R, rr, worst, top };
}
const fmt = s => s.n ? `${String(s.n).padStart(4)} trades  target first ${String(s.tg).padStart(3)} (${(s.win * 100).toFixed(0).padStart(2)}%)  typical reward:risk ${s.rr.toFixed(1)}  after costs avg ${s.avgR >= 0 ? '+' : ''}${s.avgR.toFixed(2)}R total ${s.totalR >= 0 ? '+' : ''}${s.totalR.toFixed(0)}R  (top 10 wins ${s.top.toFixed(0)}R, worst losing run ${s.worst})` : '   0 trades';
console.log(`\n${setups} level crosses; ${breakdowns} ran more than ${DEPTH}% past (real breaks), ${timeouts} never confirmed in 48 h, ${noTarget} entries with no level beyond to aim at`);
const years = [...new Set(trades.map(x => new Date(x.T).getUTCFullYear()))].sort();
for (const minDepth of [0, 0.3]) {
  const pool = trades.filter(x => x.depth >= minDepth);
  console.log(`\n######## crosses that went ${minDepth ? 'at least ' + minDepth + '%' : 'any distance'} past the level ########`);
  for (const scope of [['all', 'Whole period (' + ymd(START) + ' to now)', x => true], ['recent', 'Last ~180 days (when buy/sell volume exists)', x => x.recent]]) {
    console.log(`\n== ${scope[1]} ==`);
    for (const how of ['reclaim', 'bounce', 'flow']) {
      if (how === 'flow' && scope[0] === 'all') continue;
      for (const b of BUFFERS) {
        const L = pool.filter(x => x.how === how && x.buffer === b && scope[2](x));
        console.log(`  ${how.padEnd(7)} stop ${b ? b + '% past' : 'at'} the extreme: ${fmt(stats(L))}`);
        for (const sd of ['buy', 'sell']) console.log(`      ${sd.padEnd(4)} ${fmt(stats(L.filter(x => x.side === sd)))}`);
        if (scope[0] === 'all' && b === 0) console.log('      by year: ' + years.map(y => { const st = stats(L.filter(x => new Date(x.T).getUTCFullYear() === y)); return `${y} ${st.n} tr ${st.avgR >= 0 ? '+' : ''}${st.avgR.toFixed(2)}R`; }).join(' | '));
      }
    }
  }
}
const ex = trades.filter(x => x.t0 >= Date.UTC(2026, 9, 29) && x.t0 < Date.UTC(2026, 9, 31) && x.buffer === 0);
if (ex.length) {
  console.log('\nThe owner\'s Oct 30 example:');
  ex.forEach(x => console.log(`  ${x.how.padEnd(7)} ${x.side.toUpperCase()} level ${px(x.level)}  crossed ${new Date(x.t0).toISOString().slice(5, 16)}  in ${new Date(x.T).toISOString().slice(5, 16)} at ${px(x.entry)}  stop ${px(x.stop)}  target ${px(x.target)} (${x.rr.toFixed(1)}R)  -> ${x.out.result} ${x.out.R >= 0 ? '+' : ''}${x.out.R.toFixed(2)}R`));
}
writeFileSync(join(CACHE, 'levels-reversal-' + MODE + '.json'), JSON.stringify({ levelsBy, setups, breakdowns, timeouts, noTarget, trades }, null, 1));
