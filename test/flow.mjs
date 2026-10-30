// Run: node test/flow.mjs  — prints the live Forced Flow estimate.
import { collectFlow } from '../tools/forced-flow/collect.js';
import { FLOW_CONFIG } from '../tools/forced-flow/config.js';

const M = x => '$' + (x / 1e6).toFixed(0) + 'M';
for (const asset of FLOW_CONFIG.assets) {
  const f = await collectFlow(asset, FLOW_CONFIG);
  console.log(`\n${asset} spot ${f.spot.toFixed(0)}  flip ${f.flip ? f.flip.toFixed(0) : 'n/a'}  scale x${f.scale.toFixed(1)} (${f.venues.join(', ')})`);
  console.log('  fragility', f.fragility);
  for (const k of ['longs', 'shorts']) for (const c of f.clusters[k] || [])
    console.log(`  ${k} ${c.largest ? 'largest' : 'nearest'}: ${c.price.toFixed(0)} (${c.pct.toFixed(1)}%) ${M(c.usd)} gamma there ${c.gammaThere == null ? 'n/a' : M(c.gammaThere)}`);
  const tot = f.bins.reduce((a, b) => [a[0] + b.longUsd, a[1] + b.shortUsd], [0, 0]);
  console.log(`  total in range: longs ${M(tot[0])} shorts ${M(tot[1])} | liq 24h (Gate): longs ${M(f.liq24.longUsd)} shorts ${M(f.liq24.shortUsd)}`);
  const top = [...f.bins].sort((a, b) => Math.abs(b.gamma) - Math.abs(a.gamma)).slice(0, 3);
  console.log('  top gamma strikes:', top.map(b => `${b.mid.toFixed(0)} ${M(b.gamma)}`).join(' | '));
}
