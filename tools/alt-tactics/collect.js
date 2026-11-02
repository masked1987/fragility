// Fetch one asset for the Alt Tactics tab: Deribit options (open contracts per
// strike, for the huge levels) and 5-minute candles (the dip, the low, Ichimoku).
// Candles come from Bitstamp ETH/USD: its lows match the owner's TradingView chart
// within cents (Oct 30 low 2,170.0 vs 2,169.92; Gate's futures said 2,173.4), so the
// stop loss number matches what he sees (asked 2 Nov 2026, "2173?"). Gate is the
// backup if Bitstamp fails.
import * as deribit from '../../shared/sources/deribit.js';
import { closedCandles } from '../../shared/sources/gate.js';
import { getJson } from '../../shared/http.js';
import { pickHuge, decideAlt } from './model.js';

async function bitstamp(asset, minutes, limit, now) {
  const j = await getJson('https://www.bitstamp.net/api/v2/ohlc/' + asset.toLowerCase() + 'usd/?step=' + minutes * 60 + '&limit=' + Math.min(limit, 1000));
  return j.data.ohlc.map(function (k) { return { t: +k.timestamp * 1000, h: +k.high, l: +k.low, c: +k.close }; })
    .filter(function (k) { return k.c > 0 && k.t + minutes * 6e4 <= now; }) // finished candles only
    .sort(function (a, b) { return a.t - b.t; });
}

async function candles(asset, cfg, now) {
  try {
    const c = await bitstamp(asset, cfg.candleMinutes, cfg.candles, now);
    if (c.length >= 100) return { c5: c, source: 'Bitstamp' };
  } catch (e) { /* fall back to Gate */ }
  const raw = await closedCandles(asset, cfg.candleMinutes, cfg.candles, now);
  return { c5: raw.map(function (k) { return { t: k.t, h: k.high, l: k.low, c: k.close }; }), source: 'Gate' };
}

export async function collectAlt(asset, cfg) {
  const now = Date.now();
  const [chain, px] = await Promise.all([deribit.options(asset), candles(asset, cfg, now)]);
  const c5 = px.c5;
  if (c5.length < 100) throw new Error('not enough price history');
  const spot = c5[c5.length - 1].c;
  const huge = pickHuge(chain.options, spot, now, cfg);
  const dec = decideAlt(c5, huge, cfg); // with open contracts: the target is the biggest level
  return { asset: asset, fetched: now, spot: spot, huge: huge, candles: c5, decision: dec, source: px.source };
}
