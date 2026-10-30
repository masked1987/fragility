// Settings for the Playbook tab: picks a trading mode from the other tabs and
// turns it into possible decisions with levels.
export const PLAY_CONFIG = {
  assets: ['ETH', 'BTC'], // first one opens by default
  refreshMinutes: 5,

  flipBandPct: 0.5,     // within ±this % of the gamma flip counts as "on the flip"
  minTriggerMoves: 0.15, // a trigger level must be at least this share of a day's move away
  stopMoves: 0.5,       // stop beyond the trigger, as a share of a day's move (survived ~79% of good days)
  minTargetMoves: 0.3,  // ignore targets closer than this to the entry
  targetRangeMoves: 2,  // look for cluster / strike targets within this many days' moves
  fallbackTargets: [0.5, 0.75], // when nothing is mapped: ½ and ¾ of a day's move (reached ~79% / ~59%)
  roundEvery: { ETH: 50, BTC: 500 }, // round numbers that also count as trigger levels

  // Position size defaults (the tab remembers what you type, on this device only).
  account: 10000,
  riskPct: 1,
};
