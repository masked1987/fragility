// Alt Tactics: the owner's own method. Pure functions: no fetching, no DOM; runs in Node.
//
//   1. Levels: only the huge gamma strikes (most open calls + puts).
//   2. Price was above a level and dips through it (any trade below counts).
//   3. The lowest price since the dip is the stop ("price doesn't revisit it when it
//      truly reverses"). More than maxDepthPct past = a real breakdown, no trade.
//   4. Entry when the Ichimoku score (5-minute) crosses up through 80: buyers are back.
//   5. Target: the biggest huge level up (cfg.target, pickTarget). Once per level: a level that was traded is not
//      traded again until price has crossed another level.
//   SELL only after a buy reached its target, at that level ("sells only after a
//   successful buy and vice versa"): a spike over it, the high is the stop, the score
//   crossing down through 20, target the next level down. Unproven: 6 such trades in
//   the 3-year backtest, all lost. A sell that reaches its target frees that level for a buy.
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

// Levels as [{ price, oi }] sorted by price; plain numbers are accepted (oi unknown).
function asLevels(levels) {
  return levels.map(function (x) { return typeof x === 'number' ? { price: x, oi: 0 } : x; })
    .sort(function (a, b) { return a.price - b.price; });
}

// The target from level L, going up (dir 1) or down (-1). cfg.target:
//   'next'    = the nearest huge level that way (the first version);
//   'biggest' = the huge level that way with the most open contracts (the owner: "huge
//               biggest level above", e.g. ~2,500 rather than ~2,300 from ~2,200).
// Levels closer than cfg.minTargetPct to L are skipped ("100 points is too small").
export function pickTarget(levels, L, dir, cfg) {
  const min = (cfg.minTargetPct || 0) / 100;
  const c = levels.filter(function (x) { return dir > 0 ? x.price >= L * (1 + min) && x.price > L : x.price <= L * (1 - min) && x.price < L; });
  if (!c.length) return null;
  const near = dir > 0 ? c : c.slice().reverse(); // nearest first, so a tie goes to the nearer one
  if (cfg.target === 'biggest') return near.reduce(function (a, b) { return b.oi > a.oi ? b : a; }).price;
  return near[0].price;
}

// Every cross through every level, followed until it confirms (signal), breaks
// through, lapses, or the data ends (still waiting). BUY: price was above a level and
// dips below it; the low is the stop; the Ichimoku score crossing up through scoreBuy
// confirms; target the next level up. SELL (the mirror, asked for later): price was
// below a level and spikes above it; the high is the stop; the score crossing down
// through scoreSell confirms; target the next level down. c5 = 5-minute candles
// { t, h, l, c } oldest first; levels = [numbers].
export function findSetups(c5, levels, cfg) {
  const c15 = to15(c5), ich = ichimoku(c5), bar = cfg.candleMinutes * 6e4, win = cfg.windowHours * 36e5;
  const all = asLevels(levels), lv = all.map(function (x) { return x.price; });
  const out = [];
  lv.forEach(function (L) {
    const up = pickTarget(all, L, 1, cfg), down = pickTarget(all, L, -1, cfg);
    let pos = null;
    for (let i = 0; i < c15.length; i++) {
      const c = c15[i];
      if (pos === null) { pos = c.c >= L ? 'above' : 'below'; continue; }
      const side = pos === 'above' && c.l < L ? 'buy' : pos === 'below' && c.h > L ? 'sell' : null;
      if (!side) { pos = c.c >= L ? 'above' : 'below'; continue; }
      const buy = side === 'buy', t0 = c.t;
      const s = { side: side, level: L, target: buy ? up : down, t0: t0, ext: buy ? Infinity : -Infinity, extT: null, state: 'waiting', signal: null };
      let k = c5.findIndex(function (x) { return x.t >= t0; }), endT = null;
      for (; k >= 0 && k < c5.length && c5[k].t - t0 <= win; k++) {
        const x = c5[k];
        if (buy ? x.l < s.ext : x.h > s.ext) { s.ext = buy ? x.l : x.h; s.extT = x.t; }
        if ((buy ? L - s.ext : s.ext - L) / L * 100 > cfg.maxDepthPct) { s.state = 'broken'; endT = x.t; break; }
        const a = ich[k - 1], b = ich[k];
        if (a && b && (buy ? a.score < cfg.scoreBuy && b.score >= cfg.scoreBuy : a.score > cfg.scoreSell && b.score <= cfg.scoreSell)) {
          s.state = 'signal';
          const risk = Math.abs(x.c - s.ext);
          s.signal = { t: x.t + bar, entry: x.c, stop: s.ext, target: s.target, rr: s.target && risk > 0 ? Math.abs(s.target - x.c) / risk : null };
          endT = x.t;
          break;
        }
      }
      if (s.state === 'waiting' && k < c5.length) { s.state = 'lapsed'; endT = c5[Math.min(k, c5.length - 1)].t; }
      s.depth = isFinite(s.ext) ? Math.abs(s.ext - L) / L * 100 : 0;
      s.low = s.ext; s.lowT = s.extT; // older name, kept for the BUY side
      out.push(s);
      if (endT === null) break; // still waiting at the end of the data
      while (i + 1 < c15.length && c15[i + 1].t <= endT) i++;
      pos = c15[i].c >= L ? 'above' : 'below';
    }
  });
  return out.sort(function (a, b) { return a.t0 - b.t0; });
}

