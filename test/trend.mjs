// Offline checks for the Trend tab's 50-day rule (tools/trend/model.js). Run: node test/trend.mjs
import { trend, sma, tonight, trendEvents, DAY } from '../tools/trend/model.js';

let ok = true;
const check = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) ok = false; };
const mk = closes => closes.map((c, i) => ({ t: Date.UTC(2026, 0, 1) + i * DAY, close: c }));

// 1. Flat, then a rise, then a fall: one buy and one sell, at the crossing closes.
const up = [], n = 50;
for (let i = 0; i < 60; i++) up.push(100);
for (let i = 0; i < 40; i++) up.push(100 + (i + 1) * 2);   // rises to 180
for (let i = 0; i < 60; i++) up.push(180 - (i + 1) * 3);   // falls to 0
const m = trend(mk(up), n, 0.0005);
check('one finished trade', m.trades.length === 1 && !m.open);
check('bought on the first close above the average (day 61, 102)', m.trades[0].buy.price === 102 && m.trades[0].buy.t === mk(up)[60].t + DAY);
const si = Math.round((m.trades[0].sell.t - DAY - Date.UTC(2026, 0, 1)) / DAY);
check('sold at the first close under the average', up[si] === m.trades[0].sell.price && up[si] < sma(up, si, n) && up[si - 1] > sma(up, si - 1, n));
const t0 = m.trades[0];
check('trade % includes 0.05% a side', Math.abs(t0.pct - ((t0.sell.price / t0.buy.price) * 0.9995 * 0.9995 - 1) * 100) < 1e-9);
check('ends OUT', m.on === false && m.since.crossed);

// 2. Tonight's line: a close exactly at the line equals its own 50-day average.
const c = up.slice(0, 120), mm = trend(mk(c), n, 0.0005), L = mm.line;
check("tonight's line = the average of the last 49 closes", Math.abs(sma(c.concat([L]), c.length, n) - L) < 1e-9);
check('tonight() flips only across the line', tonight(mm, L * 0.99).flips === mm.on && tonight(mm, L * 1.01).flips === !mm.on);

// 3. Compounded result: in the whole rise, out for the fall.
const ex = (up[99] / up[60]) * 0.9995 * 0.9995;   // in from day 61's close; check the result at the top
const top = trend(mk(up.slice(0, 100)), n, 0.0005);
check('result while in = price change after the buy cost', Math.abs(top.result.total - ((up[99] / up[60]) * 0.9995 - 1) * 100) < 1e-9 && top.on && top.open);

// 4. Alert events: nothing on the first run; a BUY at the crossing close; quiet daily
//    line updates while IN; a SELL with its trade; nothing twice; old crossings skipped.
const C = mk(up), at = i => trend(C.slice(0, i + 1), n, 0.0005), H72 = 72 * 36e5;
const e0 = trendEvents(at(59), null, at(59).lastClose, H72);
check('first run: no events, saves the state', e0.events.length === 0 && !e0.daily && e0.next.on === false);
const mb = at(60), e1 = trendEvents(mb, e0.next, mb.lastClose + 36e5, H72);
check('BUY at the close that crossed, no daily on the same close', e1.events.length === 1 && e1.events[0].kind === 'buy' && e1.events[0].close === 102 && !e1.daily);
const md = at(61), e2 = trendEvents(md, e1.next, md.lastClose + 36e5, H72);
check('next close while IN: daily line update only', e2.events.length === 0 && e2.daily);
check('same close again: nothing', (function () { const r = trendEvents(md, e2.next, md.lastClose + 2 * 36e5, H72); return r.events.length === 0 && !r.daily; })());
const sIdx = si, ms = at(sIdx), e3 = trendEvents(ms, trendEvents(at(sIdx - 1), e2.next, 0, Infinity).next, ms.lastClose + 36e5, H72);
check('SELL at the first close under, with the trade result', e3.events.length === 1 && e3.events[0].kind === 'sell' && e3.events[0].trade && Math.abs(e3.events[0].trade.pct - m.trades[0].pct) < 1e-9 && !e3.daily);
check('a crossing older than 72 h is not pushed', trendEvents(ms, { at: ms.states[ms.states.length - 3].t, on: true }, ms.lastClose + 80 * 36e5, H72).events.length === 0);

console.log(ok ? 'trend ok' : 'trend FAILED');
process.exit(ok ? 0 : 1);
