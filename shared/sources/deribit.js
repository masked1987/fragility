// Deribit public API: perpetual, dated futures (term basis) and options (gamma).
import { getJson } from '../http.js';

const BASE = 'https://www.deribit.com/api/v2/public';
export const venue = 'Deribit';

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

async function pub(path) {
  const j = await getJson(BASE + path);
  if (j.error) throw new Error(j.error.message || 'Deribit error');
  return j.result;
}

// "27NOV26" -> ms timestamp. Deribit expiries settle at 08:00 UTC.
export function parseExpiry(code) {
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(code || '');
  if (!m || MONTHS[m[2]] == null) return null;
  return Date.UTC(2000 + +m[3], MONTHS[m[2]], +m[1], 8);
}

function index(asset) {
  return pub('/get_index_price?index_name=' + asset.toLowerCase() + '_usd').then(function (r) { return r.index_price; });
}

export async function perp(asset) {
  const t = await pub('/ticker?instrument_name=' + asset + '-PERPETUAL');
  // BTC and ETH perpetual open interest is quoted in USD.
  return {
    venue: venue,
    funding8h: t.funding_8h,
    oiCoins: t.open_interest / t.index_price,
    oiUsd: t.open_interest,
    oiHist: null,
  };
}

export async function futures(asset) {
  const res = await Promise.all([pub('/get_book_summary_by_currency?currency=' + asset + '&kind=future'), index(asset)]);
  const spot = res[1];
  const now = Date.now();
  const curve = res[0].map(function (r) {
    const exp = parseExpiry(r.instrument_name.split('-')[1]);
    if (!exp) return null; // perpetual
    const days = (exp - now) / 864e5;
    return { name: r.instrument_name, days: days, mark: r.mark_price, apr: (r.mark_price / spot - 1) * 365 / days * 100 };
  }).filter(Boolean).sort(function (a, b) { return a.days - b.days; });
  return { spot: spot, curve: curve };
}

export async function options(asset) {
  const res = await Promise.all([pub('/get_book_summary_by_currency?currency=' + asset + '&kind=option'), index(asset)]);
  const list = res[0].map(function (r) {
    const p = r.instrument_name.split('-'); // BTC-1NOV26-76500-C
    return { expiry: parseExpiry(p[1]), strike: +p[2], type: p[3], oi: r.open_interest, iv: r.mark_iv / 100 };
  }).filter(function (o) { return o.expiry && o.oi > 0 && o.iv > 0 && o.strike > 0; });
  return { spot: res[1], options: list };
}
