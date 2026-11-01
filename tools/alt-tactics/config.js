// Settings for the Alt Tactics tab: the owner's own method on the huge gamma levels.
// Built from the backtest that suited his rules best (test/levels-reversal.mjs +
// test/levels-once.py, huge levels 70%, 5-minute Ichimoku score, once per level).
export const ALT_CONFIG = {
  assets: ['ETH', 'BTC'],  // first one opens by default
  refreshSeconds: 60,

  // Huge levels: open contracts per strike (calls + puts, options expiring after minDays),
  // within ±rangePct of the price, at least hugeShare of the biggest, minGapPct apart.
  rangePct: 35,
  minDays: 2,
  hugeShare: 0.7,
  minGapPct: 0.5,

  // The setup: price was above a huge level, trades below it (a dip through), makes a
  // low, and turns. More than maxDepthPct past the level = a real breakdown; no
  // confirmation within windowHours = the setup lapses.
  maxDepthPct: 3,
  windowHours: 48,

  // Confirmation: the Ichimoku score on candleMinutes candles crosses up through scoreBuy.
  candleMinutes: 5,
  scoreBuy: 80,
  candles: 1000,           // Gate 5-minute candles fetched (~3.5 days, Ichimoku needs 78 to warm up)
  chartHours: 48,

  // Backtest summary shown on the tab (huge 70%, 5-min score, once per level, 0.1% costs).
  backtest: { from: 'Nov 2023', trades: 43, hitPct: 26, avgR: 0.47, worstRun: 8,
    years: '2024 +0.81R, 2025 +0.86R, 2026 +0.09R per trade' },
};
