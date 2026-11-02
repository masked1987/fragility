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
    // line = the next close's line: the average of the last n−1 closes up to this one.
    let l = 0; for (let j = i - n + 2; j <= i; j++) l += C[j];
    const st = { t: at, close: C[i], avg: avg, on: on, line: l / (n - 1) };
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

// Phone alert events (asked 2 Nov 2026: "alerts when to enter, what's TP and stop loss";
// kept as tested: the stop is a daily close under the line, no take profit).
// prev = { at: time of the last close already seen, on } from the job's state, or null.
// Returns the crossings since then (BUY / SELL, newest last, none older than maxAge),
// whether to send the quiet daily "tonight's line" update (IN, a new close, no BUY now),
// and the state to save.
export function trendEvents(m, prev, now, maxAge) {
  const events = [];
  if (prev) {
    let on = prev.on;
    m.states.forEach(function (s) {
      if (s.t <= prev.at || s.on === on) return;
      on = s.on;
      if (now - s.t > maxAge) return;
      const trade = s.on ? null : m.trades.filter(function (t) { return t.sell.t === s.t; })[0] || null;
      events.push({ kind: s.on ? 'buy' : 'sell', t: s.t, close: s.close, avg: s.avg, line: s.line, trade: trade, key: (s.on ? 'buy-' : 'sell-') + s.t });
    });
  }
  const newClose = !!prev && m.lastClose > prev.at;
  const daily = newClose && m.on && !events.some(function (e) { return e.kind === 'buy' && e.t === m.lastClose; });
  return { events: events, daily: daily, next: { at: m.lastClose, on: m.on } };
}
