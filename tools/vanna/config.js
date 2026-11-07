// Settings for the Vanna tab: ETH 24-hour Vanna + Charm flow (added 7 Nov 2026 from the
// owner's ChatGPT-built "Crypto Gamma" dashboard, so its alert and reading live on the
// public site). The rules themselves are in shared/vanna-flow/core.mjs (kept identical
// to that dashboard); the phone alert is jobs/vanna-flow.mjs.
export const VANNA_CONFIG = {
  asset: 'ETH',
  refreshSeconds: 300,
  expiryRows: 12,          // expiries shown in the table (nearest first)
};
