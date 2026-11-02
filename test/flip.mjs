// Run: node test/flip.mjs  — offline checks of the Market Maker flip (tools/market-maker/flip.js).
import assert from 'node:assert/strict';
import { readings, flipSignal, followFlip, flipTrades, flipState } from '../tools/market-maker/flip.js';
import { MM_CONFIG as CFG } from '../tools/market-maker/config.js';

const H = 36e5, T0 = Date.UTC(2026, 0, 1);
// Price moving ±step% each hour (alternating, so no trend), then a steady climb.
function series(calmHours, wildHours, calmStep, wildStep, ivLevel) {
  const hours = [], iv = new Map();
  let p = 2000;
  for (let i = 0; i < calmHours + wildHours; i++) {
    const wild = i >= calmHours, step = wild ? wildStep : calmStep;
    p *= 1 + (wild ? step : (i % 2 ? step : -step)) / 100;
    hours.push({ t: T0 + i * H, close: p, high: p * 1.001, low: p * 0.999 });
    iv.set(T0 + i * H, ivLevel);
  }
  return { hours, iv };
}

// 1. Calm (options price 50%, coin moves ~0.3% an hour ≈ 28% a year): dealers win, no flip.
{
  const { hours, iv } = series(400, 0, 0.3, 0, 50);
  const r = readings(iv, hours, CFG);
  assert.ok(r.length > 100);
  assert.equal(r[r.length - 1].side, 'win');
  assert.equal(r.filter(x => flipSignal(x, CFG.flip)).length, 0);
  console.log('1 calm: dealers winning, no flip');
}

// 2. Calm, then a steady climb of 1.2% an hour (much more than 50% implied): flip to a BUY.
{
  const { hours, iv } = series(400, 60, 0.3, 1.2, 50);
  const r = readings(iv, hours, CFG);
  const sig = r.map(x => flipSignal(x, CFG.flip)).filter(Boolean);
  assert.equal(sig.length, 1, 'one flip');
  const g = sig[0], m = 50 / Math.sqrt(365) / 100;
  assert.equal(g.buy, true, 'last 24h up -> buy');
  assert.ok(Math.abs((g.entry - g.stop) / g.entry - 0.5 * m) < 1e-9, 'stop ½ day move');
  assert.ok(Math.abs((g.target - g.entry) / g.entry - 2 * m) < 1e-9, 'target 2 day moves');
  const tr = flipTrades(r, hours, H, CFG.flip);
  assert.equal(tr.length, 1);
  assert.equal(tr[0].trade.result, 'target', 'the climb reaches the target');
  console.log('2 wild climb: flip BUY at ' + g.entry.toFixed(0) + ', stop ' + g.stop.toFixed(0) + ', target ' + g.target.toFixed(0) + ', hit');
}

// 3. The same falling: SELL.
{
  const { hours, iv } = series(400, 60, 0.3, -1.2, 50);
  const g = readings(iv, hours, CFG).map(x => flipSignal(x, CFG.flip)).filter(Boolean)[0];
  assert.equal(g.buy, false);
  assert.ok(g.stop > g.entry && g.target < g.entry);
  console.log('3 wild drop: flip SELL');
}

// 4. Already losing from the first reading: not a flip (no "before").
{
  const { hours, iv } = series(0, 400, 0, 1.2, 50);
  const r = readings(iv, hours, CFG);
  assert.equal(r[0].side, 'lose');
  assert.equal(r.filter(x => flipSignal(x, CFG.flip)).length, 0);
  const st = flipState(iv, hours, CFG);
  assert.equal(st.open, null);
  assert.equal(st.losingSince, r[0].t);
  console.log('4 losing from the start: no flip, losing since the first reading');
}

// 5. Stop first when one candle touches both; out after maxHours at the close.
{
  const g = { t: T0, buy: true, entry: 100, stop: 99, target: 104 };
  assert.equal(followFlip(g, [{ t: T0, high: 105, low: 98, close: 100 }], H, 72).result, 'stopped');
  const flat = Array.from({ length: 80 }, (_, i) => ({ t: T0 + i * H, high: 100.5, low: 99.5, close: 100.2 }));
  const out = followFlip(g, flat, H, 72);
  assert.equal(out.result, 'time');
  assert.equal(out.at, T0 + 72 * H);
  assert.equal(followFlip(g, flat.slice(0, 10), H, 72).result, 'open');
  console.log('5 stop first on a two-sided candle; out at the close after 3 days; open while running');
}
console.log('flip ok');
