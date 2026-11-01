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

// Gamma-level breaks and reversals from one finished candle. Any trade through a
// level counts (a spike is a cross too): the candle's high / low, not its close.
//   c = { high, low, close }, prev = the previous candle's close, end = when c closed.
//   breaks = open breaks [{ level, dir: 'up' | 'down', at, extreme }]
//   quiet = { level: until } — a level rings at most once per quietMs, so price
//           chopping on it doesn't ring every candle. Breaks are still tracked
//           while it is quiet, so a later reversal is never missed.
// Events (only the ones allowed to ring): 'break' (traded through), 'reversal' (an
// open break traded back through), 'spike' (through and closed back in one candle).
export function levelEvents(c, prev, levels, breaks, quiet, end, windowMs, quietMs) {
  const all = [], open = [], q = Object.assign({}, quiet);
  Object.keys(q).forEach(function (L) { if (q[L] <= end) delete q[L]; });
  (breaks || []).forEach(function (b) {
    if (end - b.at > windowMs) return; // too old: no longer watched
    const ext = b.dir === 'up' ? Math.max(b.extreme, c.high) : Math.min(b.extreme, c.low);
    const back = b.dir === 'up' ? c.low < b.level : c.high > b.level;
    if (back) all.push({ kind: 'reversal', level: b.level, dir: b.dir, at: b.at, extreme: ext, c: c });
    else open.push(Object.assign({}, b, { extreme: ext }));
  });
  levels.forEach(function (L) {
    if (prev == null || open.some(function (b) { return b.level === L; }) || all.some(function (e) { return e.level === L; })) return;
    const up = prev < L && c.high > L, down = prev > L && c.low < L;
    if (!up && !down) return;
    const dir = up ? 'up' : 'down', ext = up ? c.high : c.low;
    if (up ? c.close < L : c.close > L) all.push({ kind: 'spike', level: L, dir: dir, at: end, extreme: ext, c: c }); // through and straight back
    else {
      all.push({ kind: 'break', level: L, dir: dir, at: end, extreme: ext, c: c });
      open.push({ level: L, dir: dir, at: end, extreme: ext });
    }
  });
  const events = all.filter(function (e) {
    if (q[e.level]) return false;
    q[e.level] = end + quietMs;
    return true;
  });
  return { breaks: open, quiet: q, events: events };
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
