// Trend tab: the 50-day average rule (asked 2 Nov 2026, from the outside-strategies
// test, test/outside-strategies.mjs). Pure, runs in Node.
//   Once a day, at the daily close (00:00 UTC): close above the 50-day average = own
//   the coin (IN); close below = cash (OUT). Long only, no stop, no target.
// candles: finished daily candles, oldest first, { t: open time (00:00 UTC), close }.

export const DAY = 864e5;

export function sma(closes, i, n) {
  if (i < n - 1) return NaN;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += closes[k];
  return s / n;
}

// The daily states, the trades (buy at the close that crossed up, sell at the close that
// crossed down) and the compounded result vs holding, from the first day with an average.
export function trend(candles, n, costSide) {
  const C = candles.map(function (c) { return c.close; });
  const states = [], trades = [];
  let open = null, prev = null, eq = 1, peak = 1, dd = 0;
  for (let i = n - 1; i < candles.length; i++) {
    const avg = sma(C, i, n), on = C[i] > avg, at = candles[i].t + DAY;  // the close happens at the end of the candle
    if (prev !== null) {
      if (prev.on) eq *= C[i] / C[i - 1];
      if (on !== prev.on) eq *= 1 - costSide;
      peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
    }
    if (prev !== null && on && !prev.on) open = { t: at, price: C[i] };
    if (prev !== null && !on && prev.on && open) {
      trades.push({ buy: open, sell: { t: at, price: C[i] }, pct: (C[i] / open.price * (1 - costSide) * (1 - costSide) - 1) * 100 });
      open = null;
    }
    const st = { t: at, close: C[i], avg: avg, on: on };
    states.push(st);
    prev = st;
  }
  const last = states[states.length - 1], first = states[0];
  // Since when the current state holds.
  let k = states.length - 1;
  while (k > 0 && states[k - 1].on === last.on) k--;
  // Tonight's line: the price today's close has to beat for today's close to sit above
  // its own 50-day average = the average of the last n−1 finished closes.
  let s49 = 0;
  for (let j = C.length - (n - 1); j < C.length; j++) s49 += C[j];
  const line = s49 / (n - 1);
  const slope = states.length > 5 ? (last.avg / states[states.length - 6].avg - 1) * 100 : 0;  // % change of the average over 5 days
  return {
    states: states,
    trades: trades,
    open: open,                                   // { t, price } while IN since a crossing we saw
    on: last.on,
    since: { t: states[k].t, price: states[k].close, crossed: k > 0 },
    close: last.close,
    avg: last.avg,
    distPct: (last.close / last.avg - 1) * 100,
    line: line,
    slope: slope,
    lastClose: last.t,
    result: { total: (eq - 1) * 100, hold: (last.close / first.close - 1) * 100, dd: dd * 100, from: first.t, trades: trades.length + (open ? 1 : 0) },
  };
}

// What the price now means for tonight's close: would it flip the state?
export function tonight(m, price) {
  const above = price > m.line;
  return { above: above, flips: above !== m.on, gapPct: (m.line / price - 1) * 100 };
}
