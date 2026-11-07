// ETH 24-hour Vanna + Charm reading. Browser-safe (no Node imports): the tab and the
// phone alert (jobs/vanna-flow.mjs) both call collectFlow(), so they always agree on
// the numbers, apart from which exchanges answer (see sources in the reading).
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
  };
  return { ok: true, reading: reading, result: result, book: book, basket: basket, netGamma: netGamma };
}

// What the alert job stores and compares (null when there is no valid reading).
export async function collectReading(fetcher, clock) {
  const f = await collectFlow(fetcher, clock);
  return f.ok ? f.reading : null;
}
