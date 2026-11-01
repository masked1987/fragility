// Fetch one asset for the Alt Tactics tab: Deribit options (open contracts per
// strike, for the huge levels) and Gate 5-minute candles (the dip, the low, Ichimoku).
import * as deribit from '../../shared/sources/deribit.js';
import { closedCandles } from '../../shared/sources/gate.js';
import { pickHuge, decideAlt } from './model.js';

export async function collectAlt(asset, cfg) {
  const now = Date.now();
  const [chain, raw] = await Promise.all([deribit.options(asset), closedCandles(asset, cfg.candleMinutes, cfg.candles, now)]);
  const c5 = raw.map(function (k) { return { t: k.t, h: k.high, l: k.low, c: k.close }; });
  if (c5.length < 100) throw new Error('not enough price history from Gate');
  const spot = c5[c5.length - 1].c;
  const huge = pickHuge(chain.options, spot, now, cfg);
  const dec = decideAlt(c5, huge.map(function (h) { return h.price; }), cfg);
  return { asset: asset, fetched: now, spot: spot, huge: huge, candles: c5, decision: dec };
}
