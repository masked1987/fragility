// Run: node test/mm.mjs  — prints the live Market Maker reading.
import { collectMM } from '../tools/market-maker/collect.js';
import { readMM, readShock, signedUsd } from '../tools/market-maker/read.js';
import { MM_CONFIG } from '../tools/market-maker/config.js';
import { CONFIG } from '../tools/fragility/config.js';

for (const asset of MM_CONFIG.assets) {
  const a = await collectMM(asset, MM_CONFIG);
  console.log(`\n${asset} ${a.price}  IV now ${a.ivNow.toFixed(1)} (${a.ivChange24h.toFixed(1)} 24h, ${a.ivPct}th pct)  IV 7d avg ${a.ivWeek.toFixed(1)}  RV 7d ${a.rvWeek.toFixed(1)}  RV 24h ${a.rvDay.toFixed(1)}  gamma ${a.gamma == null ? 'n/a' : a.gamma.toFixed(2)}  points ${a.points.length}`);
  const r = readMM(a, a.gamma, asset, MM_CONFIG, CONFIG.gamma.neutralRatio);
  console.log(`  [${r.tone}] ${r.headline}`);
  for (const l of r.lines) console.log('   - ' + l);
  console.log('   > ' + r.action);
  if (a.carry) for (const g of [...a.carry.groups, { label: 'Total', ...a.carry.total }]) {
    console.log(`   ${g.label.padEnd(10)} decay ${signedUsd(g.theta).padStart(7)}  re-hedging ${signedUsd(g.hedge).padStart(7)}  net ${signedUsd(g.net).padStart(7)}  (dollar gamma ${signedUsd(g.gamma)})  vega/pt ${signedUsd(g.vega).padStart(7)} per DVOL pt ${signedUsd(g.vegaW).padStart(7)}`);
  }
  if (a.carry) console.log('   ' + readShock(a.carry, MM_CONFIG.shockPts));
}
