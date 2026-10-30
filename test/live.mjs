// Run: node test/live.mjs  — fetches live data and prints the scores.
import { collect } from '../tools/fragility/collect.js';
import { evaluate } from '../tools/fragility/score.js';
import { CONFIG } from '../tools/fragility/config.js';

for (const asset of CONFIG.assets) {
  const data = await collect(asset);
  const r = evaluate(data, CONFIG);
  console.log(`\n${asset}: ${r.score == null ? 'n/a' : r.score.toFixed(1)}  ${r.zone}  (coverage ${(r.coverage * 100).toFixed(0)}%)`);
  for (const i of r.inputs) {
    console.log(`  ${i.label.padEnd(22)} ${String(i.score == null ? '—' : i.score.toFixed(0)).padStart(3)}  w${i.weight.toFixed(0).padStart(3)}%  +${i.points.toFixed(1).padStart(4)}  ${i.value}  | ${i.note}`);
  }
  for (const s of r.sources) console.log(`  [${s.ok ? 'ok' : 'FAIL'}] ${s.name}${s.error ? ' — ' + s.error : ''}`);
}
