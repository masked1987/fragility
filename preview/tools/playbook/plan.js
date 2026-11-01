// Turns the readings of the other tabs into a mode and possible decisions.
// Pure: no fetching, no DOM, runs in Node (test/plan.mjs).
//
// s (one asset, all prices in USD):
//   spot, flip (gamma flip or null), move (implied 1-day move as a fraction, e.g. 0.029)
//   zone ('Calm' | 'Building' | 'Primed' or null), score, funding ('short' | 'long' | null: who is crowded)
//   gamma (dealer net/gross near spot or null), neutral (|gamma| below this is neutral)
//   overall (Market Maker readOverall result or null), gap (implied − realized, 7 days), gapPts
//   flow ({ tone, down, up } from Forced Flow's readFlow), longs / shorts (Forced Flow clusters or null)
//   strikes ([{ price, gamma }] dealer gamma by price, from the Forced Flow ladder), levels (alert levels)

export const MODES = {
  cascade: { name: 'Cascade risk', tone: 'primed' },
  squeezeUp: { name: 'Squeeze up', tone: 'building' },
  squeezeDown: { name: 'Squeeze down', tone: 'building' },
  trendDown: { name: 'Trend down', tone: 'accent' },
  trendUp: { name: 'Trend up', tone: 'accent' },
  range: { name: 'Range', tone: 'calm' },
  none: { name: 'No edge', tone: 'muted' },
};

// Round to a tidy step: 5 for ETH-sized prices, 50 for BTC-sized.
export function step(x) { return 5 * Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.abs(x))) - 3)); }
export function roundTo(x, dir) {
  const k = step(x);
  return (dir > 0 ? Math.ceil(x / k) : dir < 0 ? Math.floor(x / k) : Math.round(x / k)) * k;
}

export function pickMode(s, cfg) {
  const band = cfg.flipBandPct / 100;
  const vsFlip = s.flip ? s.spot / s.flip - 1 : 0;
  const above = s.flip && vsFlip > band, below = s.flip && vsFlip < -band;
  const loaded = s.flow && (s.flow.down === 'loaded' || s.flow.up === 'loaded');
  const near = function (st) { return st === 'loaded' || st === 'open'; };

  if (s.zone === 'Primed' || (s.overall && s.overall.level === 'unstable') || (loaded && s.zone && s.zone !== 'Calm')) {
    const dir = s.flow && s.flow.up === 'loaded' && s.flow.down !== 'loaded' ? 'up' : 'down';
    return { key: 'cascade', dir: dir };
  }
  if (s.funding === 'short' && s.flow && near(s.flow.up) && !below) return { key: 'squeezeUp', dir: 'up' };
  if (s.funding === 'long' && s.flow && near(s.flow.down) && !above) return { key: 'squeezeDown', dir: 'down' };
  if (below) return { key: 'trendDown', dir: 'down' };
  const losing = s.gap != null && s.gap <= -s.gapPts;
  if (losing || (s.zone === 'Building' && s.gamma != null && s.gamma <= -s.neutral)) {
    return { key: s.flow && s.flow.tone === 'up' ? 'trendUp' : 'trendDown', dir: s.flow && s.flow.tone === 'up' ? 'up' : 'down' };
  }
  if (above) return { key: 'range', dir: null };
  return { key: 'none', dir: null };
}

// Trigger level above (dir 1) or below (dir −1): alert levels and round numbers.
// A level crossed in the last few hourly closes (s.closes, oldest first) is
// "just broken": its plan is triggered and waits for the retest. Otherwise the
// nearest level at least minTriggerMoves of a day away. An upside trigger is
// never below the flip, nor a downside one above it (dealers turn at the flip).
export function trigger(s, cfg, dir) {
  const dayPts = s.move * s.spot, min = cfg.minTriggerMoves * dayPts;
  const every = cfg.roundEvery[s.asset] || step(s.spot) * 10;
  const cands = (s.levels || []).slice();
  for (let k = -3; k <= 3; k++) cands.push((Math.round(s.spot / every) + k) * every);
  const byDist = function (a, b) { return Math.abs(a - s.spot) - Math.abs(b - s.spot); };

  const c = s.closes || [];
  if (c.length >= 2) {
    const last = c[c.length - 1];
    const broken = cands.filter(function (L) {
      const past = dir > 0 ? s.spot > L && last > L : s.spot < L && last < L;
      const before = c.slice(0, -1).some(function (x) { return dir > 0 ? x <= L : x >= L; });
      const flipOk = !s.flip || (dir > 0 ? L >= s.flip : L <= s.flip);
      return past && before && flipOk && Math.abs(L - s.spot) <= 0.75 * dayPts;
    }).sort(byDist);
    if (broken.length) return { level: roundTo(broken[0], 0), triggered: true };
  }
  const ok = cands.filter(function (L) { return dir > 0 ? L >= s.spot + min : L <= s.spot - min; }).sort(byDist);
  let L = ok.length ? ok[0] : s.spot * (1 + dir * 0.5 * s.move);
  if (s.flip && dir > 0 && s.flip > L) L = s.flip;
  if (s.flip && dir < 0 && s.flip < L) L = s.flip;
  return { level: roundTo(L, dir), triggered: false };
}

