// Alt Tactics: the owner's own method. Pure functions: no fetching, no DOM; runs in Node.
//
//   1. Levels: only the huge gamma strikes (most open calls + puts).
//   2. Price was above a level and dips through it (any trade below counts).
//   3. The lowest price since the dip is the stop ("price doesn't revisit it when it
//      truly reverses"). More than maxDepthPct past = a real breakdown, no trade.
//   4. Entry when the Ichimoku score (5-minute) crosses up through 80: buyers are back.
//   5. Target: the next huge level up. Once per level: a level that was traded is not
//      traded again until price has crossed another level.
// Mirrors test/levels-reversal.mjs (cross on 15-minute candles, signal on 5-minute).

const DAY = 864e5;

// Huge levels: [{ price, oi, share }] sorted by price.
export function pickHuge(options, spot, now, cfg) {
  const by = {};
  options.forEach(function (o) {
    if (o.expiry - now <= cfg.minDays * DAY || Math.abs(o.strike / spot - 1) * 100 > cfg.rangePct) return;
    by[o.strike] = (by[o.strike] || 0) + o.oi;
  });
  const rows = Object.keys(by).map(function (k) { return { price: +k, oi: by[k] }; }).sort(function (a, b) { return b.oi - a.oi; });
  const top = rows.length ? rows[0].oi : 0, out = [];
  rows.forEach(function (r) {
    if (!(top > 0) || r.oi < cfg.hugeShare * top) return;
    if (out.some(function (x) { return Math.abs(x.price / r.price - 1) * 100 < cfg.minGapPct; })) return;
    out.push({ price: r.price, oi: r.oi, share: r.oi / top });
  });
  return out.sort(function (a, b) { return a.price - b.price; });
}

// Ichimoku score, 0–100: 20 points for each bullish condition on candle i —
// close above Tenkan (9-bar midpoint), Tenkan above Kijun (26), close above the cloud,
// cloud bullish (Span A above Span B), lagging close above the close 26 bars back.
// Returns [{ score, parts: { tenkan, cross, cloud, green, lag } } | null].
export function ichimoku(c) {
  const mid = function (i, n) {
    let hi = -Infinity, lo = Infinity;
    for (let k = i - n + 1; k <= i; k++) { hi = Math.max(hi, c[k].h); lo = Math.min(lo, c[k].l); }
    return (hi + lo) / 2;
  };
  return c.map(function (x, i) {
    if (i < 78) return null;
    const ten = mid(i, 9), kij = mid(i, 26), j = i - 26;
    const spanA = (mid(j, 9) + mid(j, 26)) / 2, spanB = mid(j, 52);
    const parts = { tenkan: x.c > ten, cross: ten > kij, cloud: x.c > Math.max(spanA, spanB), green: spanA > spanB, lag: x.c > c[j].c };
    const score = 20 * Object.keys(parts).filter(function (k) { return parts[k]; }).length;
    return { score: score, parts: parts, tenkan: ten, kijun: kij, spanA: spanA, spanB: spanB };
  });
}

// Complete 15-minute candles from 5-minute ones.
export function to15(c5) {
  const by = new Map();
  c5.forEach(function (c) {
    const k = Math.floor(c.t / 9e5) * 9e5, x = by.get(k);
    if (!x) by.set(k, { t: k, h: c.h, l: c.l, c: c.c, n: 1 });
    else { x.h = Math.max(x.h, c.h); x.l = Math.min(x.l, c.l); x.c = c.c; x.n++; }
  });
  return Array.from(by.values()).filter(function (x) { return x.n === 3; }).sort(function (a, b) { return a.t - b.t; });
}

