// Trend tab data: Gate USDT perpetual daily candles (they start at 00:00 UTC, allow
// browser requests and go back ~2.7 years in one call). Deribit's history blocks browsers.
import { getJson } from '../../shared/http.js';
import { trend, DAY } from './model.js';

export async function collectTrend(asset, cfg) {
  const k = await getJson('https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=' + asset + '_USDT&interval=1d&limit=1000');
  const now = Date.now();
  const all = k.map(function (c) { return { t: c.t * 1000, close: +c.c, high: +c.h, low: +c.l }; })
    .filter(function (c) { return c.close > 0; }).sort(function (a, b) { return a.t - b.t; });
  const closed = all.filter(function (c) { return c.t + DAY <= now; });
  const forming = all.filter(function (c) { return c.t + DAY > now; }).pop();
  if (closed.length < cfg.days + 10) throw new Error('not enough daily candles');
  return {
    asset: asset,
    fetched: now,
    candles: closed,
    price: forming ? forming.close : closed[closed.length - 1].close,
    nextClose: closed[closed.length - 1].t + 2 * DAY,   // end of today's (forming) candle
    model: trend(closed, cfg.days, cfg.costSide),
  };
}
