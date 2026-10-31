// Settings for the Tactics tab: the GEX pivot + order-flow exhaustion setup.
// Separate from the Playbook: an intraday tactic with tight stops.
export const TAC_CONFIG = {
  assets: ['ETH', 'BTC'],  // first one opens by default
  refreshSeconds: 60,

  // Dealer gamma nodes ("pre-market plan"): strikes within ±nodeRangePct of the price.
  nodeRangePct: 4,
  pivotRangePct: 3,        // the pivot is a big node within this distance
  pivotShare: 0.5,         // ...at least this share of the biggest node; nearest one wins
  heatExpiries: 5,         // columns in the strike × expiry heat map
  heatStrikes: 13,         // rows (odd: the middle one is closest to the price)

  // Session: the UTC day. Before sessionMinHours, yesterday's value area is used.
  sessionMinHours: 4,
  valueArea: 0.7,          // value area holds this share of the session's volume
  profileRows: 60,         // volume profile resolution across the session's range

  // Order-flow footprint from Deribit perpetual trades.
  candleMinutes: 15,
  footprintCandles: 6,     // shown on the phone
  footprintHours: 3,       // trades fetched (also used for the signals)
  imbalance: 3,            // a price row where one side traded 3× the other
  exhaustShare: 0.25,      // top/bottom row volume below this share of the candle's median row = exhausted

  // Setup checks.
  levelTolPct: 0.15,       // within this of the pivot counts as a retest
  retestCandles: 3,        // the retest must be in the last few candles
  alignPct: 0.35,          // pivot within this of the value area high/low counts as aligned
  driftMinShare: 0.1,      // premium bias counts when |calls − puts| ≥ this share of gross
  stopBufferPct: 0.1,      // stop beyond the retest extreme by this much
  minTargetR: 1,           // ignore targets closer than 1× risk

  // Interval map: snapshots of the gamma nodes kept on this device while the tab is open.
  snapshotMinutes: 1,
};
