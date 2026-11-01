// OKX USDT swaps. Current funding and OI allow browser requests;
// OKX's OI history ("rubik") endpoints do not, so they are not used.
import { getJson } from '../http.js';

const BASE = 'https://www.okx.com';
export const venue = 'OKX';

async function v5(path) {
  const j = await getJson(BASE + path);
  if (j.code !== '0') throw new Error(j.msg || 'OKX error');
  return j.data[0];
}

export async function perp(asset) {
  const inst = asset + '-USDT-SWAP';
  const res = await Promise.all([
    v5('/api/v5/public/funding-rate?instId=' + inst),
    v5('/api/v5/public/open-interest?instType=SWAP&instId=' + inst),
  ]);
  const f = res[0];
  let intervalH = (+f.nextFundingTime - +f.fundingTime) / 3.6e6;
  if (!(intervalH > 0)) intervalH = 8;
  return {
    venue: venue,
    funding8h: +f.fundingRate * 8 / intervalH,
    oiCoins: +res[1].oiCcy,
    oiUsd: +res[1].oiUsd,
    oiHist: null,
  };
}
