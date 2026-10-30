// All tunable numbers live here.
//
// Each input becomes a 0-100 sub-score with a "calm band": values inside
// the band score 0, and the score rises linearly to 100 at the "full" edges.
// APR = annualised percent.

export const CONFIG = {
  assets: ['BTC', 'ETH'],
  refreshMinutes: 5,

  // Points out of 100. Missing inputs are dropped and the rest re-weighted.
  weights: { funding: 25, basis: 15, oiLevel: 15, oiChange: 15, gamma: 30 },

  // Upper bounds (score < max). Hysteresis stops alerts flapping on a boundary.
  zones: [
    { name: 'Calm', max: 35 },
    { name: 'Building', max: 60 },
    { name: 'Primed', max: Infinity },
  ],
  hysteresis: 3,

  funding: { fullLow: -15, calmLow: 0, calmHigh: 10, fullHigh: 35 },  // APR
  basis: { fullLow: -5, calmLow: 3, calmHigh: 10, fullHigh: 25, targetDays: 90, minDays: 7 }, // APR
  oiLevel: { calmBelowPct: 50, minHistoryDays: 7 },  // percentile of last 30 days
  oiChange: { fullPct: 8 },                           // 24h growth in coins
  gamma: { calmRatio: 0.3, fullRatio: -0.3 },         // net / gross GEX
};
