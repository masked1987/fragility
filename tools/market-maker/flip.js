// The flip: the one entry from the Market Maker reading that tested well
// (test/mm-backtest.mjs, asked 2 Nov 2026 "add the flip to the Market Maker tab").
// The hour dealers turn losing (dealerSide(), 7-day gap below −5 points with the
// 1-point buffer), trade the way price went over the last 24 hours: stop ½ of the
// day's implied move, target 2 day's moves, out at the close after 3 days.
// One trade at a time. Pure functions: no fetching, no DOM; the backtest runs the same code.
import { realizedVol, dailyMove } from './model.js';
import { dealerSide } from './read.js';

const H = 36e5;

// hours: hourly candles, oldest first, { t (open time), close, high, low }; finished
// ones only. iv: Map of DVOL by hour open time. One reading per hour, at its close
// (t = open time + 1 h), once a week of history and a day for the 24h figures are in.
export function readings(iv, hours, cfg) {
  const rvH = cfg.rvDays * 24, out = [];
  let side = null; // the first reading has no "before", so it can't be a flip
  for (let i = rvH + 24; i < hours.length; i++) {
    const p = hours[i], v = iv.get(p.t);
    if (v == null) continue;
    let s = 0, n = 0;
    for (let j = i - rvH + 1; j <= i; j++) { const x = iv.get(hours[j].t); if (x != null) { s += x; n++; } }
    const gap = s / n - realizedVol(hours, i, rvH);
    const prev = side;
    side = dealerSide(gap, side, cfg);
    const before = prev == null ? side : prev;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - 24; j < i; j++) { hi = Math.max(hi, hours[j].high); lo = Math.min(lo, hours[j].low); }
    const v24 = iv.get(hours[i - 24].t);
    out.push({ t: p.t + H, price: p.close, iv: v, m: dailyMove(v) / 100, gap: gap, side: side, prev: before, hi: hi, lo: lo,
      ret24: p.close / hours[i - 24].close - 1, dIv: v24 == null ? 0 : v - v24 });
  }
  return out;
}

// The trade from a reading where dealers just turned losing, or null.
export function flipSignal(r, f) {
  if (r.side !== 'lose' || r.prev === 'lose') return null;
  const buy = r.ret24 >= 0, risk = f.stopMoves * r.m * r.price, reward = f.targetMoves * r.m * r.price;
  return { t: r.t, buy: buy, entry: r.price, stop: buy ? r.price - risk : r.price + risk,
    target: buy ? r.price + reward : r.price - reward, move: r.m, ret24: r.ret24, gap: r.gap };
}

// Follow a trade on candles { t, high, low, close } of `ms` length (any size): stop first
// when one candle touches both; out at the close once maxHours have passed.
export function followFlip(g, candles, ms, maxHours) {
  let lo = 0, hi = candles.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (candles[m].t < g.t) lo = m + 1; else hi = m; }
  for (let k = lo; k < candles.length; k++) {
    const c = candles[k];
    if (g.buy ? c.low <= g.stop : c.high >= g.stop) return { result: 'stopped', exit: g.stop, at: c.t + ms };
    if (g.buy ? c.high >= g.target : c.low <= g.target) return { result: 'target', exit: g.target, at: c.t + ms };
    if (c.t + ms >= g.t + maxHours * H) return { result: 'time', exit: c.close, at: c.t + ms };
  }
  const c = candles[candles.length - 1];
  return { result: 'open', exit: c ? c.close : g.entry, at: c ? c.t + ms : g.t };
}

// Every flip in the readings, one trade at a time, followed on `candles`.
export function flipTrades(read, candles, ms, f) {
  const out = [];
  let busy = 0;
  for (const r of read) {
    if (r.t < busy) continue;
    const g = flipSignal(r, f);
    if (!g) continue;
    const tr = followFlip(g, candles, ms, f.maxHours);
    out.push(Object.assign(g, { trade: tr }));
    busy = tr.result === 'open' ? Infinity : tr.at;
  }
  return out;
}

// What the tab shows: the trade still running (open), else the last one, and where
// the reading stands now (how far the gap is from the −gapPts line).
export function flipState(iv, hours, cfg) {
  const f = cfg.flip, read = readings(iv, hours, cfg);
  if (!read.length) return null;
  const trades = flipTrades(read, hours, H, f);
  const last = trades[trades.length - 1] || null, now = read[read.length - 1];
  const losingSince = (function () {
    for (let i = read.length - 1; i >= 0; i--) if (read[i].side !== 'lose') return i + 1 < read.length ? read[i + 1].t : null;
    return read[0].side === 'lose' ? read[0].t : null;
  })();
  return { trades: trades, open: last && last.trade.result === 'open' ? last : null, last: last, now: now,
    losingSince: now.side === 'lose' ? losingSince : null, from: read[0].t };
}