// Targets past the entry in direction dir: liquidation clusters (forced orders
// that pull price there) and dealer long-gamma strikes (where moves stall).
function targets(s, cfg, entry, dir) {
  const minD = cfg.minTargetMoves * s.move * s.spot, maxD = cfg.targetRangeMoves * s.move * s.spot;
  const inRange = function (p) { const d = (p - entry) * dir; return d >= minD && d <= maxD; };
  const out = [];
  ((dir < 0 ? s.longs : s.shorts) || []).forEach(function (c) {
    if (!c || !inRange(c.price)) return;
    out.push({ price: c.price, usd: c.usd, kind: 'cluster', amplify: c.gammaThere == null ? null : c.gammaThere < 0, largest: c.largest });
  });
  const stalls = (s.strikes || []).filter(function (b) { return b.gamma > 0 && inRange(b.price); });
  if (stalls.length) {
    const top = stalls.reduce(function (a, b) { return b.gamma > a.gamma ? b : a; });
    out.push({ price: top.price, kind: 'strike' });
  }
  out.sort(function (a, b) { return (a.price - b.price) * dir; });
  // The two closest, at least minTargetMoves of a day apart (else they're one target).
  const picked = [];
  out.forEach(function (t) {
    t.price = roundTo(t.price, 0);
    if (picked.length < 2 && !picked.some(function (p) { return Math.abs(p.price - t.price) < minD; })) picked.push(t);
  });
  if (!picked.length) {
    cfg.fallbackTargets.forEach(function (f) { picked.push({ price: roundTo(entry + dir * f * s.move * s.spot, 0), kind: 'move', share: f }); });
  }
  return picked;
}

// The decisions on the table, preferred first. Each has a side (long/short/none),
// a size factor, levels, reward-to-risk per target, and a live status line.
export function buildPlan(s, cfg) {
  const mode = pickMode(s, cfg);
  const dayPts = s.move * s.spot;
  const tu = trigger(s, cfg, 1), td = trigger(s, cfg, -1);
  const up = tu.level, down = td.level;
  const plans = [];

  function breakPlan(dir) {
    const t = dir > 0 ? up : down;
    const tr = dir > 0 ? tu : td;
    const stop = roundTo(t - dir * cfg.stopMoves * dayPts, -dir);
    const tg = targets(s, cfg, t, dir).map(function (x) { return Object.assign(x, { r: Math.abs(x.price - t) / Math.abs(t - stop) }); });
    return {
      key: dir > 0 ? 'breakUp' : 'breakDown', side: dir > 0 ? 'long' : 'short', dir: dir,
      trigger: t, entry: t, stop: stop, targets: tg,
      triggered: tr.triggered,
      distance: Math.abs(s.spot - t),
    };
  }

  const bu = breakPlan(1), bd = breakPlan(-1);
  const mid = roundTo((up + down) / 2, 0);
  const flushDir = mode.dir || (s.flow && s.flow.tone === 'up' ? 'up' : 'down');
  const fz = flushZone(s, bd, bu, flushDir);
  const flush = { key: 'flush', side: flushDir === 'down' ? 'long' : 'short', dir: flushDir === 'down' ? 1 : -1, zone: fz,
    back: flushDir === 'down' ? down : up };
  const range = { key: 'range', side: 'both', low: down, high: up, mid: mid,
    stopLow: roundTo(down - cfg.stopMoves * dayPts, -1), stopHigh: roundTo(up + cfg.stopMoves * dayPts, 1) };
  const wait = { key: 'wait', side: 'none', low: down, high: up, mid: mid };

  // Preferred first; size 0.5 = half the normal risk.
  const m = mode.key;
  if (m === 'cascade') {
    plans.push(pref(flush, 0.5), opt(bd, 0.5), opt(bu, 0.5));
  } else if (m === 'squeezeUp' || m === 'trendUp') {
    plans.push(pref(bu, 1), opt(bd, m === 'trendUp' ? 0.5 : 1), opt(flush, 0.5));
  } else if (m === 'squeezeDown' || m === 'trendDown') {
    plans.push(pref(bd, 1), opt(bu, 0.5), opt(flush, 0.5));
  } else if (m === 'range') {
    plans.push(pref(range, 1), opt(bu, 0.5), opt(bd, 0.5));
  } else {
    plans.push(pref(wait, 0), opt(bd, 1), opt(bu, 1), opt(flush, 0.5));
  }
  return { mode: Object.assign({ key: m, dir: mode.dir }, MODES[m]), up: up, down: down, mid: mid, dayPts: dayPts, plans: plans };
}

function pref(p, size) { return Object.assign({}, p, { preferred: true, size: size }); }
function opt(p, size) { return Object.assign({}, p, { preferred: false, size: size }); }

// Where a flush would likely end: between the two mapped targets past the trigger,
// or half to three quarters of a day's move past it.
function flushZone(s, bd, bu, dir) {
  const tg = (dir === 'down' ? bd : bu).targets.map(function (t) { return t.price; }).sort(function (a, b) { return a - b; });
  return tg.length > 1 ? [tg[0], tg[tg.length - 1]] : [tg[0], tg[0]];
}
