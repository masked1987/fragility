// Settings for the Trend tab: the 50-day average rule (long only), picked from the
// outside-strategies test (test/outside-strategies.mjs, asked 2 Nov 2026).
export const TREND_CONFIG = {
  assets: ['ETH', 'BTC'],   // first one opens by default
  alertAssets: ['ETH'],     // phone alerts (jobs/monitor.mjs): BUY / SELL ring 3 times, a quiet daily line while IN
  alertMaxHours: 72,        // crossings older than this are not pushed (the job can run hours late)
  days: 50,                 // the average: last 50 daily closes (00:00 UTC)
  costSide: 0.0005,         // 0.05% a side, as in the test
  refreshSeconds: 300,
  chartDays: 180,
  freshHours: 24,           // BUY / SELL badge for the first day after the crossing close, then IN / OUT
  // test/results/outside-strategies-2026-11-02.txt (Deribit ETH perpetual, daily closes,
  // % of ETH price, full position, compounded, after costs).
  backtest: {
    asset: 'ETH', period: 'Nov 2023 – Oct 2026',
    total: 268.8, hold: 24.4, dd: 37.5, holdDd: 67.6, trades: 21, monthsUp: 15, monthsDown: 15,
    years: [['Nov–Dec 2023', 26.1, 26.1], ['2024', 23.6, 46.0], ['2025', 90.1, -10.9], ['Jan–Oct 2026', 24.5, -24.1]],
    neighbours: '30-day +166%, 40-day +299%, 60-day +205%, 100-day +101%, 200-day +84%',
    sidestepped: 'Aug 2024 −22%, Feb 2025 −32%, Nov 2025 −22%, Jun 2026 −22%',
  },
};
