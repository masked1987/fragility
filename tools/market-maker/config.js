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
  // Phone alerts (jobs/monitor.mjs): dealers start / stop losing.
  alertAssets: ['ETH'],
  flipBufferPts: 1, // once losing, stay losing until the gap is this far back inside ±gapPts

  // The flip (asked 2 Nov 2026 "add the flip to the Market Maker tab"; tested in
  // test/mm-backtest.mjs): the hour dealers turn losing, trade the way of the last 24h.
  // Stop / target in day's implied moves (DVOL / √365); out at the close after maxHours.
  flip: {
    stopMoves: 0.5,
    targetMoves: 2,
    maxHours: 72,
    freshHours: 2, // a signal reads BUY / SELL this long; after that the trade shows as OPEN
    // Backtest (test/mm-backtest.mjs, ETH Nov 2023 – Nov 2026, buys + sells together,
    // 0.1% costs; % = price move per trade). Owner wants % figures, not R.
    backtest: { from: 'Nov 2023', trades: 38, winPct: 34, avgPct: 1.2, avgWin: 7.1, avgLoss: -1.9,
      compounded: 52.4, maxDD: 11.5, worstRun: 6, quarters: '9 of 11', years: '2024 +7.7%, 2025 +28.2%, 2026 +9.9%' },
  },
};
