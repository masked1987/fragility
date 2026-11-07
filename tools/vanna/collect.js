// ETH 24-hour Vanna + Charm reading for the phone alert (jobs/vanna-flow.mjs). Same rules
// as Gamma Detrite's Vanna & Charm view (its vanna-charm.js / vc-flow.js are copies of
// shared/vanna-flow/core.mjs; CRYPTO_GAMMA_CHECKOUT=<folder> node test/vanna-flow.mjs checks).
// Deribit: ETH index + every ETH option (OI, mark IV, forward). Turnover: the first
// two of Binance, Bybit, Bitget, Gate, Deribit that answer (Binance / Bybit are blocked
// on GitHub's servers and in some regions, so the alert usually uses Bitget + Gate).
import { venues, fresh, feedUrls, volumeRecord, volumeSelection, bias, prepare, parse } from '../../shared/vanna-flow/core.mjs';

export const LABELS = ['Bullish', 'Bearish', 'Neutral'];

async function json(url, fetcher) {
  const r = await fetcher(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw Error('HTTP ' + r.status);
  const j = await r.json(); if (j.error) throw Error('Exchange error'); return j;
}

// Background readings for single expiries (7 Nov 2026, owner said yes to saving Daily and Weekly
// next to All, to compare versions later). Same picking as Gamma Detrite's expiry tabs: Daily = the
// very next expiry, Weekly = the nearest Friday. Same turnover, same rules; never used for alerts.
const isFri = function (e) { return new Date(e).getUTCDay() === 5; };
export function pickExpiry(exps, which) {
  for (const e of exps) if (which === 'day' || (which === 'week' && isFri(e))) return e;
  return null;
}
export function singleExpiry(raw, which, volume) {
  const e = pickExpiry(raw.exps, which); if (e == null) return null;
  const book = prepare(raw, [e]); if (!book) return null;
  let g = 0; for (const k of Object.keys(raw.cell)) if (+k.split('|')[1] === e) g += raw.cell[k];
  const r = bias(book.total.vanna, book.total.charm, volume, g / 1e6, false);
  if (!LABELS.includes(r.label) || !r.rows.every(function (x) { return Number.isFinite(x.total); })) return null;
  return { expiry: e, label: r.label, pct: r.pct, rows: r.rows.map(function (x) { return { iv: x.iv, total: x.total, label: x.label }; }) };
}

// { ok: true, reading, book, basket, netGamma } or { ok: false, why }.
export async function collectFlow(fetcher, clock) {
  fetcher = fetcher || function (u, o) { return fetch(u, o); };
  clock = clock || Date.now;
  const started = clock(), base = 'https://www.deribit.com/api/v2/public/';
  const responses = await Promise.allSettled([
    json(base + 'get_index_price?index_name=eth_usd', fetcher),
    json(base + 'get_book_summary_by_currency?currency=ETH&kind=option', fetcher),
  ].concat(feedUrls('ETH').map(function (url) { return json(url, fetcher); })));
  const now = clock();
  if (!fresh(started, now)) return { ok: false, why: 'the data took too long to arrive' };
  if (responses[0].status !== 'fulfilled' || responses[1].status !== 'fulfilled') return { ok: false, why: 'Deribit did not answer' };
  const index = responses[0].value, chain = responses[1].value;
  for (const j of [index, chain]) if (j.usOut != null && !fresh(Number(j.usOut) / 1000, now)) return { ok: false, why: 'Deribit data is stale' };
  const spot = index.result && index.result.index_price;
  if (!Number.isFinite(spot) || spot <= 0 || !Array.isArray(chain.result) || !chain.result.length) return { ok: false, why: 'Deribit sent no options' };
  const raw = parse(chain.result, spot, started), book = prepare(raw, raw.exps);
  if (!book) return { ok: false, why: 'no usable options' };
  const records = {};
  venues.forEach(function (v, i) {
    const r = responses[i + 2];
    if (r.status === 'fulfilled') { const value = volumeRecord(v, r.value, 'ETH', now); if (value) records[v] = value; }
  });
  const basket = volumeSelection({ asset: 'ETH', records: records }, now);
  if (!basket.complete) return { ok: false, why: 'fewer than two exchanges gave 24h turnover (' + (Object.keys(records).join(', ') || 'none') + ')' };
  const netGamma = Object.values(raw.cell).reduce(function (s, g) { return s + g; }, 0) / 1e6;
  const result = bias(book.total.vanna, book.total.charm, basket.volume, netGamma, false);
  if (!LABELS.includes(result.label) || !Number.isFinite(result.pct) || !result.rows.every(function (r) { return Number.isFinite(r.total); })) return { ok: false, why: 'the reading did not add up' };
  const reading = {
    version: 1, asset: 'ETH', selection: 'all', snapshotAt: started, observedAt: now, label: result.label,
    robust: result.robust, spot: spot, series: book.records.length, expiryCount: book.expiries.length,
    pct: result.pct, strength: result.label === 'Neutral' ? 'Neutral' : ['Weak', 'Moderate', 'Strong'][result.adjusted],
    rows: result.rows.map(function (r) { return { iv: r.iv, total: r.total, label: r.label }; }),
    sources: basket.used.map(function (r) { return r.venue; }), turnover: basket.volume, fallback: basket.fallback,
    day: singleExpiry(raw, 'day', basket.volume), week: singleExpiry(raw, 'week', basket.volume),
  };
  return { ok: true, reading: reading, result: result, book: book, basket: basket, netGamma: netGamma, raw: raw };
}

// What the alert job stores and compares (null when there is no valid reading).
export async function collectReading(fetcher, clock) {
  const f = await collectFlow(fetcher, clock);
  return f.ok ? f.reading : null;
}
