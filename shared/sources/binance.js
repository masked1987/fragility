// Binance USDT-margined perpetuals. Blocked in some regions (HTTP 451).
import { getJson } from '../http.js';

const BASE = 'https://fapi.binance.com';
export const venue = 'Binance';

export async function perp(asset) {
  const sym = asset + 'USDT';
  const res = await Promise.all([
    getJson(BASE + '/fapi/v1/premiumIndex?symbol=' + sym),
    getJson(BASE + '/fapi/v1/openInterest?symbol=' + sym),
    // 180 x 4h = 30 days, the most Binance keeps.
    getJson(BASE + '/futures/data/openInterestHist?symbol=' + sym + '&period=4h&limit=180').catch(function () { return null; }),
    // Only lists symbols whose funding interval is not the default 8h.
    getJson(BASE + '/fapi/v1/fundingInfo').catch(function () { return []; }),
  ]);
  const p = res[0];
  const info = Array.isArray(res[3]) ? res[3].find(function (r) { return r.symbol === sym; }) : null;
  const intervalH = info ? +info.fundingIntervalHours : 8;
  const coins = +res[1].openInterest;
  return {
    venue: venue,
    funding8h: +p.lastFundingRate * 8 / intervalH,
    oiCoins: coins,
    oiUsd: coins * +p.markPrice,
    oiHist: Array.isArray(res[2])
      ? res[2].map(function (h) { return { t: +h.timestamp, coins: +h.sumOpenInterest }; })
      : null,
  };
}
