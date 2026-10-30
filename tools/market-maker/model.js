// Implied vs realized volatility. Pure functions: no fetching, no DOM.
//
// Implied: Deribit DVOL, what options price in for the next 30 days (annualised %).
// Realized: how much the coin actually moved, from hourly log returns,
// annualised for a market that trades around the clock.
const HOURS_PER_YEAR = 24 * 365;

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