// Every dip through every level in the candles, followed until it confirms (signal),
// breaks down, lapses, or the data ends (still waiting). c5 = 5-minute candles
// { t, h, l, c } oldest first; levels = [numbers].
export function findSetups(c5, levels, cfg) {
  const c15 = to15(c5), ich = ichimoku(c5), bar = cfg.candleMinutes * 6e4, win = cfg.windowHours * 36e5;
  const lv = levels.slice().sort(function (a, b) { return a - b; });
  const out = [];
  lv.forEach(function (L) {
    const target = lv.filter(function (x) { return x > L; })[0] || null;
    let pos = null;
    for (let i = 0; i < c15.length; i++) {
      const c = c15[i];
      if (pos === null) { pos = c.c >= L ? 'above' : 'below'; continue; }
      if (!(pos === 'above' && c.l < L)) { pos = c.c >= L ? 'above' : 'below'; continue; }
      const t0 = c.t, s = { level: L, target: target, t0: t0, low: Infinity, lowT: null, state: 'waiting', signal: null };
      let k = c5.findIndex(function (x) { return x.t >= t0; }), endT = null;
      for (; k >= 0 && k < c5.length && c5[k].t - t0 <= win; k++) {
        const x = c5[k];
        if (x.l < s.low) { s.low = x.l; s.lowT = x.t; }
        if ((L - s.low) / L * 100 > cfg.maxDepthPct) { s.state = 'broken'; endT = x.t; break; }
        const a = ich[k - 1], b = ich[k];
        if (a && b && a.score < cfg.scoreBuy && b.score >= cfg.scoreBuy) {
          s.state = 'signal';
          s.signal = { t: x.t + bar, entry: x.c, stop: s.low, target: target, rr: target && x.c > s.low ? (target - x.c) / (x.c - s.low) : null };
          endT = x.t;
          break;
        }
      }
      if (s.state === 'waiting' && k < c5.length) { s.state = 'lapsed'; endT = c5[Math.min(k, c5.length - 1)].t; }
      s.depth = isFinite(s.low) ? (L - s.low) / L * 100 : 0;
      out.push(s);
      if (endT === null) break; // still waiting at the end of the data
      while (i + 1 < c15.length && c15[i + 1].t <= endT) i++;
      pos = c15[i].c >= L ? 'above' : 'below';
    }
  });
  return out.sort(function (a, b) { return a.t0 - b.t0; });
}

// What happened after a signal: target first, stop first, or still open.
export function follow(sig, c5) {
  for (let k = 0; k < c5.length; k++) {
    const x = c5[k];
    if (x.t < sig.t) continue;
    if (x.l <= sig.stop) return { result: 'stopped', at: x.t };
    if (sig.target && x.h >= sig.target) return { result: 'target', at: x.t };
  }
  return { result: 'open', at: null };
}

// Once per level: a level whose setup was traded is skipped until that trade has
// ended and price has dipped through another level. Marks setups taken / used.
export function oncePerLevel(setups, c5) {
  const armed = {}, endAt = {};
  setups.forEach(function (s) {
    Object.keys(endAt).forEach(function (L) {
      if (+L !== s.level && endAt[L] !== null && endAt[L] < s.t0) { armed[L] = true; delete endAt[L]; }
    });
    if (armed[s.level] === false) { s.used = true; return; }
    if (s.state === 'signal' && s.signal.target && s.signal.entry > s.signal.stop && s.signal.entry < s.signal.target) {
      s.taken = true;
      s.trade = follow(s.signal, c5);
      armed[s.level] = false;
      endAt[s.level] = s.trade.at; // null while open: stays used
    }
  });
  return setups;
}

// The tab's verdict. BUY while a taken trade is open, WATCH while a dip waits for its
// confirmation, else WAIT. Also the nearest huge levels around the price.
export function decideAlt(c5, levels, cfg) {
  const setups = oncePerLevel(findSetups(c5, levels, cfg), c5);
  const ich = ichimoku(c5), now = ich[ich.length - 1];
  const spot = c5.length ? c5[c5.length - 1].c : null;
  const open = setups.filter(function (s) { return s.taken && s.trade.result === 'open'; }).pop() || null;
  const waiting = setups.filter(function (s) { return s.state === 'waiting' && !s.used; }).pop() || null;
  const below = levels.filter(function (L) { return L <= spot; }).pop() || null;
  const above = levels.filter(function (L) { return L > spot; })[0] || null;
  const action = open ? 'buy' : waiting ? 'watch' : 'wait';
  return { action: action, open: open, waiting: waiting, setups: setups, ichimoku: now, spot: spot, below: below, above: above };
}
