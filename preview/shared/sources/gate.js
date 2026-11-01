// Gate.io USDT perpetuals. Allows browser requests and serves 30 days of
// OI history, so it backs up Binance/Bybit where those are region-blocked.
import { getJson } from '../http.js';

const BASE = 'https://api.gateio.ws/api/v4/futures/usdt';
export const venue = 'Gate';

export async function perp(asset) {
  const c = asset + '_USDT';
  const res = await Promise.all([
    getJson(BASE + '/contracts/' + c),
    getJson(BASE + '/contract_stats?contract=' + c + '&interval=4h&limit=180'),
  ]);
  const info = res[0];
  const intervalH = (+info.funding_interval || 28800) / 3600;
  const hist = res[1].map(function (h) { return { t: h.time * 1000, coins: h.open_interest_usd / h.mark_price }; });
  const last = hist[hist.length - 1];
  return {
    venue: venue,
    funding8h: +info.funding_rate * 8 / intervalH,
    oiCoins: last.coins,
    oiUsd: last.coins * +info.mark_price,
    oiHist: hist.slice(0, -1),
  };
}

// Last 30 days, hourly: price range, open interest, taker split, liquidations.
export async function hourly(asset) {
  const c = asset + '_USDT';
  const res = await Promise.all([
    getJson(BASE + '/contract_stats?contract=' + c + '&interval=1h&limit=720'),
    getJson(BASE + '/candlesticks?contract=' + c + '&interval=1h&limit=720'),
  ]);
  const candles = {};
  res[1].forEach(function (k) { candles[k.t] = k; });
  return res[0].filter(function (s) { return candles[s.time] && s.mark_price > 0; }).map(function (s) {
    const k = candles[s.time];
    const taker = s.long_taker_size + s.short_taker_size;
    return {
      t: s.time * 1000,
      price: (+k.h + +k.l + +k.c) / 3,
      high: +k.h,
      low: +k.l,
      oiCoins: s.open_interest_usd / s.mark_price,
      buyShare: taker > 0 ? s.long_taker_size / taker : 0.5,
      longLiqUsd: +s.long_liq_usd || 0,
      shortLiqUsd: +s.short_liq_usd || 0,
    };
  });
}

// Hourly closes for realized volatility (Deribit's price history blocks browsers).
export async function hourlyCloses(asset, hours) {
  const k = await getJson(BASE + '/candlesticks?contract=' + asset + '_USDT&interval=1h&limit=' + Math.min(hours, 1000));
  return k.map(function (c) { return { t: c.t * 1000, close: +c.c }; }).filter(function (c) { return c.close > 0; });
}

// Finished candles only (Gate's last one is still forming), oldest first.
// minutes: 1, 5, 15, 30 or 60.
export async function closedCandles(asset, minutes, limit, now) {
  const k = await getJson(BASE + '/candlesticks?contract=' + asset + '_USDT&interval=' + (minutes === 60 ? '1h' : minutes + 'm') + '&limit=' + Math.min(limit, 1000));
  const end = now || Date.now();
  return k.map(function (c) { return { t: c.t * 1000, high: +c.h, low: +c.l, close: +c.c }; })
    .filter(function (c) { return c.close > 0 && c.t + minutes * 6e4 <= end; });
}
