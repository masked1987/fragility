// Settings for the Market Maker tab (implied vs realized volatility).
export const MM_CONFIG = {
  assets: ['ETH', 'BTC'], // first one opens by default
  refreshMinutes: 5,
  chartDays: 30,
  rvDays: 7,      // realized volatility looks back this many days
  gapPts: 5,      // implied − realized beyond ±this (vol points) = clearly winning or losing
  spikePts: 10,   // last 24h moving this far above what options price = unusually wild day
  ivMovePts: 5,   // implied vol change over 24h worth calling out
  shockPts: 5,    // "if implied vol jumps this many points" scenario
};
