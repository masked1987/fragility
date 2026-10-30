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
