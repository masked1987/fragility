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
import { stickyZone, levelEvents } from '../tools/fragility/alerts.js';
import { pickLevels, needsRepick, METHOD } from '../shared/levels.js';
import { closedCandles } from '../shared/sources/gate.js';
import { CONFIG } from '../tools/fragility/config.js';
import { collectMM } from '../tools/market-maker/collect.js';
import { readMM, readCarry, dealerSide } from '../tools/market-maker/read.js';
import { MM_CONFIG } from '../tools/market-maker/config.js';
import { collectTac } from '../tools/tactics/collect.js';
import { sixOfSix, RULES_TOTAL } from '../tools/tactics/model.js';
import { TAC_CONFIG } from '../tools/tactics/config.js';
import { collectAlt, withPoints } from '../tools/alt-tactics/collect.js';
import { altEvents, stopFrom, pickTarget } from '../tools/alt-tactics/model.js';
import { ALT_CONFIG } from '../tools/alt-tactics/config.js';
import { mmEvents } from '../tools/market-maker/flip.js';
import { collectTrend } from '../tools/trend/collect.js';
import { trendEvents } from '../tools/trend/model.js';
import { TREND_CONFIG } from '../tools/trend/config.js';

const DIR = process.argv[2] || 'store';
const STATE = join(DIR, 'state.json');
const LOG = join(DIR, 'log.csv');
const LOG_EVERY_MS = 55 * 60e3; // the job runs every 15 min; log about hourly
const ZONE_REPEATS = 3;           // a zone change rings this many times...
const REPEAT_GAP_S = 60;          // ...this many seconds apart, then stops
const TACTICS_REPEATS = 3;        // Tactics 6/6 rings 3 times (owner tried 5, then "3 is enough"), same gap
const ALT_REPEATS = 3;            // Alt Tactics BUY / SELL rings like Tactics 6/6
const ALT_MAX_AGE = 24 * 36e5;    // Alt events older than this are not pushed (the job can run hours late)
const MMS_REPEATS = 3;            // Market Maker strategy BUY / SELL rings like the other trade alerts
const TREND_REPEATS = 3;          // Trend BUY / SELL (daily close crosses the 50-day average) rings like the other trade alerts
const SIDE_WORDS = { win: 'winning', even: 'balanced', lose: 'losing' };
const COLUMNS = ['time', 'asset', 'price', 'score', 'zone', 'funding', 'basis', 'oi_level', 'oi_change', 'gamma', 'coverage'];

const firstRun = !existsSync(STATE);
const state = firstRun ? { zones: {}, lastLog: {} } : JSON.parse(readFileSync(STATE, 'utf8'));
state.dealers = state.dealers || {};
state.levels = state.levels || {};
state.keyLevels = state.keyLevels || {};
state.breaks = state.breaks || {};
state.lastCandle = state.lastCandle || {};
state.lastClose = state.lastClose || {};
state.quiet = state.quiet || {};
state.tactics = state.tactics || {};
state.alt = state.alt || {};
state.mmStrat = state.mmStrat || {};
state.trend = state.trend || {};
if (!existsSync(LOG)) writeFileSync(LOG, COLUMNS.join(',') + '\n');

const now = Date.now();
const summary = [];
const mmSummary = [];
const pushes = [];
let tacNow = null; // latest Tactics reading, for the one-time test push
let altNow = null; // latest Alt Tactics reading, for its one-time welcome push
let mmsNow = null; // latest Market Maker reading with its strategy state, for its welcome / test push
let trendNow = null; // latest Trend reading, for its welcome / test push
// Started by hand with "send test alerts" ticked: one [test] message per alert kind.
// TEST_ALERTS: 'all' (or 'true') = zone, dealers, Tactics, Alt and the Market Maker strategy;
// 'tactics' / 'alt' / 'mm' / 'trend' = that one only.
const TEST = ['true', 'all', 'tactics', 'alt', 'mm', 'trend'].includes(process.env.TEST_ALERTS) ? process.env.TEST_ALERTS : null;
const testNow = {}; // first asset's readings for those tests

