// Data the Tactics tab needs beyond the shared sources: option trades (premium
// drift), perpetual trades (footprint) and 1-minute candles (volume profile).
// Kept here so the other tabs' sources stay untouched.
import { getJson } from '../../shared/http.js';
import { parseExpiry } from '../../shared/sources/deribit.js';

const DERIBIT = 'https://www.deribit.com/api/v2/public';
const GATE = 'https://api.gateio.ws/api/v4/futures/usdt';

// Pages backwards from the end time, so if the page cap is hit it is the oldest
// trades that are missing, never the latest. Returned oldest first.
async function deribitTrades(path, startMs, endMs, maxPages) {
  const out = [];
  let end = endMs;
  for (let p = 0; p < maxPages; p++) {
    const j = await getJson(DERIBIT + path + '&start_timestamp=' + startMs + '&end_timestamp=' + end + '&count=1000&sorting=desc');
    if (j.error) throw new Error(j.error.message || 'Deribit error');
    const tr = j.result.trades;
    for (let i = 0; i < tr.length; i++) out.push(tr[i]);
    if (!j.result.has_more || !tr.length) break;
    end = tr[tr.length - 1].timestamp - 1;
  }
  return out.reverse();
}

// Option trades: premium in USD, signed by who was the aggressor (+ bought, − sold).
export async function optionTrades(asset, startMs, endMs) {
  const tr = await deribitTrades('/get_last_trades_by_currency_and_time?currency=' + asset + '&kind=option', startMs, endMs, 20);
  return tr.map(function (t) {
    const p = t.instrument_name.split('-'); // ETH-2NOV26-2320-C
    return {
      t: t.timestamp, type: p[3], strike: +p[2], expiry: parseExpiry(p[1]),
      dir: t.direction === 'buy' ? 1 : -1,
      usd: t.price * t.amount * t.index_price,
    };
  }).filter(function (t) { return t.type === 'C' || t.type === 'P'; });
}

// Perpetual trades: price, USD size and aggressor side, for the footprint.
export async function perpTrades(asset, startMs, endMs) {
  const tr = await deribitTrades('/get_last_trades_by_instrument_and_time?instrument_name=' + asset + '-PERPETUAL', startMs, endMs, 30);
  return tr.map(function (t) { return { t: t.timestamp, price: t.price, usd: t.amount, dir: t.direction === 'buy' ? 1 : -1 }; });
}

// Gate 1-minute candles between two times (≤ 2,000 per request), volume in USD.
export async function minuteCandles(asset, fromMs, toMs) {
  const k = await getJson(GATE + '/candlesticks?contract=' + asset + '_USDT&interval=1m&from=' + Math.floor(fromMs / 1000) + '&to=' + Math.floor(toMs / 1000));
  return k.map(function (c) { return { t: c.t * 1000, o: +c.o, h: +c.h, l: +c.l, c: +c.c, usd: +c.sum }; })
    .filter(function (c) { return c.c > 0; });
}
