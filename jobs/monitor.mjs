// Scheduled job (GitHub Actions): score BTC/ETH, push a phone alert on zone
// change, when ETH dealers start or stop losing (Market Maker), when ETH
// crosses a key level, and when all 6 Tactics BUY or SELL rules are met; append to
// the hourly log.
//
//   node jobs/monitor.mjs <store dir>
//
// <store dir> is a checkout of the `data` branch holding log.csv and state.json.
// Set NTFY_TOPIC to send pushes via https://ntfy.sh (skipped if unset).
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { collect } from '../tools/fragility/collect.js';
import { evaluate } from '../tools/fragility/score.js';
import { stickyZone, levelCrossings, breakReversals } from '../tools/fragility/alerts.js';
import { pickLevels, needsRepick, METHOD } from '../shared/levels.js';
import { closedCandles } from '../shared/sources/gate.js';
import { CONFIG } from '../tools/fragility/config.js';
import { collectMM } from '../tools/market-maker/collect.js';
import { readMM, readCarry, dealerSide } from '../tools/market-maker/read.js';
import { MM_CONFIG } from '../tools/market-maker/config.js';
import { collectTac } from '../tools/tactics/collect.js';
import { sixOfSix, RULES_TOTAL } from '../tools/tactics/model.js';
import { TAC_CONFIG } from '../tools/tactics/config.js';

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
state.keyLevels = state.keyLevels || {};
state.breaks = state.breaks || {};
state.lastCandle = state.lastCandle || {};
state.tactics = state.tactics || {};
if (!existsSync(LOG)) writeFileSync(LOG, COLUMNS.join(',') + '\n');

