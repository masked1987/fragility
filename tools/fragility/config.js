// All tunable numbers live here.
//
// Each input becomes a 0-100 sub-score with a "calm band": values inside
// the band score 0, and the score rises linearly to 100 at the "full" edges.
// APR = annualised percent.

export const CONFIG = {
  assets: ['ETH', 'BTC'],              // first one opens by default
  refreshMinutes: 5,
  siteUrl: 'https://masked1987.github.io/fragility/',
  // Written by the scheduled job (jobs/monitor.mjs) to the `data` branch.
  historyUrl: 'https://raw.githubusercontent.com/masked1987/fragility/data/log.csv',

  // Points out of 100. Missing inputs are dropped and the rest re-weighted.
  weights: { funding: 25, basis: 15, oiLevel: 15, oiChange: 15, gamma: 30 },

  // Upper bounds (score < max). Hysteresis stops alerts flapping on a boundary.
  zones: [
    { name: 'Calm', max: 35 },
    { name: 'Building', max: 60 },
    { name: 'Primed', max: Infinity },
  ],
  hysteresis: 3,

  // Phone alert when the price crosses one of these (jobs/monitor.mjs). Edit freely.
  levels: { ETH: [2250, 2200, 2170] },
  levelBufferPct: 0.15, // must close this far past a level to count, so it doesn't flap

  funding: { fullLow: -15, calmLow: 0, calmHigh: 10, fullHigh: 35 },  // APR
  basis: { fullLow: -5, calmLow: 3, calmHigh: 10, fullHigh: 25, targetDays: 90, minDays: 7 }, // APR
  oiLevel: { calmBelowPct: 50, minHistoryDays: 7 },  // percentile of last 30 days
  oiChange: { fullPct: 8 },                           // 24h growth in coins
  gamma: { calmRatio: 0.3, fullRatio: -0.3, neutralRatio: 0.05 }, // net / gross GEX; within ±neutral reads as neutral
};
