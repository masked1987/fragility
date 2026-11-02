// Settings for the Alt Tactics tab: the owner's own method on the huge gamma levels.
// Built from the backtest that suited his rules best (test/levels-reversal.mjs +
// test/levels-once.py, huge levels 70%, 5-minute Ichimoku score, once per level).
export const ALT_CONFIG = {
  assets: ['ETH', 'BTC'],  // first one opens by default
  alertAssets: ['ETH'],    // phone alerts (jobs/monitor.mjs), ETH only like Tactics
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
  maxDepthPct: 2,           // was 3; 2 tested better (owner OK'd 1 Nov 2026)
  stopBufferPct: 0,         // no % room (owner 2 Nov 2026: "set our SL as normal ... +0%"; 0.4% was live 1–2 Nov)
  // Fixed points past the low / high for the stop (owner 2 Nov 2026: "add like two points
  // to every stop, e.g. 2170 → 2168"). BTC gets the same share of its price (~0.09%).
  stopPoints: { ETH: 2, BTC: 60 },
  windowHours: 48,

  // Confirmation: the Ichimoku score on candleMinutes candles crosses up through scoreBuy.
  candleMinutes: 5,
  scoreBuy: 80,
  scoreSell: 20,           // SELL: the score crosses down through this (mirror image)
  afterWinHours: 48,       // SELL only at the level a buy reached as its target, within this long
  // Target: 'next' = the nearest huge level that way; 'biggest' = the one with the most
  // open contracts (owner's wish, Nov 2026; backtest in test/alt-backtest.mjs). Levels
  // closer than minTargetPct are skipped.
  target: 'biggest',      // switched 1 Nov 2026: "yes switch to biggest level"
  minTargetPct: 0,
  sides: { buy: true, sell: true },
  candles: 1000,           // Gate 5-minute candles fetched (~3.5 days, Ichimoku needs 78 to warm up)
  chartHours: 48,

  // Backtest summary shown on the tab (huge 70%, 5-min score, once per level, 0.1% costs).
  // From test/alt-backtest.mjs (the tab's own code), target = biggest huge level.
  // Stop at the low, dips up to 2% (node test/alt-backtest.mjs, LIST=biggest, 2 Nov 2026).
  backtest: { from: 'Nov 2023', trades: 40, hitPct: 18, avgR: 1.07, worstRun: 16,
    years: '2024 −1.07R, 2025 +3.61R, 2026 +0.64R per trade',
    best2: '+35R and +19R, July 2025', without2: -0.30, // the other 38 buys, R per trade
    before: 'With the stop 0.4% under the low (live 1–2 Nov 2026) it was +1.42R per trade, 23% reached target.',
    sell: { trades: 4, won: 0 } }, // sells after a buy hit its target: 4, all lost
};