const now = Date.now();
const summary = [];
const mmSummary = [];
const pushes = [];
let tacNow = null; // latest Tactics reading, for the one-time test push

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

  // Key gamma levels, picked automatically (shared/levels.js). Only finished
  // 15-minute candles count (Gate closes, not the live price, so a quick spike
  // isn't a cross), and a close must be confirmPct past a level. Every candle
  // since the last check is walked in order, so a break and its reversal between
  // two late runs are both caught. A break rings once; a close back through the
  // level within reversalHours rings louder (a reversal). Breaks are kept apart
  // from the level list, so a level dropped at the daily re-pick still gets its
  // reversal. Then the levels are re-picked if due, keeping the sides of levels
  // that stay (new ones only record a side, they don't ring).
  const KL = CONFIG.keyLevels;
  if (KL.assets.includes(asset) && price) {
    const stored = state.keyLevels[asset] || null;
    const levels = stored ? stored.levels : [];
    let sides = state.levels[asset] || {};
    let breaks = state.breaks[asset] || [];
    let closes = [];
    try {
      closes = await closedCandles(asset, KL.candleMinutes, 48, now);
    } catch (e) {
      console.log(`${asset} candles unavailable (levels not checked this run): ${e.message}`);
    }
    const last = state.lastCandle[asset];
    const todo = last ? closes.filter(c => c.t > last) : closes.slice(-1); // first run: just the latest
    for (const c of todo) {
      const end = c.t + KL.candleMinutes * 6e4; // when this candle closed
      const rv = breakReversals(c.close, end, breaks, KL.confirmPct, KL.reversalHours * 36e5);
      for (const b of rv.reversed) pushes.push(reversalMessage(asset, c.close, end, b, levels));
      const lv = levelCrossings(c.close, levels, sides, KL.confirmPct);
      sides = lv.sides;
      // A crossing that is the turn back of a break was just announced as a reversal.
      const fresh = lv.crossed.filter(x => !rv.reversed.some(b => b.level === x.level));
      if (fresh.length) pushes.push(levelMessage(asset, c.close, end, fresh, levels, zone, r, KL));
      breaks = rv.open.filter(b => !fresh.some(x => x.level === b.level))
        .concat(fresh.map(x => ({ level: x.level, dir: x.dir, at: end, extreme: c.close })));
    }
    if (todo.length) {
      state.lastCandle[asset] = todo[todo.length - 1].t;
      console.log(`${asset} levels: checked ${todo.length} candle close(s), last ${px(todo[todo.length - 1].close)}; watching ${breaks.length} break(s)`);
    }
    state.breaks[asset] = breaks;
    if (needsRepick(stored, price, now, KL.repickHourUtc) && data.options) {
      const picked = pickLevels(data.options.options, price, now, KL).map(l => l.price);
      if (picked.length) {
        const changed = !stored || picked.join() !== stored.levels.join();
        state.keyLevels[asset] = { levels: picked, picked: now, method: METHOD };
        sides = levelCrossings(price, picked, sides, KL.confirmPct).sides;
        console.log(`${asset} key levels: ${picked.map(px).join(' / ')}${changed ? ' (new)' : ''}`);
        if (changed) pushes.push(levelsMessage(asset, price, picked, stored));
      }
    }
    state.levels[asset] = sides;
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

  // Tactics: ring when the BUY or SELL rules met go from 5 or fewer to all 6
  // (same decide() as the tab); re-arms once below 6. A failed fetch keeps the old state.
  if (TAC_CONFIG.alertAssets.includes(asset)) {
    try {
      const d = await collectTac(asset, TAC_CONFIG);
      const t = sixOfSix(d.decision, state.tactics[asset] ?? null);
      state.tactics[asset] = t.state;
      console.log(`${asset} tactics: ${d.decision.met}/${RULES_TOTAL} ${d.decision.side || ''} -> ${d.decision.action}` + (d.missing.length ? ` (missing: ${d.missing.join(', ')})` : ''));
      if (t.fire) pushes.push(tacticsMessage(d));
      if (!tacNow) tacNow = d;
    } catch (e) {
      console.log(`${asset} tactics unavailable: ${e.message}`);
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
  const lv = Object.entries(state.keyLevels).map(([a, k]) => `${a} crosses ${k.levels.map(px).join(' / ')}`).join(', ') || 'the price crosses a key level';
  pushes.push({ title: 'Dealer and level alerts are on', priority: 3, tags: 'white_check_mark', click: '#mm',
    body: `You will also get a message when ${MM_CONFIG.alertAssets.join(' or ')} dealers start losing (and when they stop), and when ${lv}.\nNow: ` + mmSummary.join(' · ') });
}

// And the Tactics alert: one test push per side, in the alert's own format, sent once.
// (welcomedTac 2 = the BUY + SELL pair; the first, sell-only test was `true`.)
if (state.welcomedTac !== 2 && process.env.NTFY_TOPIC && tacNow) {
  state.welcomedTac = 2;
  pushes.push(tacticsMessage(tacNow, 'buy'), tacticsMessage(tacNow, 'sell'));
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

function ukTime(t) {
  const d = new Date(t);
  return d.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }) + ' UK (' +
    d.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }) + ')';
}

// price = the close of the finished candle that confirmed it; end = when it closed.
function levelMessage(asset, price, end, crossed, levels, zone, r, KL) {
  const down = crossed[0].dir === 'down';
  const names = crossed.map(x => px(x.level));
  // The next level in the direction of travel, if any.
  const next = levels.filter(L => down ? L < price : L > price).sort((a, b) => down ? b - a : a - b)[0];
  return {
    title: `${asset} ${down ? 'below' : 'above'} ${names.join(' and ')} (15m close ${px(price)})`,
    body: `${asset} crossed ${down ? 'below' : 'above'} the ${names.join(' and ')} gamma level: the 15-minute candle to ${ukTime(end)} closed at ${px(price)}, ` +
      `at least ${KL.confirmPct}% past it.\n` +
      `Watching for a reversal: if a 15-minute candle closes back ${down ? 'above' : 'below'} ${names[0]} (by ${KL.confirmPct}%) in the next ${KL.reversalHours} hours, you get a second alert.\n` +
      (next ? `Next level ${down ? 'below' : 'above'}: ${px(next)}.\n` : '') +
      `Fragility: ${r.score.toFixed(0)} ${zone}.`,
    priority: 4,
    tags: down ? 'chart_with_downwards_trend' : 'chart_with_upwards_trend',
    click: '#flow',
  };
}