for (const asset of CONFIG.assets) {
  const data = await collect(asset);
  const r = evaluate(data, CONFIG);
  const failed = r.sources.filter(s => !s.ok).map(s => s.name);
  console.log(`${asset}: ${r.score == null ? 'n/a' : r.score.toFixed(1)} ${r.zone || ''}` + (failed.length ? ` (unreachable: ${failed.join(', ')})` : ''));
  if (r.score == null) continue;

  const prev = state.zones[asset] || null;
  if (!testNow.zone) testNow.zone = { asset, r };
  const zone = stickyZone(Math.round(r.score), CONFIG.zones, prev, CONFIG.hysteresis) || r.zone;
  state.zones[asset] = zone;
  summary.push(`${asset} ${r.score.toFixed(0)} ${zone}`);
  if (prev && prev !== zone) pushes.push(zoneMessage(asset, prev, zone, r));

  const price = data.futures ? data.futures.spot : data.options ? data.options.spot : null;

  // Key gamma levels, picked automatically (shared/levels.js). With KL.alerts off
  // (the owner only wants Tactics 6/6) nothing here rings: the levels are still
  // picked and saved for the Playbook, and breaks still tracked so state stays
  // current if the alerts are turned back on. Finished 15-minute
  // Gate candles are walked in order since the last check (so nothing is missed
  // when GitHub runs late), and any trade through a level counts, spike or not:
  // a break rings once; trading back through within reversalHours rings louder (a
  // reversal); through and back in one candle rings once as a spike. Breaks are
  // kept apart from the level list, so a level dropped at the daily re-pick still
  // gets its reversal.
  const KL = CONFIG.keyLevels;
  if (KL.assets.includes(asset) && price) {
    const stored = state.keyLevels[asset] || null;
    const levels = stored ? stored.levels : [];
    let breaks = state.breaks[asset] || [], quiet = state.quiet[asset] || {};
    let closes = [];
    try {
      closes = await closedCandles(asset, KL.candleMinutes, 48, now);
    } catch (e) {
      console.log(`${asset} candles unavailable (levels not checked this run): ${e.message}`);
    }
    const last = state.lastCandle[asset];
    let todo = last ? closes.filter(c => c.t > last) : closes.slice(-1); // first run: just the latest
    // The close before the first new candle: where price was coming from.
    let prev = state.lastClose[asset] ?? (closes.filter(c => c.t < (todo[0] || {}).t).pop() || {}).close ?? null;
    for (const c of todo) {
      const end = c.t + KL.candleMinutes * 6e4; // when this candle closed
      const ev = levelEvents(c, prev, levels, breaks, quiet, end, KL.reversalHours * 36e5, KL.quietMinutes * 6e4);
      breaks = ev.breaks; quiet = ev.quiet;
      if (KL.alerts) for (const e of ev.events) pushes.push(levelEventMessage(asset, e, end, levels, zone, r, KL));
      prev = c.close;
    }
    if (todo.length) {
      state.lastCandle[asset] = todo[todo.length - 1].t;
      state.lastClose[asset] = prev;
      console.log(`${asset} levels: checked ${todo.length} candle(s), last close ${px(prev)}; watching ${breaks.length} break(s)`);
    }
    state.breaks[asset] = breaks;
    state.quiet[asset] = quiet;
    if (needsRepick(stored, price, now, KL.repickHourUtc) && data.options) {
      const picked = pickLevels(data.options.options, price, now, KL).map(l => l.price);
      if (picked.length) {
        const changed = !stored || picked.join() !== stored.levels.join();
        state.keyLevels[asset] = { levels: picked, picked: now, method: METHOD };
        console.log(`${asset} key levels: ${picked.map(px).join(' / ')}${changed ? ' (new)' : ''}`);
        if (changed && KL.alerts) pushes.push(levelsMessage(asset, price, picked, stored));
      }
    }
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
      if (!testNow.mm) testNow.mm = { asset, side, mm, zone, r };
      if (prevSide && prevSide !== side && (side === 'lose' || prevSide === 'lose')) pushes.push(dealerMessage(asset, prevSide, side, mm, zone, r));
      // Market Maker strategy (asked 2 Nov 2026 "create alert for market maker strategy,
      // but also add stop loss and TP"): the same flipState() as the tab's card. BUY / SELL
      // rings 3 times with entry, SL and TP; TP hit, SL hit and closed after 3 days once.
      if (mm.flip) {
        const st = state.mmStrat[asset] = state.mmStrat[asset] || { since: now, sent: {} };
        const ev = mmEvents(mm.flip, st.sent, st.since, now, ALT_MAX_AGE);
        for (const e of ev) { st.sent[e.key] = now; pushes.push(mmsMessage(mm, e)); }
        for (const k of Object.keys(st.sent)) if (now - st.sent[k] > 10 * 864e5) delete st.sent[k];
        const o = mm.flip.open;
        console.log(`${asset} mm strategy: ${o ? (o.buy ? 'BUY' : 'SELL') + ' open from ' + num(o.entry) + ', SL ' + num(o.stop) + ', TP ' + num(o.target) : 'wait'}` +
          ` (gap ${mm.flip.now.gap.toFixed(1)})` + (ev.length ? ` -> ${ev.map(e => e.kind).join(', ')}` : ''));
        if (!mmsNow) mmsNow = mm;
      }
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
      const sd = d.decision.sides || {}, side = k => sd[k] ? `${k} ${sd[k].met}/${RULES_TOTAL} at ${Math.round(sd[k].setup.pivot)}` : `${k} none`;
      console.log(`${asset} tactics: ${side('sell')}, ${side('buy')} -> ${d.decision.action}` + (d.missing.length ? ` (missing: ${d.missing.join(', ')})` : ''));
      if (t.fire) pushes.push(tacticsMessage(d));
      if (!tacNow) tacNow = d;
    } catch (e) {
      console.log(`${asset} tactics unavailable: ${e.message}`);
    }
  }

  // Alt Tactics (asked 2 Nov 2026, "add the NTFY alert ... about our rules"): the same
  // decideAlt() as the tab. BUY / SELL rings 3 times; WATCH, target hit and stopped once.
  // Each event is pushed once (state.alt[asset].sent); nothing from before the first run.
  if (ALT_CONFIG.alertAssets.includes(asset)) {
    try {
      const d = await collectAlt(asset, ALT_CONFIG);
      const st = state.alt[asset] = state.alt[asset] || { since: now, sent: {} };
      const ev = altEvents(d.decision, st.sent, st.since, now, ALT_MAX_AGE);
      for (const e of ev) { st.sent[e.key] = now; pushes.push(altMessage(d, e)); }
      for (const k of Object.keys(st.sent)) if (now - st.sent[k] > 10 * 864e5) delete st.sent[k];
      const o = d.decision.open;
      console.log(`${asset} alt: ${d.decision.action}` + (o ? ` (${o.side} from ~${px(o.level)}, stop ${num(o.signal.stop)})` : '') + (ev.length ? ` -> ${ev.map(e => e.kind).join(', ')}` : ''));
      if (!altNow) altNow = d;
    } catch (e) {
      console.log(`${asset} alt tactics unavailable: ${e.message}`);
    }
  }

  // Trend (asked 2 Nov 2026: "alerts when to enter, what's TP and stop loss", kept as
  // tested): BUY / SELL when the daily close crosses the 50-day average (rings 3 times);
  // while IN, one quiet message per daily close with tonight's line (the moving stop).
  // Same model as the tab. Nothing from before the first run (that run only saves the state).
  if (TREND_CONFIG.alertAssets.includes(asset)) {
    try {
      const d = await collectTrend(asset, TREND_CONFIG), m = d.model;
      const ev = trendEvents(m, state.trend[asset] || null, now, TREND_CONFIG.alertMaxHours * 36e5);
      for (const e of ev.events) pushes.push(trendMessage(d, e));
      if (ev.daily) pushes.push(trendDaily(d));
      state.trend[asset] = ev.next;
      console.log(`${asset} trend: ${m.on ? 'IN' : 'OUT'} (close ${num(m.close)}, avg ${num(m.avg)}, tonight's line ${num(m.line)})` +
        (ev.events.length ? ` -> ${ev.events.map(e => e.kind).join(', ')}` : '') + (ev.daily ? ' -> daily line' : ''));
      if (!trendNow) trendNow = d;
    } catch (e) {
      console.log(`${asset} trend unavailable: ${e.message}`);
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

// Test run: the real format of each alert that is on, marked [test], sent once each.
if (TEST) {
  const mark = (p, note) => ({ ...p, title: '[test] ' + p.title, body: 'TEST ONLY, nothing changed. ' + note + '\nA real alert looks like this:\n' + p.body, repeats: 1 });
  if ((TEST === 'all' || TEST === 'true') && testNow.zone) {
    const { asset, r } = testNow.zone, zone = state.zones[asset];
    const i = CONFIG.zones.findIndex(z => z.name === zone), to = CONFIG.zones[i < CONFIG.zones.length - 1 ? i + 1 : i - 1].name;
    pushes.push(mark(zoneMessage(asset, zone, to, r), `${asset} Fragility is ${r.score.toFixed(0)} ${zone}. Real zone changes ring 3 times, a minute apart.`));
  }
  if ((TEST === 'all' || TEST === 'true') && testNow.mm) {
    const { asset, side, mm, zone, r } = testNow.mm;
    pushes.push(mark(dealerMessage(asset, side === 'lose' ? 'even' : side, 'lose', mm, zone, r),
      `${asset} dealers are ${SIDE_WORDS[side]} now. "Now losing" rings 3 times; "no longer losing" rings once.`));
  }
  if (mmsNow && (TEST === 'all' || TEST === 'true' || TEST === 'mm')) {
    // The last signal in the 30 days the tab sees, else one built from today's numbers.
    const g = mmsNow.flip.last || mmsSample(mmsNow);
    const p = mmsMessage(mmsNow, { kind: 'signal', trade: g });
    pushes.push({ ...p, title: '[test] ' + p.title, body: 'TEST ONLY: ' + (mmsNow.flip.last ? 'the last Market Maker strategy signal' : 'no signal in the last 30 days, so this uses today\'s numbers') +
      ' in the format of a real one (rings ' + MMS_REPEATS + ' times).\n' + p.body });
  }
  if (tacNow && (TEST === 'all' || TEST === 'true' || TEST === 'tactics')) pushes.push({ ...tacticsMessage(tacNow, 'sell'), repeats: TACTICS_REPEATS }); // rings like the real one
  if (altNow && (TEST === 'all' || TEST === 'true' || TEST === 'alt')) {
    // The last Alt signal in the ~3.5 days the tab sees, else a sample at the nearest huge
    // level below with a made-up 1% dip (so the test always shows the real format).
    const last = altNow.decision.setups.filter(x => x.taken).pop(), s = last || altSample(altNow);
    if (s) {
      const p = altMessage(altNow, { kind: 'signal', setup: s });
      pushes.push({ ...p, title: '[test] ' + p.title, body: 'TEST ONLY: ' + (last ? 'the last Alt signal' : 'no Alt signal in the last 3.5 days, so this is a sample dip of 1% through ~' +
        px(s.level) + ' with today\'s levels') + ' in the format of a real one (rings ' + ALT_REPEATS + ' times).\n' + p.body });
    }
  }
  if (trendNow && (TEST === 'all' || TEST === 'true' || TEST === 'trend')) {
    // The last real BUY in the real format (its own stop line then), then the daily line message.
    const m = trendNow.model, a = trendNow.asset;
    const b = m.states.filter((s, i) => i > 0 && s.on && !m.states[i - 1].on).pop();
    if (b) {
      const e = { kind: 'buy', t: b.t, close: b.close, avg: b.avg, line: b.line };
      const p = trendMessage(trendNow, e, true);
      pushes.push({ ...p, title: '[test] ' + p.title, body: 'TEST ONLY: the last real Trend BUY (' + altDay(b.t) + '), in the format of a real one (rings ' + TREND_REPEATS + ' times). ' + a + ' is ' + (m.on ? 'IN' : 'OUT') + ' now.\n' + p.body });
      const q = trendDaily(trendNow, e);
      pushes.push({ ...q, title: '[test] ' + q.title, body: 'TEST ONLY: while IN you get this once a day, quietly (here: the day after that BUY).\n' + q.body });
    }
  }
  console.log('test alerts queued:', pushes.length);
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

// And the Market Maker strategy alerts: one message saying what will come.
if (!state.welcomedMMS && process.env.NTFY_TOPIC && mmsNow) {
  state.welcomedMMS = true;
  const f = mmsNow.flip, o = f.open, a = mmsNow.asset;
  pushes.push({ title: 'Market Maker strategy alerts are on', priority: 3, tags: 'white_check_mark', click: '#mm',
    body: `You will get a message here when the Market Maker strategy fires on ${MM_CONFIG.alertAssets.join(', ')}:\n` +
      `BUY / SELL (rings ${MMS_REPEATS} times) with entry, stop loss and take profit;\nthen TP hit, SL hit, or closed after 3 days.\n` +
      (o ? `Now: ${o.buy ? 'BUY' : 'SELL'} open from ${num(o.entry)}, SL ${num(o.stop)}, TP ${num(o.target)}.`
        : `Now: WAIT, dealers ${SIDE_WORDS[f.now.side]} (gap ${f.now.gap >= 0 ? '+' : ''}${f.now.gap.toFixed(1)}, the signal is at -${MM_CONFIG.gapPts}). ${a} ${num(f.now.price)}.`) });
}

// And the Alt Tactics alerts: one message saying what will come, with where things stand.
if (!state.welcomedAlt && process.env.NTFY_TOPIC && altNow) {
  state.welcomedAlt = true;
  const o = altNow.decision.open, w = altNow.decision.waiting;
  const nowLine = o ? `Now: ${o.side === 'buy' ? 'BUY' : 'SELL'} from ~${px(o.level)} running, entry ${num(o.signal.entry)}, stop loss ${num(o.signal.stop)}, target ~${px(o.signal.target)}.`
    : w ? `Now: WATCH, ${altNow.asset} ${w.side === 'buy' ? 'dipped through' : 'spiked over'} ~${px(w.level)}.` : 'Now: WAIT, no dip through a huge level.';
  pushes.push({ title: 'Alt Tactics alerts are on', priority: 3, tags: 'white_check_mark', click: '#alt',
    body: `You will get a message here when your rules fire on ${ALT_CONFIG.alertAssets.join(', ')}:\n` +
      `BUY / SELL (rings ${ALT_REPEATS} times) with entry, stop loss and target;\nWATCH when price dips through a huge level;\ntarget hit or stopped.\n` + nowLine });
}

// And the Trend alerts: one message saying what will come, with where things stand.
if (!state.welcomedTrend && process.env.NTFY_TOPIC && trendNow) {
  state.welcomedTrend = true;
  const m = trendNow.model, a = trendNow.asset;
  pushes.push({ title: 'Trend alerts are on', priority: 3, tags: 'white_check_mark', click: '#trend',
    body: `You will get a message here when ${a}'s daily close (00:00 UTC) crosses its ${TREND_CONFIG.days}-day average:\n` +
      `BUY (rings ${TREND_REPEATS} times) with the entry and the stop line;\nwhile IN, a quiet message after each daily close with tonight's stop line;\n` +
      `SELL (rings ${TREND_REPEATS} times) on the first daily close under it, with the result. No take profit: it rides the trend.\n` +
      (m.on ? `Now: IN since ${altDay(m.since.t)} (${num(m.since.price)}). Tonight's stop line ${num(m.line)}; price ${num(trendNow.price)}.`
        : `Now: OUT since ${altDay(m.since.t)}. A daily close above ${num(m.line)} tonight is a BUY; price ${num(trendNow.price)}.`) });
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

// A gamma-level event from levelEvents(): 'break', 'reversal' or 'spike'.
// end = when the candle that showed it closed.
function levelEventMessage(asset, e, end, levels, zone, r, KL) {
  const up = e.dir === 'up', L = px(e.level), c = e.c;
  const nextFrom = (p, goingUp) => levels.filter(x => goingUp ? x > p : x < p).sort((a, b) => goingUp ? a - b : b - a)[0];
  if (e.kind === 'break') {
    const next = nextFrom(e.level, up);
    return {
      title: `${asset} crossed ${up ? 'above' : 'below'} ${L} (${up ? 'high' : 'low'} ${px(e.extreme)})`,
      body: `${asset} traded ${up ? 'above' : 'below'} the ${L} gamma level: ${up ? 'high' : 'low'} ${px(e.extreme)} in the 15-minute candle to ${ukTime(end)}, which closed at ${px(c.close)}.\n` +
        `Watching for a reversal: if it trades back ${up ? 'below' : 'above'} ${L} in the next ${KL.reversalHours} hours, you get a second alert.\n` +
        (next ? `Next level ${up ? 'above' : 'below'}: ${px(next)}.\n` : '') +
        `Fragility: ${r.score.toFixed(0)} ${zone}.`,
      priority: 4,
      tags: up ? 'chart_with_upwards_trend' : 'chart_with_downwards_trend',
      click: '#flow',
    };
  }
  const next = nextFrom(e.level, !up);
  const tail = `What it means: the push ${up ? 'up' : 'down'} through the gamma level failed; price is turning back ${up ? 'down' : 'up'}.\n` +
    (next ? `Next level ${up ? 'below' : 'above'}: ${px(next)}.\n` : '') + 'Context, not a trade signal.';
  const tags = 'leftwards_arrow_with_hook,' + (up ? 'chart_with_downwards_trend' : 'chart_with_upwards_trend');
  if (e.kind === 'spike') return {
    title: `${asset} spiked through ${L} and back (${up ? 'high' : 'low'} ${px(e.extreme)}, close ${px(c.close)})`,
    body: `In the 15-minute candle to ${ukTime(end)}, ${asset} traded ${up ? 'above' : 'below'} ${L} (to ${px(e.extreme)}) and closed back ${up ? 'below' : 'above'} at ${px(c.close)}.\n` + tail,
    priority: 5, tags: tags, click: '#flow',
  };
  const hrs = (end - e.at) / 36e5;
  const ago = hrs < 1 ? 'under an hour' : `${Math.round(hrs)} hour${Math.round(hrs) === 1 ? '' : 's'}`;
  return {
    title: `${asset} reversal at ${L}: back ${up ? 'below' : 'above'} (${up ? 'low' : 'high'} ${px(up ? c.low : c.high)})`,
    body: `${asset} crossed ${up ? 'above' : 'below'} ${L} in the candle to ${ukTime(e.at)}, got as far as ${px(e.extreme)}, and traded back ${up ? 'below' : 'above'} in the candle to ${ukTime(end)} ` +
      `(${up ? 'low' : 'high'} ${px(up ? c.low : c.high)}, close ${px(c.close)}), ${ago} later.\n` + tail,
    priority: 5, tags: tags, click: '#flow',
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
  const dec = d.decision, s = dec.setup || d.setup; // the side that fired (SELL above or BUY below)
  const action = test || dec.action, act = action.toUpperCase();
  const tg = (s.targets || [])[0];
  const levels = s.pivot ? `Pivot ~${px(s.pivot)}, stop ~${px(s.stop)}` + (tg ? `, first target ~${px(tg.price)} (${tg.r.toFixed(1)}R)` : '') + '.\n' : '';
  const now = `${dec.met}/${RULES_TOTAL} ${dec.short === false ? 'buy' : 'sell'} rules`;
  return {
    title: `Tactics 6/6 ${act}${test ? ' [test]' : ''} - ${d.asset} ${px(d.spot)} at ${uk} UK`,
    body: (test
      ? `Test: this is the message you will get when all ${RULES_TOTAL} ${act} rules on the Tactics tab are met. A real one rings ${TACTICS_REPEATS} times, a minute apart. Nothing to do now (right now: ${now}).\n`
      : `All ${RULES_TOTAL} ${act} rules on the Tactics tab are met.\n` + levels) +
      `${d.asset} ${px(d.spot)} at ${uk} UK time (${day}).\nContext, not a trade signal.`,
    priority: test ? 3 : 4,
    repeats: test ? 1 : TACTICS_REPEATS,
    tags: action === 'buy' ? 'chart_with_upwards_trend' : 'chart_with_downwards_trend',
    click: '#tactics',
  };
}

// Alt Tactics messages. e = { kind: 'signal' | 'watch' | 'target' | 'stopped', setup }.
function altMessage(d, e) {
  const s = e.setup, g = s.signal, buy = s.side === 'buy', a = d.asset, L = px(s.level);
  const pts = (ALT_CONFIG.stopPoints && ALT_CONFIG.stopPoints[a]) || 0;
  const stopWhy = (pts ? `${pts} points ${buy ? 'under the low' : 'over the high'} ` : (buy ? 'the low ' : 'the high ')) + num(s.ext);
  const end = '\nContext, not a trade signal.';
  if (e.kind === 'signal') {
    const late = now - g.t > 30 * 6e4;
    return {
      title: `Alt ${buy ? 'BUY' : 'SELL'} - ${a} ${num(g.entry)} at ${altUk(g.t)} UK`,
      body: (buy ? `${a} dipped through ~${L} and buyers are back (5-min Ichimoku crossed ${ALT_CONFIG.scoreBuy}).`
          : `${a} spiked over ~${L} after the buy from ~${px(s.win ? s.win.from : s.level)} reached its target, and sellers are back (5-min Ichimoku through ${ALT_CONFIG.scoreSell}). Sells are unproven.`) +
        `\nEntry ${num(g.entry)}\nStop loss ${num(g.stop)} (${stopWhy}, ${num(Math.abs(g.entry - g.stop))} points)` +
        `\nTarget ~${px(g.target)}` + (g.rr ? ` (${g.rr.toFixed(1)}x the risk)` : '') +
        (late ? `\nThe signal was at ${altUk(g.t)} UK (${altDay(g.t)}); price now ${num(d.spot)}. Entering late means less reward, same stop.` : '') + end,
      priority: 4, repeats: ALT_REPEATS, tags: buy ? 'chart_with_upwards_trend' : 'chart_with_downwards_trend', click: '#alt',
    };
  }
  if (e.kind === 'watch') {
    const stop = buy ? s.ext - pts : s.ext + pts;
    return {
      title: `Alt WATCH - ${a} ${buy ? 'dipped through' : 'spiked over'} ~${L}`,
      body: `${buy ? 'Low' : 'High'} so far ${num(s.ext)}; stop loss so far ${num(stop)} (moves if the ${buy ? 'low goes lower' : 'high goes higher'}).` +
        `\nWaiting for ${buy ? 'buyers' : 'sellers'}: 5-min Ichimoku ${buy ? 'up through ' + ALT_CONFIG.scoreBuy : 'down through ' + ALT_CONFIG.scoreSell}.` +
        (s.target ? ` Target if it triggers ~${px(s.target)}.` : '') + `\n${a} ${num(d.spot)} at ${altUk(now)} UK.` + end,
      priority: 3, tags: 'eyes', click: '#alt',
    };
  }
  const won = e.kind === 'target', R = won ? Math.abs(g.target - g.entry) / Math.abs(g.entry - g.stop) : -1;
  const nb = d.decision.nextBuy;
  return {
    title: won ? `Alt target hit - ${a} ~${px(g.target)}` : `Alt stopped - ${a} ${num(g.stop)}`,
    body: `The ${buy ? 'buy' : 'sell'} from ~${L} (entry ${num(g.entry)}) ${won ? 'reached ~' + px(g.target) : 'hit its stop loss ' + num(g.stop)} at ${altUk(s.trade.at)} UK, about ${R >= 0 ? '+' : ''}${R.toFixed(1)}R.` +
      (won ? (buy ? `\nYour rule: a spike over ~${px(g.target)} in the next ${ALT_CONFIG.afterWinHours} h with sellers back is a sell.` : `\n~${px(g.target)} is open for a buy again.`)
        : `\n~${L} is used now: the next ${buy ? 'buy' : 'sell'} only comes at another huge level` + (buy && nb ? ` (nearest ~${px(nb)})` : '') + '.') + end,
    priority: won ? 4 : 3, tags: won ? 'tada' : 'x', click: '#alt',
  };
}
// Market Maker strategy messages. e = { kind: 'signal' | 'target' | 'stopped' | 'time', trade }.
function mmsMessage(mm, e) {
  const g = e.trade, buy = g.buy, a = mm.asset, f = MM_CONFIG.flip;
  const risk = Math.abs(g.entry - g.stop), reward = Math.abs(g.target - g.entry), pc = x => (x / g.entry * 100).toFixed(1) + '%';
  const end = '\nContext, not a trade signal.';
  if (e.kind === 'signal') {
    const late = now - g.t > 30 * 6e4;
    return {
      title: `Market Maker ${buy ? 'BUY' : 'SELL'} - ${a} ${num(g.entry)} at ${altUk(g.t)} UK`,
      body: `${a} dealers just turned losing (moving more than options priced), and ${a} went ${buy ? 'up' : 'down'} ${Math.abs(g.ret24 * 100).toFixed(1)}% in 24h, so ${buy ? 'buy' : 'sell'}.` +
        `\nEntry ${num(g.entry)}` +
        `\nStop loss ${num(g.stop)} (${num(risk)} points, ${pc(risk)}: half a day's move)` +
        `\nTake profit ${num(g.target)} (${num(reward)} points, ${pc(reward)}: 2 day's moves, 4x the risk)` +
        `\nIf neither is hit: out at the price on ${altDay(g.t + f.maxHours * 36e5)} ${altUk(g.t + f.maxHours * 36e5)} UK (3 days).` +
        (late ? `\nThe signal was at ${altUk(g.t)} UK (${altDay(g.t)}); price now ${num(mm.price)}. Entering late changes the risk; SL and TP stay where they are.` : '') + end,
      priority: 4, repeats: MMS_REPEATS, tags: buy ? 'chart_with_upwards_trend' : 'chart_with_downwards_trend', click: '#mm',
    };
  }
  const x = g.trade, pct = ((buy ? x.exit - g.entry : g.entry - x.exit) / g.entry * 100);
  const res = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
  const head = { target: `Market Maker TP hit - ${a} ${num(g.target)}`, stopped: `Market Maker SL hit - ${a} ${num(g.stop)}`, time: `Market Maker closed after 3 days - ${a} ${num(x.exit)}` }[e.kind];
  return {
    title: head,
    body: `The ${buy ? 'buy' : 'sell'} from ${num(g.entry)} (${altDay(g.t)}) ` +
      (e.kind === 'target' ? `reached its take profit ${num(g.target)}` : e.kind === 'stopped' ? `hit its stop loss ${num(g.stop)}` : `hit neither SL ${num(g.stop)} nor TP ${num(g.target)} in 3 days; out at ${num(x.exit)}`) +
      ` at ${altUk(x.at)} UK: ${res}.` +
      `\nThe next signal comes when dealers stop losing and then turn losing again.` + end,
    priority: e.kind === 'target' ? 4 : 3, tags: e.kind === 'target' ? 'tada' : e.kind === 'stopped' ? 'x' : 'hourglass', click: '#mm',
  };
}
// Trend messages. e = { kind: 'buy' | 'sell', t (the 00:00 UTC close), close, avg, trade }.
// The stop is a rule on the daily close (tonight's line), not an intraday stop order;
// there is no take profit (as tested).
function trendMessage(d, e, sample) {
  const m = d.model, a = d.asset, buy = e.kind === 'buy', N = TREND_CONFIG.days, end = '\nContext, not a trade signal.';
  const when = `00:00 UTC (${altUk(e.t)} UK, ${altDay(e.t)})`;
  const late = !sample && now - e.t > 2 * 36e5 ? `\nThat close was at ${altUk(e.t)} UK; price now ${num(d.price)}.` : '';
  if (buy) {
    const line = sample ? e.line : m.line, gap = e.close - line;
    return {
      title: `Trend BUY - ${a} ${num(e.close)} (daily close over the ${N}-day avg)`,
      body: `${a} closed at ${num(e.close)} at ${when}, above its ${N}-day average ${num(e.avg)}. Buy and hold.` +
        `\nEntry ${num(e.close)} (the daily close)` +
        `\nStop loss: a daily close under ${num(line)} tonight` + (gap > 0 ? ` (${num(gap)} points, ${(gap / e.close * 100).toFixed(1)}% under the entry)` : ' (already at the entry: a close under it is a sell)') +
        `. It's a rule on the 00:00 UTC close, not a stop order: a dip under it during the day doesn't count. The line moves every day; you'll get it here after each close.` +
        `\nTake profit: none. Ride the trend; sell only when a daily close is under the line.` + late + end,
      priority: 4, repeats: TREND_REPEATS, tags: 'chart_with_upwards_trend', click: '#trend',
    };
  }
  const t = e.trade;
  return {
    title: `Trend SELL - ${a} ${num(e.close)} (daily close under the ${N}-day avg)`,
    body: `${a} closed at ${num(e.close)} at ${when}, under its ${N}-day average ${num(e.avg)}. Sell and hold cash.` +
      (t ? `\nTrade: bought ${num(t.buy.price)} on ${altDay(t.buy.t)}, sold ${num(t.sell.price)}: ${t.pct >= 0 ? '+' : ''}${t.pct.toFixed(1)}% after costs (${Math.round((t.sell.t - t.buy.t) / 864e5)} days).` : '') +
      `\nNext buy: the first daily close above its ${N}-day average (tonight: above ${num(m.line)}).` + late + end,
    priority: 4, repeats: TREND_REPEATS, tags: 'chart_with_downwards_trend', click: '#trend',
  };
}
// sample = a past BUY event (for the test): its line and price, as the day after it.
function trendDaily(d, sample) {
  const m = d.model, a = d.asset, line = sample ? sample.line : m.line, price = sample ? sample.close : d.price;
  const o = sample ? { price: sample.close, t: sample.t } : m.open, dist = (price / line - 1) * 100;
  return {
    title: `Trend IN - ${a} stop line tonight ${num(line)}`,
    body: `Still IN. Tonight's stop line ${num(line)}: a daily close under it at 00:00 UTC (${altUk(d.nextClose)} UK) is a SELL.` +
      `\nPrice now ${num(price)} (${dist >= 0 ? '+' : ''}${dist.toFixed(1)}% from the line).` +
      (o ? `\nTrade: bought ${num(o.price)} on ${altDay(o.t)}, ${((price / o.price - 1) * 100) >= 0 ? '+' : ''}${((price / o.price - 1) * 100).toFixed(1)}% so far.` : '') +
      `\nNo take profit: it rides the trend.\nContext, not a trade signal.`,
    priority: 2, tags: 'chart_with_upwards_trend', click: '#trend',
  };
}
// A sample trade from today's numbers, for the test push when there was no signal in 30 days.
function mmsSample(mm) {
  const r = mm.flip.now, f = MM_CONFIG.flip, buy = r.ret24 >= 0, risk = f.stopMoves * r.m * r.price, reward = f.targetMoves * r.m * r.price;
  return { t: now, buy, entry: r.price, stop: buy ? r.price - risk : r.price + risk, target: buy ? r.price + reward : r.price - reward, ret24: r.ret24 };
}
// A sample Alt BUY for the test push: a 1% dip through the nearest huge level below.
function altSample(d) {
  const L = d.decision.nextBuy || d.decision.below;
  if (!L) return null;
  const cfg = withPoints(ALT_CONFIG, d.asset), ext = L * 0.99, entry = L * 1.004;
  const stop = stopFrom(ext, true, cfg), target = pickTarget(d.huge, L, 1, ALT_CONFIG);
  return { side: 'buy', level: L, ext, signal: { t: now, entry, stop, target, rr: target ? (target - entry) / (entry - stop) : null } };
}
function altUk(t) { return new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }); }
function altDay(t) { return new Date(t).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }); }
function num(x) { return x.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }

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
