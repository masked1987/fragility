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
