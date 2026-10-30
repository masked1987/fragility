// Turn raw market data into sub-scores and one 0-100 Fragility Score.
// Pure functions: no fetching, no DOM.
import { gex, gammaFlip } from '../../shared/gamma.js';

function clamp(x) { return Math.max(0, Math.min(100, x)); }

// 0 inside [calmLow, calmHigh], rising linearly to 100 at fullLow / fullHigh.
export function band(x, b) {
  if (x > b.calmHigh) return clamp((x - b.calmHigh) / (b.fullHigh - b.calmHigh) * 100);
  if (x < b.calmLow) return clamp((b.calmLow - x) / (b.calmLow - b.fullLow) * 100);
  return 0;
}

function pct(x, digits) { return (x >= 0 ? '+' : '') + x.toFixed(digits == null ? 1 : digits) + '%'; }

function fundingInput(data, cfg) {
  const perps = data.perps.filter(function (p) { return isFinite(p.funding8h) && p.oiUsd > 0; });
  if (!perps.length) return null;
  let w = 0, sum = 0;
  perps.forEach(function (p) { w += p.oiUsd; sum += p.funding8h * p.oiUsd; });
  const rate = sum / w;
  const apr = rate * 3 * 365 * 100;
  const score = band(apr, cfg.funding);
  const side = score < 10 ? 'normal' : apr > 0 ? 'longs paying up: crowded long' : 'shorts paying: crowded short';
  return {
    score: score,
    value: pct(rate * 100, 4) + ' / 8h (' + pct(apr, 0) + ' APR)',
    note: side + ' · OI-weighted across ' + perps.map(function (p) { return p.venue; }).join(', '),
  };
}

function basisInput(data, cfg) {
  if (!data.futures) return null;
  const c = cfg.basis;
  const usable = data.futures.curve.filter(function (f) { return f.days >= c.minDays; });
  if (!usable.length) return null;
  const pick = usable.reduce(function (a, b) { return Math.abs(b.days - c.targetDays) < Math.abs(a.days - c.targetDays) ? b : a; });
  const score = band(pick.apr, c);
  const side = score < 10 ? 'normal' : pick.apr > c.calmHigh ? 'rich premium: leverage is expensive' :
    pick.apr < 0 ? 'backwardation: stress / heavy shorts' : 'thin premium';
  return {
    score: score,
    value: pct(pick.apr, 1) + ' APR',
    note: side + ' · ' + pick.name + ' (' + Math.round(pick.days) + 'd) vs index',
  };
}

function oiInputs(data, cfg) {
  const s = data.oiSeries;
  const empty = { score: null, value: 'n/a', note: 'no OI history source reachable' };
  if (!s) return { level: empty, change: empty };
  if (s.points.length < 2) {
    const building = { score: null, value: 'n/a', note: 'building history · ' + s.source };
    return { level: building, change: building };
  }
  const pts = s.points;
  const now = pts[pts.length - 1];
  const spanDays = (now.t - pts[0].t) / 864e5;

  let level;
  if (spanDays >= cfg.oiLevel.minHistoryDays) {
    const below = pts.filter(function (p) { return p.coins <= now.coins; }).length;
    const percentile = below / pts.length * 100;
    const lo = cfg.oiLevel.calmBelowPct;
    level = {
      score: clamp((percentile - lo) / (100 - lo) * 100),
      value: Math.round(percentile) + 'th pct',
      note: 'vs last ' + Math.round(spanDays) + ' days (in coins) · ' + s.source,
    };
  } else {
    level = { score: null, value: 'n/a', note: 'building history: ' + spanDays.toFixed(1) + ' of ' + cfg.oiLevel.minHistoryDays + ' days · ' + s.source };
  }

  // Point closest to 24h ago, accepted if within 4h of it.
  const target = now.t - 864e5;
  const past = pts.reduce(function (a, b) { return Math.abs(b.t - target) < Math.abs(a.t - target) ? b : a; });
  let change;
  if (Math.abs(past.t - target) <= 4 * 3.6e6 && past !== now) {
    const chg = (now.coins / past.coins - 1) * 100;
    change = {
      score: clamp(chg / cfg.oiChange.fullPct * 100),
      value: pct(chg) + ' 24h',
      note: (chg > 0 ? 'leverage being added' : 'leverage leaving (de-risking)') + ' · ' + s.source,
    };
  } else {
    change = { score: null, value: 'n/a', note: 'need a reading from ~24h ago · ' + s.source };
  }
  return { level: level, change: change };
}

