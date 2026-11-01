// Key gamma levels, picked automatically from the option chain (phone alerts and
// Playbook triggers). Pure: no fetching, runs in Node and the browser.
//
// The owner watches the big, noticeable gamma strikes (like 2,200 / 2,300 / 2,500)
// and waits for price to break one and turn back. A strike's size = open contracts,
// calls + puts, in options expiring more than `minDays` from now (tomorrow's expiry
// would otherwise swamp the list and change it every day). The `count` biggest
// within ±rangePct win, at least minGapPct apart.

const DAY_MS = 864e5;
// How strikes are sized. Saved with the levels; a change re-picks them at once.
export const METHOD = 'oi-top';

// cfg: { rangePct, count, minDays, minGapPct }
// Returns [{ price, oi }] sorted by price.
export function pickLevels(options, spot, now, cfg) {
  const by = {};
  options.forEach(function (o) {
    if (o.expiry - now <= cfg.minDays * DAY_MS || Math.abs(o.strike / spot - 1) * 100 > cfg.rangePct) return;
    by[o.strike] = (by[o.strike] || 0) + o.oi;
  });
  const out = [];
  Object.keys(by).map(function (k) { return { price: +k, oi: by[k] }; })
    .sort(function (a, b) { return b.oi - a.oi; })
    .forEach(function (n) {
      if (out.length >= cfg.count || !(n.oi > 0)) return;
      if (out.some(function (m) { return Math.abs(m.price / n.price - 1) * 100 < cfg.minGapPct; })) return; // a bigger one is right next to it
      out.push(n);
    });
  return out.sort(function (a, b) { return a.price - b.price; });
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
