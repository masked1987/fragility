// Key price levels, picked automatically from the option chain (phone alerts and
// Playbook triggers). Pure: no fetching, runs in Node and the browser.
//
// A strike's size = the dollars of hedging its open options would need per 1% move
// if the price were AT that strike (gamma worked out at the strike itself, so the
// ranking doesn't shuffle every time the price moves), calls PLUS puts: a strike
// with lots of both (like a round 2,200) is a big level even when they cancel out
// under the dealer convention. `net` (calls − puts, shared/gamma.js convention:
// dealers long calls, short puts) is returned too, for information only.
import { bsGamma } from './gamma.js';

const YEAR_MS = 365 * 864e5;
// How strikes are sized. Saved with the levels; a change re-picks them at once.
export const METHOD = 'calls+puts';

// cfg: { rangePct, perSide, minShare (of the biggest on the same side), minGapPct }
// Returns [{ price, usd, net }] sorted by price, at most perSide above and below spot.
export function pickLevels(options, spot, now, cfg) {
  const by = {};
  options.forEach(function (o) {
    const T = (o.expiry - now) / YEAR_MS, K = o.strike;
    if (T <= 0 || Math.abs(K / spot - 1) * 100 > cfg.rangePct) return;
    const g = bsGamma(K, K, T, o.iv) * o.oi * K * K * 0.01;
    const n = by[K] || (by[K] = { usd: 0, net: 0 });
    n.usd += g;
    n.net += o.type === 'C' ? g : -g;
  });
  const nodes = Object.keys(by).map(function (k) { return { price: +k, usd: by[k].usd, net: by[k].net }; });
  // Each side is measured against its own biggest strike, so there is always a
  // level above and below even when one side holds most of the open interest.
  const pick = function (side) {
    const mine = nodes.filter(function (n) { return side > 0 ? n.price > spot : n.price < spot; })
      .sort(function (a, b) { return Math.abs(b.usd) - Math.abs(a.usd); });
    const top = mine.length ? Math.abs(mine[0].usd) : 0;
    const out = [];
    if (!(top > 0)) return out;
    mine.forEach(function (n) {
      if (out.length >= cfg.perSide || Math.abs(n.usd) < cfg.minShare * top) return;
      if (out.some(function (m) { return Math.abs(m.price / n.price - 1) * 100 < cfg.minGapPct; })) return; // a bigger one is right next to it
      out.push(n);
    });
    return out;
  };
  return pick(-1).concat(pick(1)).sort(function (a, b) { return a.price - b.price; });
}

// Pick again on the first check after `hourUtc` each day (Deribit's daily expiry is
// 08:00 UTC), when nothing is stored yet, or when the price has run past every
// level on one side, or when they were sized another way (METHOD).
// stored: { levels: [numbers], picked: ms, method } or null.
export function needsRepick(stored, price, now, hourUtc) {
  if (!stored || !stored.levels || !stored.levels.length || stored.method !== METHOD) return true;
  const cut = Math.floor((now - hourUtc * 36e5) / 864e5); // "day" that starts at hourUtc
  if (Math.floor((stored.picked - hourUtc * 36e5) / 864e5) !== cut) return true;
  return !stored.levels.some(function (L) { return L > price; }) || !stored.levels.some(function (L) { return L < price; });
}
