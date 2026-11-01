// Tunable assumptions for the Forced Flow map.
export const FLOW_CONFIG = {
  assets: ['ETH', 'BTC'], // first one opens by default
  refreshMinutes: 5,

  // Price ladder: bins of binPct around spot, out to +/- rangePct.
  binPct: 0.5,
  rangePct: 15,

  // How new positions are assumed to be leveraged (weights sum to 1).
  // Nobody publishes this; these are typical retail perp mixes.
  leverage: [
    { x: 5, w: 0.15 },
    { x: 10, w: 0.30 },
    { x: 25, w: 0.30 },
    { x: 50, w: 0.15 },
    { x: 100, w: 0.10 },
  ],
  maintenanceMargin: 0.005,

  // The taker buy share decides how much new OI is long; clamped so one
  // lopsided hour doesn't read as 100% longs.
  buyShareClamp: [0.3, 0.7],

  // A cluster counts as "big" at this share of the largest on its side.
  bigClusterShare: 0.4,

  // Plain-English reading: a cluster within closePct is "close", beyond farPct is "far".
  read: { closePct: 2, farPct: 5 },
};
