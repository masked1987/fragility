// GEX pivot + order-flow exhaustion tactic. Pure functions: no fetching, no DOM.
//
// The setup (short shown; long is the mirror image):
//   1. Pivot: a big dealer gamma node near the price, from the option chain.
//   2. Price comes back up to the pivot from below (a retest).
//   3. The pivot lines up with the session's value area high (volume profile).
//   4. Option premium leans bearish: more put premium bought than call premium.
//   5. Order flow at the retest: sellers step in, or buyers run out (exhaustion).
//   6. Dealer gamma: price below the gamma flip, so their hedging adds to drops.
// Dealer convention as everywhere on the site: dealers long calls, short puts.
import { bsGamma } from '../../shared/gamma.js';

const YEAR_MS = 365 * 864e5;

// Dollars of hedging per 1% move at each strike: calls positive, puts negative.
export function gexNodes(options, spot, now, rangePct) {
  const by = {};
  options.forEach(function (o) {
    const T = (o.expiry - now) / YEAR_MS;
    if (T <= 0 || Math.abs(o.strike / spot - 1) * 100 > rangePct) return;
    const g = bsGamma(spot, o.strike, T, o.iv) * o.oi * spot * spot * 0.01;
    const n = by[o.strike] || (by[o.strike] = { strike: o.strike, call: 0, put: 0, net: 0 });
    if (o.type === 'C') n.call += g; else n.put -= g;
    n.net = n.call + n.put;
  });
  return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.strike - b.strike; });
}

// Strike × expiry grid of net dealer gamma around the price (the "depth view").
export function gexGrid(options, spot, now, cfg) {
  const live = options.filter(function (o) { return o.expiry > now; });
  const expiries = Array.from(new Set(live.map(function (o) { return o.expiry; }))).sort(function (a, b) { return a - b; }).slice(0, cfg.heatExpiries);
  const strikes = Array.from(new Set(live.filter(function (o) { return expiries.indexOf(o.expiry) >= 0; }).map(function (o) { return o.strike; })))
    .sort(function (a, b) { return Math.abs(a - spot) - Math.abs(b - spot); }).slice(0, cfg.heatStrikes).sort(function (a, b) { return b - a; });
  const cell = {};
  live.forEach(function (o) {
    if (expiries.indexOf(o.expiry) < 0 || strikes.indexOf(o.strike) < 0) return;
    const g = bsGamma(spot, o.strike, (o.expiry - now) / YEAR_MS, o.iv) * o.oi * spot * spot * 0.01;
    const k = o.strike + '|' + o.expiry;
    cell[k] = (cell[k] || 0) + (o.type === 'C' ? g : -g);
  });
  return { expiries: expiries, strikes: strikes, at: function (s, e) { return cell[s + '|' + e] || 0; } };
}

// The pivot: among nodes within pivotRangePct holding at least pivotShare of the
// biggest one, the nearest to the price.
export function pickPivot(nodes, spot, cfg) {
  const near = nodes.filter(function (n) { return Math.abs(n.strike / spot - 1) * 100 <= cfg.pivotRangePct; });
  if (!near.length) return null;
  const top = Math.max.apply(null, near.map(function (n) { return Math.abs(n.net); }));
  if (!(top > 0)) return null;
  return near.filter(function (n) { return Math.abs(n.net) >= cfg.pivotShare * top; })
    .reduce(function (a, b) { return Math.abs(b.strike - spot) < Math.abs(a.strike - spot) ? b : a; });
}

// Volume profile of a session from 1-minute candles: each candle's volume spread
// evenly over its high-low range. Value area: grow out from the busiest row (POC)
// until it holds `share` of the volume.
export function profile(candles, rows, share) {
  if (!candles.length) return null;
  const lo = Math.min.apply(null, candles.map(function (c) { return c.l; }));
  const hi = Math.max.apply(null, candles.map(function (c) { return c.h; }));
  const size = (hi - lo) / rows || 1;
  const bins = [];
  for (let i = 0; i < rows; i++) bins.push({ lo: lo + i * size, hi: lo + (i + 1) * size, mid: lo + (i + 0.5) * size, usd: 0 });
  candles.forEach(function (c) {
    const a = Math.min(rows - 1, Math.floor((c.l - lo) / size)), b = Math.min(rows - 1, Math.floor((c.h - lo) / size));
    for (let i = a; i <= b; i++) bins[i].usd += c.usd / (b - a + 1);
  });
  const total = bins.reduce(function (s, x) { return s + x.usd; }, 0);
  let p = 0;
  bins.forEach(function (x, i) { if (x.usd > bins[p].usd) p = i; });
  let a = p, b = p, inside = bins[p].usd;
  while (inside < share * total && (a > 0 || b < rows - 1)) {
    const down = a > 0 ? bins[a - 1].usd : -1, up = b < rows - 1 ? bins[b + 1].usd : -1;
    if (up >= down) inside += bins[++b].usd; else inside += bins[--a].usd;
  }
  return { bins: bins, poc: bins[p].mid, vah: bins[b].hi, val: bins[a].lo, total: total, lo: lo, hi: hi };
}

