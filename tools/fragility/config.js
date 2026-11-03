// All tunable numbers live here.
//
// Each input becomes a 0-100 sub-score with a "calm band": values inside
// the band score 0, and the score rises linearly to 100 at the "full" edges.
// APR = annualised percent.

// On the private host (Cloudflare) the job's files come through the site itself
// (functions/_middleware.js reads the private repo); on GitHub Pages, straight
// from GitHub. In Node (the job) there is no location, so the GitHub address.
const PRIVATE = typeof location !== 'undefined' && !/github\.io$/.test(location.hostname);
const DATA = PRIVATE ? '/gh/fragility/data/' : 'https://raw.githubusercontent.com/masked1987/fragility/data/';

export const CONFIG = {
  assets: ['ETH', 'BTC'],              // first one opens by default
  refreshMinutes: 5,
  siteUrl: 'https://masked1987.github.io/fragility/',
  // Written by the scheduled job (jobs/monitor.mjs) to the `data` branch.
  historyUrl: DATA + 'log.csv',

  // Points out of 100. Missing inputs are dropped and the rest re-weighted.
  weights: { funding: 25, basis: 15, oiLevel: 15, oiChange: 15, gamma: 30 },

  // Upper bounds (score < max). Hysteresis stops alerts flapping on a boundary.
  zones: [
    { name: 'Calm', max: 35 },
    { name: 'Building', max: 60 },
    { name: 'Primed', max: Infinity },
  ],
  hysteresis: 3,

  // Phone alerts on the key gamma levels (jobs/monitor.mjs), from finished
  // `candleMinutes` candles (Gate). Any trade through a level counts, spike or not
  // (the candle's high / low): one ring (a break). If price then trades back
  // through it within reversalHours, a louder one rings (a reversal); through and
  // back in one candle rings once as a spike. After a reversal the level stays
  // quiet for quietMinutes, so chop on a level doesn't ring every candle.
  // Levels are picked automatically (shared/levels.js): the `count` strikes with the
  // most open calls + puts within ±rangePct, leaving out options that expire within
  // minDays. Re-picked daily after Deribit's 08:00 UTC expiry, or sooner if the
  // price runs past every level on one side.
  keyLevels: { assets: ['ETH'], rangePct: 15, count: 5, minDays: 2, minGapPct: 0.5, repickHourUtc: 8,
    reversalHours: 48, quietMinutes: 60, candleMinutes: 15,
    alerts: false }, // owner: "I don't need crossing alert gamma" (only Tactics 6/6). Levels are still picked
                     // and tracked for the Playbook; true turns the break / reversal / spike pushes back on.
  // The job saves the picked levels here; the Playbook reads them.
  stateUrl: DATA + 'state.json',

  funding: { fullLow: -15, calmLow: 0, calmHigh: 10, fullHigh: 35 },  // APR
  basis: { fullLow: -5, calmLow: 3, calmHigh: 10, fullHigh: 25, targetDays: 90, minDays: 7 }, // APR
  oiLevel: { calmBelowPct: 50, minHistoryDays: 7 },  // percentile of last 30 days
  oiChange: { fullPct: 8 },                           // 24h growth in coins
  gamma: { calmRatio: 0.3, fullRatio: -0.3, neutralRatio: 0.05 }, // net / gross GEX; within ±neutral reads as neutral
};
