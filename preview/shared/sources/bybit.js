// Bybit linear (USDT) perpetuals. Blocked in some regions (HTTP 403).
import { getJson } from '../http.js';

const BASE = 'https://api.bybit.com';
export const venue = 'Bybit';

async function v5(path) {
  const j = await getJson(BASE + path);
  if (j.retCode !== 0) throw new Error(j.retMsg || 'Bybit error');
  return j.result;
}

export async function perp(asset) {
  const sym = asset + 'USDT';
  const res = await Promise.all([
    v5('/v5/market/tickers?category=linear&symbol=' + sym),
    v5('/v5/market/open-interest?category=linear&symbol=' + sym + '&intervalTime=4h&limit=180').catch(function () { return null; }),
  ]);
  const t = res[0].list[0];
  const intervalH = +t.fundingIntervalHour || 8;
  const coins = +t.openInterest;
  return {
    venue: venue,
    funding8h: +t.fundingRate * 8 / intervalH,
    oiCoins: coins,
    oiUsd: coins * +t.markPrice,
    // Bybit returns newest first.
    oiHist: res[1]
      ? res[1].list.map(function (h) { return { t: +h.timestamp, coins: +h.openInterest }; }).reverse()
      : null,
  };
}
