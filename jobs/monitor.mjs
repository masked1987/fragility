// Scheduled job (GitHub Actions): score BTC/ETH, push a phone alert on zone
// change, when ETH dealers start or stop losing (Market Maker), and when ETH
// crosses a key level; append to the hourly log.
//
//   node jobs/monitor.mjs <store dir>
//
// <store dir> is a checkout of the `data` branch holding log.csv and state.json.
// Set NTFY_TOPIC to send pushes via https://ntfy.sh (skipped if unset).
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { collect } from '../tools/fragility/collect.js';
import { evaluate } from '../tools/fragility/score.js';
import { stickyZone, levelCrossings } from '../tools/fragility/alerts.js';
import { CONFIG } from '../tools/fragility/config.js';
import { collectMM } from '../tools/market-maker/collect.js';
import { readMM, readCarry, dealerSide } from '../tools/market-maker/read.js';
import { MM_CONFIG } from '../tools/market-maker/config.js';

const DIR = process.argv[2] || 'store';
const STATE = join(DIR, 'state.json');
const LOG = join(DIR, 'log.csv');
const LOG_EVERY_MS = 55 * 60e3; // the job runs every 15 min; log about hourly
const ZONE_REPEATS = 3;           // a zone change rings this many times...
const REPEAT_GAP_S = 60;          // ...this many seconds apart, then stops
const SIDE_WORDS = { win: 'winning', even: 'balanced', lose: 'losing' };
const COLUMNS = ['time', 'asset', 'price', 'score', 'zone', 'funding', 'basis', 'oi_level', 'oi_change', 'gamma', 'coverage'];

const firstRun = !existsSync(STATE);
const state = firstRun ? { zones: {}, lastLog: {} } : JSON.parse(readFileSync(STATE, 'utf8'));
state.dealers = state.dealers || {};
state.levels = state.levels || {};
if (!existsSync(LOG)) writeFileSync(LOG, COLUMNS.join(',') + '\n');

const now = Date.now();
const summary = [];
const mmSummary = [];
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

  const price = data.futures ? data.futures.spot : data.options ? data.options.spot : null;

  // Key levels: ring once when the price closes past one (first run only records sides).
  const levels = CONFIG.levels[asset];
  if (levels && price) {
    const lv = levelCrossings(price, levels, state.levels[asset] || {}, CONFIG.levelBufferPct);
    state.levels[asset] = lv.sides;
    if (lv.crossed.length) pushes.push(levelMessage(asset, price, lv.crossed, levels, zone, r));
    mmSummary.push(`${asset} ${px(price)}`);
  }

  // Market Maker: ring when dealers start losing, once when they stop.
  if (MM_CONFIG.alertAssets.includes(asset)) {
    try {
      const mm = await collectMM(asset, MM_CONFIG, data);
      const prevSide = state.dealers[asset] || null;
      const side = dealerSide(mm.ivWeek - mm.rvWeek, prevSide, MM_CONFIG);
      state.dealers[asset] = side;
      console.log(`${asset} dealers: ${side} (gap ${(mm.ivWeek - mm.rvWeek).toFixed(1)})`);
      mmSummary.push(`${asset} dealers ${SIDE_WORDS[side]}`);
      if (prevSide && prevSide !== side && (side === 'lose' || prevSide === 'lose')) pushes.push(dealerMessage(asset, prevSide, side, mm, zone, r));
    } catch (e) {
      console.log(`${asset} market maker unavailable: ${e.message}`);
    }
  }

  if (!state.lastLog[asset] || now - state.lastLog[asset] >= LOG_EVERY_MS) {
    const sub = Object.fromEntries(r.inputs.map(i => [i.key, i.score == null ? '' : i.score.toFixed(1)]));
    const row = [new Date(now).toISOString(), asset, price == null ? '' : price, r.score.toFixed(1), zone,
      sub.funding, sub.basis, sub.oiLevel, sub.oiChange, sub.gamma, r.coverage.toFixed(2)];
    appendFileSync(LOG, row.join(',') + '\n');
    state.lastLog[asset] = now;
  }
}