// The break failed: a candle closed back through the level. Louder than the break.
function reversalMessage(asset, price, end, b, levels) {
  const wasUp = b.dir === 'up', L = px(b.level);
  const hrs = (end - b.at) / 36e5;
  const ago = hrs < 1 ? 'under an hour' : `${Math.round(hrs)} hour${Math.round(hrs) === 1 ? '' : 's'}`;
  const next = levels.filter(x => wasUp ? x < price : x > price).sort((a, d) => wasUp ? d - a : a - d)[0];
  return {
    title: `${asset} reversal at ${L}: back ${wasUp ? 'below' : 'above'} (15m close ${px(price)})`,
    body: `${asset} broke ${wasUp ? 'above' : 'below'} ${L} on the 15-minute close at ${ukTime(b.at)}, got as far as ${px(b.extreme)}, ` +
      `and closed back ${wasUp ? 'below' : 'above'} at ${px(price)} at ${ukTime(end)} (${ago} later).\n` +
      `What it means: the break ${wasUp ? 'up' : 'down'} failed; price is turning back ${wasUp ? 'down' : 'up'} from the gamma level.\n` +
      (next ? `Next level ${wasUp ? 'below' : 'above'}: ${px(next)}.\n` : '') +
      'Context, not a trade signal.',
    priority: 5,
    tags: wasUp ? 'leftwards_arrow_with_hook,chart_with_downwards_trend' : 'leftwards_arrow_with_hook,chart_with_upwards_trend',
    click: '#flow',
  };
}

// Quiet note (no sound) when the alert levels change, so you know what's watched.
function levelsMessage(asset, price, levels, before) {
  const below = levels.filter(L => L < price).map(px), above = levels.filter(L => L > price).map(px);
  return {
    title: `${asset} alert levels: ${levels.map(px).join(' / ')}`,
    body: `New ${asset} key levels for phone alerts (now ${px(price)}).\n` +
      `Above: ${above.join(' / ') || 'none'}. Below: ${below.join(' / ') || 'none'}.\n` +
      'Picked from the strikes with the most open calls + puts within 15% (big gamma levels).' +
      (before ? ` Before: ${before.levels.map(px).join(' / ')}.` : ''),
    priority: 2,
    tags: 'pushpin',
    click: '#play',
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

// "Tactics 6/6 BUY|SELL" with asset, UK time and price.
// test = 'buy' or 'sell': a one-time check of that side's message on the phone.
function tacticsMessage(d, test) {
  const at = new Date(d.fetched);
  const uk = at.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
  const day = at.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' });
  const s = d.setup, dec = d.decision;
  const action = test || dec.action, act = action.toUpperCase();
  const tg = (s.targets || [])[0];
  const levels = s.pivot ? `Pivot ~${px(s.pivot)}, stop ~${px(s.stop)}` + (tg ? `, first target ~${px(tg.price)} (${tg.r.toFixed(1)}R)` : '') + '.\n' : '';
  const now = `${dec.met}/${RULES_TOTAL} ${dec.short === false ? 'buy' : 'sell'} rules`;
  return {
    title: `Tactics 6/6 ${act}${test ? ' [test]' : ''} - ${d.asset} ${px(d.spot)} at ${uk} UK`,
    body: (test
      ? `Test: this is the message you will get when all ${RULES_TOTAL} ${act} rules on the Tactics tab are met. Nothing to do now (right now: ${now}).\n`
      : `All ${RULES_TOTAL} ${act} rules on the Tactics tab are met.\n` + levels) +
      `${d.asset} ${px(d.spot)} at ${uk} UK time (${day}).\nContext, not a trade signal.`,
    priority: test ? 3 : 4,
    tags: action === 'buy' ? 'chart_with_upwards_trend' : 'chart_with_downwards_trend',
    click: '#tactics',
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