// Net premium drift: running total of call and put premium bought (+) or sold (−).
// More put premium bought than call premium = bearish sentiment, and the reverse.
export function drift(trades, stepMs) {
  const tr = trades.slice().sort(function (a, b) { return a.t - b.t; });
  const series = [];
  let calls = 0, puts = 0, next = tr.length ? Math.floor(tr[0].t / stepMs) * stepMs + stepMs : 0;
  tr.forEach(function (t) {
    while (t.t >= next) { series.push({ t: next, calls: calls, puts: puts }); next += stepMs; }
    if (t.type === 'C') calls += t.dir * t.usd; else puts += t.dir * t.usd;
  });
  if (tr.length) series.push({ t: tr[tr.length - 1].t, calls: calls, puts: puts });
  return { series: series, calls: calls, puts: puts };
}

// A tidy row size for the footprint: about `rows` rows across the range.
export function niceStep(range, rows) {
  const raw = range / rows, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

// Footprint candles: per candle and price row, USD bought and sold by aggressors.
export function footprint(trades, candleMs, rowSize) {
  const by = {};
  trades.forEach(function (t) {
    const k = Math.floor(t.t / candleMs) * candleMs;
    const c = by[k] || (by[k] = { t: k, o: t.price, h: t.price, l: t.price, c: t.price, buy: 0, sell: 0, rows: {} });
    c.h = Math.max(c.h, t.price); c.l = Math.min(c.l, t.price); c.c = t.price;
    const r = Math.floor(t.price / rowSize) * rowSize;
    const row = c.rows[r] || (c.rows[r] = { price: r, buy: 0, sell: 0 });
    if (t.dir > 0) { row.buy += t.usd; c.buy += t.usd; } else { row.sell += t.usd; c.sell += t.usd; }
  });
  return Object.keys(by).map(function (k) {
    const c = by[k];
    c.delta = c.buy - c.sell;
    c.rows = Object.keys(c.rows).map(function (r) { return c.rows[r]; }).sort(function (a, b) { return b.price - a.price; });
    return c;
  }).sort(function (a, b) { return a.t - b.t; });
}

function median(a) { const s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[Math.floor(s.length / 2)] : 0; }

// What the order flow inside one candle says.
//   buyersExhausted: the top row saw almost no buying (buyers ran out at the high)
//     and the candle closed below that row.
//   sellersIn: sell imbalances (sell ≥ imbalance × buy) on 2+ rows in the upper
//     half, or 30%+ net selling in a candle with 4+ rows.
// Plus the mirror images for longs.
export function signals(c, cfg) {
  const rows = c.rows;
  if (rows.length < 3) return { buyersExhausted: false, sellersIn: false, sellersExhausted: false, buyersIn: false, tooThin: true };
  const med = median(rows.map(function (r) { return r.buy + r.sell; }));
  const top = rows[0], bottom = rows[rows.length - 1];
  const mid = (c.h + c.l) / 2;
  const vol = c.buy + c.sell;
  const upper = rows.filter(function (r) { return r.price >= mid; }), lower = rows.filter(function (r) { return r.price < mid; });
  const sellImb = upper.filter(function (r) { return r.sell > 0 && r.sell >= cfg.imbalance * r.buy; }).length;
  const buyImb = lower.filter(function (r) { return r.buy > 0 && r.buy >= cfg.imbalance * r.sell; }).length;
  return {
    buyersExhausted: top.buy <= cfg.exhaustShare * med && c.c < top.price,
    sellersIn: sellImb >= 2 || (c.delta <= -0.3 * vol && rows.length >= 4),
    sellersExhausted: bottom.sell <= cfg.exhaustShare * med && c.c >= bottom.price + (rows.length > 1 ? rows[rows.length - 2].price - bottom.price : 0),
    buyersIn: buyImb >= 2 || (c.delta >= 0.3 * vol && rows.length >= 4),
  };
}

// The checklist and trade levels. st:
//   spot, pivot ({ strike, net, call, put } or null), flip, nodes,
//   profile ({ poc, vah, val } or null), drift ({ calls, puts } or null), candles (footprint, oldest first)
export function setup(st, cfg) {
  const piv = st.pivot;
  if (!piv) return { status: 'none', side: null, checks: [] };
  const P = piv.strike, spot = st.spot;
  const side = spot < P ? 'short' : 'long';
  const short = side === 'short';
  const tol = P * cfg.levelTolPct / 100;
  const recent = (st.candles || []).slice(-cfg.retestCandles);
  const touches = recent.filter(function (c) { return short ? c.h >= P - tol : c.l <= P + tol; });
  const atLevel = touches.length > 0 && (short ? spot <= P + tol : spot >= P - tol);

  const sig = touches.map(function (c) { return signals(c, cfg); });
  const exhausted = sig.some(function (s) { return short ? s.buyersExhausted : s.sellersExhausted; });
  const stepping = sig.some(function (s) { return short ? s.sellersIn : s.buyersIn; });
  const flowOk = atLevel ? exhausted || stepping : null;

  const edge = st.profile ? (short ? st.profile.vah : st.profile.val) : null;
  const vaOk = edge == null ? null : Math.abs(P - edge) <= P * cfg.alignPct / 100;

  let driftOk = null;
  if (st.drift) {
    const gross = Math.abs(st.drift.calls) + Math.abs(st.drift.puts), diff = st.drift.calls - st.drift.puts;
    driftOk = gross > 0 ? (short ? diff <= -cfg.driftMinShare * gross : diff >= cfg.driftMinShare * gross) : null;
  }
  const gammaOk = st.flip ? (short ? spot < st.flip : spot > st.flip) : null;

  const support = [vaOk, driftOk, gammaOk].filter(function (x) { return x === true; }).length;
  const status = !atLevel ? 'waiting' : flowOk && support >= 2 ? 'ready' : 'building';

  // Levels: in at the retest, stop just past its extreme, targets the value area and gamma nodes.
  const extreme = touches.length
    ? (short ? Math.max.apply(null, touches.map(function (c) { return c.h; })) : Math.min.apply(null, touches.map(function (c) { return c.l; })))
    : (short ? P + tol : P - tol);
  const stop = short ? Math.max(extreme, P) * (1 + cfg.stopBufferPct / 100) : Math.min(extreme, P) * (1 - cfg.stopBufferPct / 100);
  const entry = atLevel ? spot : (short ? P - tol : P + tol);
  const risk = Math.abs(stop - entry);
  const cands = [];
  if (st.profile) {
    cands.push({ price: st.profile.poc, why: 'session point of control (busiest price)' });
    cands.push({ price: short ? st.profile.val : st.profile.vah, why: short ? 'value area low' : 'value area high' });
  }
  const maxNet = Math.max.apply(null, (st.nodes || []).map(function (n) { return Math.abs(n.net); }).concat([0]));
  (st.nodes || []).forEach(function (n) {
    if (n.strike !== P && Math.abs(n.net) >= 0.3 * maxNet) cands.push({ price: n.strike, why: 'gamma node (' + (n.net > 0 ? 'dealers long gamma: price tends to stall' : 'dealers short gamma: price can run through') + ')' });
  });
  const targets = cands.filter(function (t) { return short ? t.price < entry : t.price > entry; })
    .map(function (t) { return Object.assign(t, { r: Math.abs(t.price - entry) / risk }); })
    .filter(function (t) { return t.r >= cfg.minTargetR; })
    .sort(function (a, b) { return a.r - b.r; })
    .filter(function (t, i, arr) { return i === 0 || Math.abs(t.price - arr[i - 1].price) > tol * 2; })
    .slice(0, 2);

  return {
    side: side, status: status, pivot: P, tol: tol, atLevel: atLevel, touches: touches.length,
    entry: entry, stop: stop, risk: risk, targets: targets,
    checks: [
      { key: 'level', ok: atLevel },
      { key: 'flow', ok: flowOk, exhausted: exhausted, stepping: stepping },
      { key: 'va', ok: vaOk, edge: edge },
      { key: 'drift', ok: driftOk },
      { key: 'gamma', ok: gammaOk },
    ],
    support: support,
  };
}
