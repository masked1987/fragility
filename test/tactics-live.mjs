// Run: node test/tactics-live.mjs  — prints the live Tactics setup.
import { collectTac } from '../tools/tactics/collect.js';
import { TAC_CONFIG } from '../tools/tactics/config.js';
import { readTac, checkLines, money } from '../tools/tactics/read.js';

for (const asset of TAC_CONFIG.assets) {
  const d = await collectTac(asset, TAC_CONFIG);
  const s = d.setup;
  console.log(`\n${asset} ${d.spot.toFixed(1)}  pivot ${d.pivot ? d.pivot.strike + ' net ' + money(d.pivot.net) : '-'}  flip ${d.flip ? d.flip.toFixed(0) : '-'}  ` +
    `VA ${d.profile ? d.profile.val.toFixed(1) + '–' + d.profile.vah.toFixed(1) + ' POC ' + d.profile.poc.toFixed(1) : '-'}${d.session.young ? ' (yesterday)' : ''}  ` +
    `drift calls ${d.drift ? money(d.drift.calls) : '-'} puts ${d.drift ? money(d.drift.puts) : '-'}  candles ${d.candles.length} row ${d.rowSize}  missing ${d.missing.join(', ') || 'none'}`);
  console.log('  nodes:', d.nodes.filter(n => Math.abs(n.net) > 2e5).map(n => `${n.strike}:${money(n.net)}`).join(' '));
  const r = readTac(d, TAC_CONFIG);
  console.log(`  [${s.status}/${s.side}] ${r.headline}`);
  for (const l of checkLines(d, TAC_CONFIG)) console.log(`   ${l.state.padEnd(4)} ${l.name}: ${l.text}`);
  console.log(`   entry ${s.entry && s.entry.toFixed(1)} stop ${s.stop && s.stop.toFixed(1)} targets ${(s.targets || []).map(t => t.price.toFixed(0) + ' ' + t.r.toFixed(1) + 'R').join(', ')}`);
  console.log('   > ' + r.action);
  const last = d.candles.at(-1);
  if (last) console.log(`   last 15m candle ${new Date(last.t).toISOString().slice(11, 16)} o${last.o} h${last.h} l${last.l} c${last.c} delta ${money(last.delta)} rows ${last.rows.length}`);
}
