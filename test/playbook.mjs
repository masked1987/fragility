// Run: node test/playbook.mjs  — prints the live Playbook mode and decisions.
import { collectPlay } from '../tools/playbook/collect.js';
import { PLAY_CONFIG } from '../tools/playbook/config.js';

for (const asset of PLAY_CONFIG.assets) {
  const { s, plan } = await collectPlay(asset, PLAY_CONFIG);
  console.log(`\n${asset} ${s.spot.toFixed(0)}  flip ${s.flip ? s.flip.toFixed(0) : 'n/a'}  day move ±${(s.move * 100).toFixed(1)}% (${plan.dayPts.toFixed(0)})  ` +
    `fragility ${s.score == null ? 'n/a' : s.score.toFixed(0)} ${s.zone}  funding ${s.funding || '-'}  flow ${s.flow.tone}/${s.flow.down}/${s.flow.up}  overall ${s.overall.level}  closes ${s.closes.map(c => c.toFixed(0)).join(' ')}`);
  console.log(`  MODE ${plan.mode.name}   triggers down ${plan.down} / up ${plan.up}`);
  for (const p of plan.plans) {
    const lv = p.entry ? ` entry ${p.entry} stop ${p.stop} targets ${p.targets.map(t => `${t.price} (${t.kind}, ${t.r.toFixed(1)}R)`).join(', ')}${p.triggered ? ' TRIGGERED' : ''}`
      : p.zone ? ` zone ${p.zone.join('-')} back to ${p.back}` : ` ${p.low}-${p.high}`;
    console.log(`  ${p.preferred ? '*' : ' '} ${p.key.padEnd(9)} ${p.side.padEnd(5)} size ${p.size}${lv}`);
  }
}