function gammaInput(data, cfg) {
  if (!data.options || !data.options.options.length) return null;
  const o = data.options;
  const g = gex(o.options, o.spot, data.time);
  if (!(g.gross > 0)) return null;
  const ratio = g.net / g.gross;
  const shown = Math.round(ratio * 100) / 100 || 0; // label agrees with the ratio printed next to it
  const c = cfg.gamma;
  const flip = gammaFlip(o.options, o.spot, data.time);
  const flipText = flip ? ' · flip ≈ ' + Math.round(flip).toLocaleString('en-US') + (o.spot > flip ? ' (spot above)' : ' (spot below)') : '';
  const netM = Math.abs(g.net) / 1e6;
  const side = Math.abs(shown) < c.neutralRatio ? 'dealers near neutral: hedging has little effect'
    : shown > 0 ? 'dealers long gamma: hedging dampens' : 'dealers short gamma: hedging amplifies';
  return {
    score: clamp((c.calmRatio - ratio) / (c.calmRatio - c.fullRatio) * 100),
    value: (g.net >= 0 ? '+' : '−') + '$' + netM.toFixed(netM < 10 ? 1 : 0) + 'M per 1%',
    note: side + ' · net/gross ' + shown.toFixed(2) + flipText,
    gamma: { net: g.net, gross: g.gross, ratio: ratio, flip: flip, spot: o.spot },
  };
}

export const INPUTS = [
  { key: 'funding', label: 'Funding rates', what: 'How crowded positioning is' },
  { key: 'basis', label: 'Futures basis', what: 'How much leverage is paid for' },
  { key: 'oiLevel', label: 'Open interest level', what: 'How much leverage is in the system' },
  { key: 'oiChange', label: 'Open interest change', what: 'How fast leverage is being added' },
  { key: 'gamma', label: 'Dealer gamma', what: 'Whether hedging dampens or amplifies moves' },
];

export function evaluate(data, cfg) {
  const oi = oiInputs(data, cfg);
  const raw = {
    funding: fundingInput(data, cfg),
    basis: basisInput(data, cfg),
    oiLevel: oi.level,
    oiChange: oi.change,
    gamma: gammaInput(data, cfg),
  };
  let wSum = 0, total = 0;
  INPUTS.forEach(function (i) {
    const r = raw[i.key];
    if (r && r.score != null) { wSum += cfg.weights[i.key]; total += cfg.weights[i.key] * r.score; }
  });
  const totalWeight = INPUTS.reduce(function (a, i) { return a + cfg.weights[i.key]; }, 0);
  const score = wSum ? total / wSum : null;
  const inputs = INPUTS.map(function (i) {
    const r = raw[i.key] || { score: null, value: 'n/a', note: 'source unavailable' };
    const ok = r.score != null;
    return {
      key: i.key, label: i.label, what: i.what, score: r.score, value: r.value, note: r.note,
      weight: ok ? cfg.weights[i.key] / wSum * 100 : 0,
      points: ok ? cfg.weights[i.key] * r.score / wSum : 0,
      extra: r.gamma || null,
    };
  });
  return {
    asset: data.asset, time: data.time,
    score: score, zone: score == null ? null : zoneOf(Math.round(score), cfg.zones),
    coverage: wSum / totalWeight, inputs: inputs, sources: data.sources,
  };
}

export function zoneOf(score, zones) {
  for (let i = 0; i < zones.length; i++) if (score < zones[i].max) return zones[i].name;
  return zones[zones.length - 1].name;
}