// Confirms the phone setup: sent once, on the first run that has a topic.
if (!state.welcomed && process.env.NTFY_TOPIC && summary.length) {
  state.welcomed = true;
  pushes.push({ title: 'Fragility alerts are on', body: 'You will get a message here when a zone changes.\nNow: ' + summary.join(' · '), priority: 3, tags: 'white_check_mark' });
}

// Same for the dealer and level alerts added later.
if (!state.welcomedMM && process.env.NTFY_TOPIC && mmSummary.length) {
  state.welcomedMM = true;
  const lv = Object.entries(CONFIG.levels).map(([a, l]) => `${a} crosses ${l.map(px).join(' / ')}`).join(', ');
  pushes.push({ title: 'Dealer and level alerts are on', priority: 3, tags: 'white_check_mark', click: '#mm',
    body: `You will also get a message when ${MM_CONFIG.alertAssets.join(' or ')} dealers start losing (and when they stop), and when ${lv}.\nNow: ` + mmSummary.join(' · ') });
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
    repeats: ZONE_REPEATS,
  };
}

function px(x) { return Math.round(x).toLocaleString('en-US'); }

function levelMessage(asset, price, crossed, levels, zone, r) {
  const down = crossed[0].dir === 'down';
  const names = crossed.map(c => px(c.level));
  // The next level in the direction of travel, if any.
  const next = levels.filter(L => down ? L < price : L > price).sort((a, b) => down ? b - a : a - b)[0];
  return {
    title: `${asset} ${down ? 'below' : 'above'} ${names.join(' and ')} (now ${px(price)})`,
    body: `${asset} ${down ? 'fell through' : 'rose through'} ${names.join(' and ')}, now ${px(price)}.\n` +
      (next ? `Next level ${down ? 'below' : 'above'}: ${px(next)}.\n` : '') +
      `Fragility: ${r.score.toFixed(0)} ${zone}.`,
    priority: 4,
    tags: down ? 'chart_with_downwards_trend' : 'chart_with_upwards_trend',
    click: '#flow',
  };
}

function dealerMessage(asset, from, to, mm, zone, r) {
  const read = readMM(mm, mm.gamma, asset, MM_CONFIG, CONFIG.gamma.neutralRatio);
  const gap = mm.ivWeek - mm.rvWeek;
  const money = readCarry(mm.carry, gap, MM_CONFIG);
  return {
    title: to === 'lose' ? `${asset} dealers now losing (gap ${gap.toFixed(1)} pts)` : `${asset} dealers no longer losing (now ${SIDE_WORDS[to]})`,
    body: read.headline + '\n' + read.lines[0] + '\n' + (money ? money + '\n' : '') +
      (to === 'lose' ? read.action + '\n' : '') + `Fragility: ${r.score.toFixed(0)} ${zone}.`,
    priority: to === 'lose' ? 4 : 3,
    tags: to === 'lose' ? 'warning' : 'white_check_mark',
    repeats: to === 'lose' ? ZONE_REPEATS : 1,
    click: '#mm',
  };
}

// Repeats are handed to ntfy now with a delivery time (At), so the job doesn't wait.
async function send(p) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) { console.log('NTFY_TOPIC not set, not sending:', p.title, '| ' + p.body.replace(/\n/g, ' | ')); return; }
  const n = p.repeats || 1;
  const now = Math.floor(Date.now() / 1000);
  for (let k = 0; k < n; k++) {
    const title = n > 1 ? `${p.title} [${k + 1}/${n}]` : p.title;
    const headers = { Title: title, Priority: String(p.priority), Tags: p.tags, Click: CONFIG.siteUrl + (p.click || '#fragility') };
    if (k > 0) headers.At = String(now + k * REPEAT_GAP_S);
    const res = await fetch('https://ntfy.sh/' + encodeURIComponent(topic), { method: 'POST', body: p.body, headers });
    console.log('push', res.status, title);
  }
}
