// Estimate where leveraged positions would be force-closed, and line that up
// with dealer gamma. Pure functions: no fetching, no DOM.
//
// Method, per hour of history:
//  1. OI fell  -> some positions closed: shrink every tracked position pro rata.
//  2. Price traded through a liquidation price -> those positions are gone.
//  3. OI rose  -> new positions opened at that hour's price, split long/short
//     by the taker buy share and spread across the assumed leverage mix.
// What remains are positions still open and not yet liquidated.
import { bsGamma, gex } from '../../shared/gamma.js';

const YEAR_MS = 365 * 864e5;

export function estimateBook(hours, cfg) {
  let book = [];
  const lo = cfg.buyShareClamp[0], hi = cfg.buyShareClamp[1];
  for (let i = 1; i < hours.length; i++) {
    const h = hours[i], prev = hours[i - 1];
    const d = h.oiCoins - prev.oiCoins;
    if (d < 0 && prev.oiCoins > 0) {
      const keep = Math.max(0, 1 + d / prev.oiCoins);
      book.forEach(function (b) { b.coins *= keep; });
    }
    book = book.filter(function (b) { return b.side === 'long' ? b.px < h.low : b.px > h.high; });
    if (d > 0) {
      const longShare = Math.min(hi, Math.max(lo, h.buyShare));
      cfg.leverage.forEach(function (tier) {
        const move = 1 / tier.x - cfg.maintenanceMargin;
        book.push({ side: 'long', px: h.price * (1 - move), coins: d * longShare * tier.w });
        book.push({ side: 'short', px: h.price * (1 + move), coins: d * (1 - longShare) * tier.w });
      });
    }
  }
  return book;
}

// Bucket the book (scaled to the whole market) and option gamma onto one ladder.
export function buildLadder(book, options, spot, now, scale, cfg) {
  const step = spot * cfg.binPct / 100;
  const half = Math.round(cfg.rangePct / cfg.binPct);
  const bins = [];
  for (let i = -half; i < half; i++) {
    bins.push({ lo: spot + i * step, hi: spot + (i + 1) * step, longUsd: 0, shortUsd: 0, gamma: 0 });
  }
  const first = bins[0].lo;
  function binAt(px) {
    const i = Math.floor((px - first) / step);
    return i >= 0 && i < bins.length ? bins[i] : null;
  }
  book.forEach(function (b) {
    const bin = binAt(b.px);
    if (!bin) return;
    const usd = b.coins * b.px * scale;
    if (b.side === 'long') bin.longUsd += usd; else bin.shortUsd += usd;
  });
  // Net dealer gamma by strike at today's spot (calls +, puts -), USD per 1% move.
  (options || []).forEach(function (o) {
    const bin = binAt(o.strike);
    const T = (o.expiry - now) / YEAR_MS;
    if (!bin || T <= 0) return;
    const g = bsGamma(spot, o.strike, T, o.iv) * o.oi * spot * spot * 0.01;
    bin.gamma += o.type === 'C' ? g : -g;
  });
  bins.forEach(function (b) { b.mid = (b.lo + b.hi) / 2; });
  return bins;
}

// Largest and nearest-big cluster on each side of spot.
export function clusters(bins, spot, options, now, cfg) {
  function side(key, below) {
    const list = bins.filter(function (b) { return below ? b.hi <= spot : b.lo >= spot; })
      .filter(function (b) { return b[key] > 0; });
    if (!list.length) return null;
    const largest = list.reduce(function (a, b) { return b[key] > a[key] ? b : a; });
    const big = list.filter(function (b) { return b[key] >= largest[key] * cfg.bigClusterShare; });
    const nearest = big.reduce(function (a, b) { return Math.abs(b.mid - spot) < Math.abs(a.mid - spot) ? b : a; });
    return [nearest, largest].filter(function (b, i, arr) { return arr.indexOf(b) === i; }).map(function (b) {
      return {
        price: b.mid,
        usd: b[key],
        pct: (b.mid / spot - 1) * 100,
        // Would dealers amplify (short gamma) or absorb (long gamma) a move to here?
        gammaThere: options && options.length ? gex(options, b.mid, now).net : null,
        largest: b === largest,
      };
    });
  }
  return { longs: side('longUsd', true), shorts: side('shortUsd', false) };
}

export function lastDayLiquidations(hours) {
  const day = hours.slice(-24);
  return {
    longUsd: day.reduce(function (a, h) { return a + h.longLiqUsd; }, 0),
    shortUsd: day.reduce(function (a, h) { return a + h.shortLiqUsd; }, 0),
    hours: day,
  };
}