// What happened after a signal: target first, stop first, or still open.
export function follow(sig, c5, side) {
  const buy = side !== 'sell';
  for (let k = 0; k < c5.length; k++) {
    const x = c5[k];
    if (x.t < sig.t) continue;
    if (buy ? x.l <= sig.stop : x.h >= sig.stop) return { result: 'stopped', at: x.t };
    if (sig.target && (buy ? x.h >= sig.target : x.l <= sig.target)) return { result: 'target', at: x.t };
  }
  return { result: 'open', at: null };
}

// Once per level (either side): a level whose setup was traded is skipped until that
// trade has ended and price has crossed another level. Marks setups taken / used.
// The owner's rule for the other side: "I look for sells only after a successful buy
// and vice versa". So a SELL is only taken at the level a buy just reached as its
// target (the sell's cross starts within afterWinHours of the target hit); other sell
// setups are marked noWin. And when a sell reaches its target, that level is open for
// a buy again straight away. Buys need nothing first (his main method).
// sides: which sides to trade, default both.
export function oncePerLevel(setups, c5, sides, cfg) {
  const armed = {}, endAt = {}, ok = sides || { buy: true, sell: true };
  const after = ((cfg && cfg.afterWinHours) || 48) * 36e5, bar15 = 9e5;
  const wins = []; // { side, level, at }: trades that reached their target
  setups.forEach(function (s) {
    Object.keys(endAt).forEach(function (L) {
      if (+L !== s.level && endAt[L] !== null && endAt[L] < s.t0) { armed[L] = true; delete endAt[L]; }
    });
    wins.forEach(function (w) { if (w.side === 'sell' && !w.freed && w.at < s.t0 + bar15) { armed[w.level] = true; delete endAt[w.level]; w.freed = true; } });
    if (!ok[s.side]) return;
    if (s.side === 'sell') {
      // The cross may be in the same 15-minute candle that hit the buy's target.
      s.win = wins.filter(function (w) { return w.side === 'buy' && w.level === s.level && w.at < s.t0 + bar15 && s.t0 - w.at <= after; }).pop() || null;
      if (!s.win) { s.noWin = true; return; }
    }
    if (armed[s.level] === false) { s.used = true; return; }
    const g = s.signal, buy = s.side === 'buy';
    if (s.state === 'signal' && g.target && (buy ? g.entry > g.stop && g.entry < g.target : g.entry < g.stop && g.entry > g.target)) {
      s.taken = true;
      s.trade = follow(g, c5, s.side);
      armed[s.level] = false;
      endAt[s.level] = s.trade.at; // null while open: stays used
      if (s.trade.result === 'target') wins.push({ side: s.side, level: g.target, from: s.level, at: s.trade.at });
    }
  });
  // Levels still used at the end: no new trade there until price crosses another level
  // (the owner: "if price hit my SL we only re-enter, by all our rules, at the next gamma level").
  setups.locked = Object.keys(armed).filter(function (L) { return armed[L] === false; }).map(Number);
  return setups;
}

// The tab's verdict: BUY / SELL while a taken trade is open (the latest one), WATCH
// while a cross waits for its confirmation, else WAIT. Also the huge levels around the price.
export function decideAlt(c5, levels, cfg) {
  const setups = oncePerLevel(findSetups(c5, levels, cfg), c5, cfg.sides, cfg);
  const ich = ichimoku(c5), now = ich[ich.length - 1];
  const spot = c5.length ? c5[c5.length - 1].c : null;
  const open = setups.filter(function (s) { return s.taken && s.trade.result === 'open'; }).pop() || null;
  const waiting = setups.filter(function (s) { return s.state === 'waiting' && !s.used && !s.noWin && (!cfg.sides || cfg.sides[s.side]); }).pop() || null;
  const lv = asLevels(levels).map(function (x) { return x.price; });
  const below = lv.filter(function (L) { return L <= spot; }).pop() || null;
  const above = lv.filter(function (L) { return L > spot; })[0] || null;
  // A buy that reached its target lately: a sell at that level is allowed until `until`
  // (only shown while no sell setup has started there yet).
  const lastT = c5.length ? c5[c5.length - 1].t : 0, after = (cfg.afterWinHours || 48) * 36e5;
  const won = setups.filter(function (s) {
    return s.taken && s.side === 'buy' && s.trade.result === 'target' && lastT - s.trade.at <= after &&
      !setups.some(function (x) { return x.side === 'sell' && x.level === s.signal.target && x.t0 + 9e5 > s.trade.at && (x.taken || (x.state === 'waiting' && !x.used)); });
  }).pop();
  const sellReady = won && (!cfg.sides || cfg.sides.sell) ? { level: won.signal.target, from: won.level, at: won.trade.at, until: won.trade.at + after } : null;
  // After a stop the level is used: the next buy can only come from a dip through
  // another huge level. nextBuy = the nearest level at or under the price still open.
  const locked = setups.locked || [];
  const stopped = setups.filter(function (s) { return s.taken && s.side === 'buy' && s.trade.result === 'stopped' && locked.indexOf(s.level) >= 0; }).pop() || null;
  const nextBuy = lv.filter(function (L) { return L <= spot && locked.indexOf(L) < 0; }).pop() || null;
  const action = open ? open.side : waiting ? 'watch' : 'wait';
  return { action: action, open: open, waiting: waiting, setups: setups, ichimoku: now, spot: spot, below: below, above: above, sellReady: sellReady,
    locked: locked, stopped: stopped, nextBuy: nextBuy };
}
