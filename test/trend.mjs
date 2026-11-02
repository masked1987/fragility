// Offline checks for the Trend tab's 50-day rule (tools/trend/model.js). Run: node test/trend.mjs
import { trend, sma, tonight, DAY } from '../tools/trend/model.js';

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

console.log(ok ? 'trend ok' : 'trend FAILED');
process.exit(ok ? 0 : 1);
