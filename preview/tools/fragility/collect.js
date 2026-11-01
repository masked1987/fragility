// Fetch everything one asset needs. Each source fails independently.
import * as binance from '../../shared/sources/binance.js';
import * as bybit from '../../shared/sources/bybit.js';
import * as okx from '../../shared/sources/okx.js';
import * as deribit from '../../shared/sources/deribit.js';
import * as gate from '../../shared/sources/gate.js';
import { load, save } from '../../shared/storage.js';

// Order matters: the first venue with OI history is used for OI level/change.
const JOBS = [
  { name: 'Binance', kind: 'perp', run: binance.perp },
  { name: 'Bybit', kind: 'perp', run: bybit.perp },
  { name: 'Gate', kind: 'perp', run: gate.perp },
  { name: 'OKX', kind: 'perp', run: okx.perp },
  { name: 'Deribit perp', kind: 'perp', run: deribit.perp },
  { name: 'Deribit futures', kind: 'futures', run: deribit.futures },
  { name: 'Deribit options', kind: 'options', run: deribit.options },
];

export async function collect(asset) {
  const results = await Promise.allSettled(JOBS.map(function (j) { return j.run(asset); }));
  const out = { asset: asset, time: Date.now(), perps: [], futures: null, options: null, sources: [] };
  results.forEach(function (r, i) {
    const job = JOBS[i];
    out.sources.push({ name: job.name, ok: r.status === 'fulfilled', error: r.status === 'rejected' ? String(r.reason && r.reason.message || r.reason) : null });
    if (r.status !== 'fulfilled') return;
    if (job.kind === 'perp') out.perps.push(r.value);
    else out[job.kind] = r.value;
  });
  out.oiSeries = oiSeries(asset, out.perps);
  return out;
}

// OI history: an exchange series if one is reachable, otherwise snapshots
// of OKX + Deribit kept in this browser (these build up over time).
const SNAP_KEY = 'fragility.oiSnapshots.';
const SNAP_MAX_AGE = 31 * 864e5;
const SNAP_MIN_GAP = 20 * 60e3;

function oiSeries(asset, perps) {
  const withHist = perps.find(function (p) { return p.oiHist && p.oiHist.length >= 7; });
  const local = recordSnapshot(asset, perps);
  if (withHist) {
    return {
      source: withHist.venue,
      points: withHist.oiHist.concat([{ t: Date.now(), coins: withHist.oiCoins }]),
    };
  }
  return local;
}

function recordSnapshot(asset, perps) {
  const a = perps.find(function (p) { return p.venue === 'OKX'; });
  const b = perps.find(function (p) { return p.venue === 'Deribit'; });
  if (!a || !b) return null;
  const now = Date.now();
  const key = SNAP_KEY + asset;
  let snaps = load(key, []).filter(function (s) { return now - s.t < SNAP_MAX_AGE; });
  const point = { t: now, coins: a.oiCoins + b.oiCoins };
  const last = snaps[snaps.length - 1];
  if (!last || now - last.t >= SNAP_MIN_GAP) snaps.push(point);
  save(key, snaps);
  // Always end on the live value, even if it was not stored.
  return { source: 'OKX + Deribit (saved in this browser)', points: snaps.slice(0, -1).concat([point]) };
}
