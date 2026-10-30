// Implied vs realized volatility. Pure functions: no fetching, no DOM.
//
// Implied: Deribit DVOL, what options price in for the next 30 days (annualised %).
// Realized: how much the coin actually moved, from hourly log returns,
// annualised for a market that trades around the clock.
import { bsGamma } from '../../shared/gamma.js';

const HOURS_PER_YEAR = 24 * 365;
const YEAR_MS = 365 * 864e5;

export function realizedVol(prices, i, hours) {
  if (i < hours) return null;
  let sum = 0;
  for (let j = i - hours + 1; j <= i; j++) {
    const r = Math.log(prices[j].close / prices[j - 1].close);
    sum += r * r;
  }
  return Math.sqrt(sum / hours * HOURS_PER_YEAR) * 100;
}

// Annualised vol (%) -> typical move in one day (%).
export function dailyMove(vol) { return vol / Math.sqrt(365); }

export function analyse(ivSeries, prices, cfg) {
  const w = cfg.rvDays * 24;
  const ivAt = {};
  ivSeries.forEach(function (p) { ivAt[p.t] = p.iv; });
  const end = prices[prices.length - 1].t;
  const points = [];
  prices.forEach(function (p, i) {
    if (p.t < end - cfg.chartDays * 864e5 || ivAt[p.t] == null) return;
    const rv = realizedVol(prices, i, w);
    if (rv != null) points.push({ t: p.t, iv: ivAt[p.t], rv: rv, price: p.close });
  });
  if (points.length < 24) throw new Error('not enough volatility history');

  const last = points[points.length - 1];
  const dayAgo = points.find(function (p) { return p.t >= last.t - 864e5; });
  // What options priced over the same week the realized figure covers.
  const week = points.filter(function (p) { return p.t > last.t - cfg.rvDays * 864e5; });
  const ivWeek = week.reduce(function (a, p) { return a + p.iv; }, 0) / week.length;
  const below = points.filter(function (p) { return p.iv <= last.iv; }).length;
  return {
    points: points,
    time: last.t,
    price: last.price,
    ivNow: last.iv,
    ivChange24h: last.iv - dayAgo.iv,
    ivPct: Math.round(below / points.length * 100),
    ivWeek: ivWeek,
    rvWeek: last.rv,
    rvDay: realizedVol(prices, prices.length - 1, 24),
  };
}

// Deribit expiry kinds: monthlies are the last Friday of a month, quarterlies
// the last Friday of Mar/Jun/Sep/Dec, weeklies the other Fridays, dailies the rest.
export const GROUPS = [
  { key: 'daily', label: 'Dailies' },
  { key: 'weekly', label: 'Weeklies' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'quarterly', label: 'Quarterly' },
];

export function expiryGroup(expiry) {
  const d = new Date(expiry);
  if (d.getUTCDay() !== 5) return 'daily';
  if (new Date(expiry + 7 * 864e5).getUTCMonth() === d.getUTCMonth()) return 'weekly';
  return d.getUTCMonth() % 3 === 2 ? 'quarterly' : 'monthly';
}

// Dealers' dollars per day: time decay (theta) against re-hedging (gamma).
// Same convention as shared/gamma.js: dealers long calls, short puts.
// Per option, dollar gamma Γ$ = Γ·S²·OI, and over one day
//   theta  = −½·Γ$·σ²implied/365  (with zero rates this is Black-Scholes theta)
//   hedge  = +½·Γ$·σ²realized/365 (what re-hedging makes at the realized pace)
// signed for the dealer, so a short option gives +theta and −hedge.
// Options that expire within a day only count until they expire.
// rv: realized vol as annualised %, e.g. step 1's 7-day figure.
export function carry(options, spot, now, rv) {
  const r2 = (rv / 100) * (rv / 100);
  const by = {};
  GROUPS.forEach(function (g) { by[g.key] = { key: g.key, label: g.label, theta: 0, hedge: 0, net: 0, gamma: 0 }; });
  const total = { theta: 0, hedge: 0, net: 0, gamma: 0 };
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    const T = (o.expiry - now) / YEAR_MS;
    if (T <= 0) continue;
    const g = (o.type === 'C' ? 1 : -1) * bsGamma(spot, o.strike, T, o.iv) * o.oi * spot * spot;
    const life = Math.min(1, T * 365);
    const theta = -0.5 * g * o.iv * o.iv / 365 * life;
    const hedge = 0.5 * g * r2 / 365 * life;
    [by[expiryGroup(o.expiry)], total].forEach(function (b) {
      b.theta += theta; b.hedge += hedge; b.net += theta + hedge; b.gamma += g;
    });
  }
  return { total: total, groups: GROUPS.map(function (g) { return by[g.key]; }) };
}
