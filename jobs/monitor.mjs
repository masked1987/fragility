// Scheduled job (GitHub Actions): score BTC/ETH, push a phone alert on zone
// change, and append to the hourly log.
//
//   node jobs/monitor.mjs <store dir>
//
// <store dir> is a checkout of the `data` branch holding log.csv and state.json.
// Set NTFY_TOPIC to send pushes via https://ntfy.sh (skipped if unset).
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { collect } from '../tools/fragility/collect.js';
import { evaluate } from '../tools/fragility/score.js';
import { stickyZone } from '../tools/fragility/alerts.js';
import { CONFIG } from '../tools/fragility/config.js';

const DIR = process.argv[2] || 'store';
const STATE = join(DIR, 'state.json');
const LOG = join(DIR, 'log.csv');
const LOG_EVERY_MS = 55 * 60e3; // the job runs every 15 min; log about hourly
const COLUMNS = ['time', 'asset', 'price', 'score', 'zone', 'funding', 'basis', 'oi_level', 'oi_change', 'gamma', 'coverage'];

const firstRun = !existsSync(STATE);
const state = firstRun ? { zones: {}, lastLog: {} } : JSON.parse(readFileSync(STATE, 'utf8'));
if (!existsSync(LOG)) writeFileSync(LOG, COLUMNS.join(',') + '\n');

const now = Date.now();
const summary = [];
const pushes = [];

for (const asset of CONFIG.assets) {
  const data = await collect(asset);
  const r = evaluate(data, CONFIG);
  const failed = r.sources.filter(s => !s.ok).map(s => s.name);
  console.log(`${asset}: ${r.score == null ? 'n/a' : r.score.toFixed(1)} ${r.zone || ''}` + (failed.length ? ` (unreachable: ${failed.join(', ')})` : ''));
  if (r.score == null) continue;

  const prev = state.zones[asset] || null;
  const zone = stickyZone(Math.round(r.score), CONFIG.zones, prev, CONFIG.hysteresis) || r.zone;
  state.zones[asset] = zone;
  summary.push(`${asset} ${r.score.toFixed(0)} ${zone}`);
  if (prev && prev !== zone) pushes.push(zoneMessage(asset, prev, zone, r));

  if (!state.lastLog[asset] || now - state.lastLog[asset] >= LOG_EVERY_MS) {
    const sub = Object.fromEntries(r.inputs.map(i => [i.key, i.score == null ? '' : i.score.toFixed(1)]));
    const price = data.futures ? data.futures.spot : data.options ? data.options.spot : '';
    const row = [new Date(now).toISOString(), asset, price, r.score.toFixed(1), zone,
      sub.funding, sub.basis, sub.oiLevel, sub.oiChange, sub.gamma, r.coverage.toFixed(2)];
    appendFileSync(LOG, row.join(',') + '\n');
    state.lastLog[asset] = now;
  }
}

if (firstRun && summary.length) {
  pushes.push({ title: 'Fragility alerts are on', body: 'You will get a message here when a zone changes.\nNow: ' + summary.join(' · '), priority: 3, tags: 'white_check_mark' });
}

writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
for (const p of pushes) await send(p);

function zoneMessage(asset, from, to, r) {
  const up = CONFIG.zones.findIndex(z => z.name === to) > CONFIG.zones.findIndex(z => z.name === from);
  const top = r.inputs.filter(i => i.points > 0).sort((a, b) => b.points - a.points).slice(0, 3)
    .map(i => `${i.label}: ${i.value} (${i.note.split(' · ')[0]})`);
  return {
    // Header values must be plain ASCII.
    title: `${asset} ${from} -> ${to} (${r.score.toFixed(0)})`,
    body: `${asset} fragility ${up ? 'rose' : 'fell'} to ${to}: ${r.score.toFixed(0)}/100\n` + top.join('\n'),
    priority: to === 'Primed' ? 5 : up ? 4 : 3,
    tags: to === 'Primed' ? 'rotating_light' : up ? 'warning' : 'arrow_down',
  };
}

async function send(p) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) { console.log('NTFY_TOPIC not set, not sending:', p.title); return; }
  const res = await fetch('https://ntfy.sh/' + encodeURIComponent(topic), {
    method: 'POST',
    body: p.body,
    headers: { Title: p.title, Priority: String(p.priority), Tags: p.tags, Click: CONFIG.siteUrl },
  });
  console.log('push', res.status, p.title);
}
