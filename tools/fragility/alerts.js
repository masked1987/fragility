// Zone-change detection, kept separate so any notifier can plug in later
// (browser notification now; ntfy / Telegram / email from a scheduled job later).
import { load, save } from '../../shared/storage.js';

const KEY = 'fragility.lastZone.';

// The zone only changes once the score is `hysteresis` points past a boundary.
export function stickyZone(score, zones, prev, hysteresis) {
  const idx = zones.findIndex(function (z) { return z.name === prev; });
  if (idx < 0) return null;
  const lower = idx > 0 ? zones[idx - 1].max : -Infinity;
  const upper = zones[idx].max;
  if (score >= lower - hysteresis && score < upper + hysteresis) return prev;
  return null;
}

// Price levels: which side of each level the price is on, with a buffer so a
// price sitting on a level doesn't ring over and over. sides: { level: 'above' | 'below' }
// from last time. Returns the new sides and the levels crossed since then.
export function levelCrossings(price, levels, prevSides, bufferPct) {
  const sides = {}, crossed = [];
  levels.forEach(function (L) {
    const prev = prevSides[L];
    let side = price >= L * (1 + bufferPct / 100) ? 'above' : price <= L * (1 - bufferPct / 100) ? 'below' : prev;
    if (!side) side = price >= L ? 'above' : 'below';
    sides[L] = side;
    if (prev && prev !== side) crossed.push({ level: L, dir: side === 'above' ? 'up' : 'down' });
  });
  return { sides: sides, crossed: crossed };
}

// Returns { from, to } when the zone changed since the last call, else null.
export function checkZoneChange(result, cfg) {
  if (result.score == null) return null;
  const prev = load(KEY + result.asset, null);
  const zone = stickyZone(Math.round(result.score), cfg.zones, prev, cfg.hysteresis) || result.zone;
  save(KEY + result.asset, zone);
  if (prev && prev !== zone) return { asset: result.asset, from: prev, to: zone, score: result.score };
  return null;
}

const listeners = [];
export function onZoneChange(fn) { listeners.push(fn); }
export function emitZoneChange(change) { listeners.forEach(function (fn) { try { fn(change); } catch (e) { console.error(e); } }); }
