// Plain-English reading for the Market Maker tab. Pure, runs in Node too.
//
// Option sellers (dealers) collect time decay (theta) and pay for re-hedging
// moves (gamma). Over the last week they won if price moved less than options
// priced in (implied > realized) and lost if it moved more.
import { dailyMove } from './model.js';

function d(v) { return '±' + dailyMove(v).toFixed(1) + '%'; }
function pts(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1); }

// Rounded dollars: $840, $12k, $1.3M.
export function usd(v) {
  v = Math.abs(v);
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'k';
  return '$' + v.toFixed(0);
}
export function signedUsd(v) { return (v >= 0 ? '+' : '−') + usd(v); }

// One line on the dollars, or null. c = carry() from model.js.
// gap (implied − realized, step 1) and cfg are optional: when step 1 and the
// dollars disagree, say why instead of leaving it looking like a mistake.
export function readCarry(c, gap, cfg) {
  if (!c) return null;
  const t = c.total;
  const big = c.groups.slice().sort(function (a, b) { return Math.abs(b.net) - Math.abs(a.net); })[0];
  return 'In dollars: dealers ' + (t.theta >= 0 ? 'collect ~' + usd(t.theta) + ' a day from time decay' : 'pay ~' + usd(t.theta) + ' a day in time decay') +
    ' and ' + (t.hedge <= 0 ? 'spend ~' + usd(t.hedge) + ' re-hedging' : 'make ~' + usd(t.hedge) + ' from re-hedging') +
    ', so they ' + (t.net >= 0 ? 'make' : 'lose') + ' ~' + usd(t.net) + ' a day at last week\'s pace' +
    (big && Math.abs(big.net) >= 0.5 * Math.abs(t.net) && Math.abs(t.net) > 0 ? ', biggest share from ' + big.key + ' options.' : '.') +
    (cfg && gap <= -cfg.gapPts && t.net >= 0 ? ' Option sellers in general are losing, but on this page\'s assumption Deribit dealers own enough long-dated options to come out ahead.' :
     cfg && gap >= cfg.gapPts && t.net < 0 ? ' Option sellers in general are winning, but on this page\'s assumption Deribit dealers own more options than they sold, so the calm costs them.' : '');
}

// Who gains when implied vol moves, in words: "Dealers own more volatility than
// they sold (mostly quarterly options)". c = carry() from model.js.
export function vegaSide(c) {
  const t = c.total;
  const big = c.groups.filter(function (g) { return g.vegaW * t.vegaW > 0; })
    .sort(function (a, b) { return Math.abs(b.vegaW) - Math.abs(a.vegaW); })[0];
  return 'Dealers ' + (t.vegaW >= 0 ? 'own more volatility than they sold' : 'sold more volatility than they own') +
    (big ? ' (mostly ' + big.key + ' options)' : '');
}

// "If fear pushes implied vol up 5 points, dealers make about $1.9M; if it eases 5 points, they lose about $1.9M."
export function readShock(c, pts) {
  const up = c.total.vegaW * pts;
  return 'If fear pushes implied vol up ' + pts + ' points, dealers ' + (up >= 0 ? 'make' : 'lose') + ' about ' + usd(up) +
    '; if it eases ' + pts + ' points, they ' + (up >= 0 ? 'lose' : 'make') + ' about ' + usd(up) + '.';
}

// What the last 24h of implied vol change made (+) or cost (−) dealers, and how
// many days of time decay that is (0 when they aren't collecting decay).
function volHit(a) {
  const c = a.carry;
  if (!c) return { hit: 0, days: 0 };
  const hit = a.ivChange24h * c.total.vegaW;
  return { hit: hit, days: c.total.theta > 0 ? Math.abs(hit) / c.total.theta : 0 };
}

// The last 24h of implied vol change, in dealers' dollars when the option chain is in.
// Shown when it's a fear rising / easing day, or when the move cost or made dealers
// more than a day of time decay.
function readVolMove(a, cfg) {
  const dv = a.ivChange24h, c = a.carry;
  const rising = dv >= cfg.ivMovePts, easing = dv <= -cfg.ivMovePts;
  const head = rising ? 'Fear is rising: implied vol up ' + dv.toFixed(1) + ' points in a day'
    : easing ? 'Fear is easing: implied vol down ' + Math.abs(dv).toFixed(1) + ' points in a day'
    : 'Implied vol ' + (dv >= 0 ? 'up ' : 'down ') + Math.abs(dv).toFixed(1) + ' points in 24h';
  if (!c) return rising || easing ? head + '.' : null;
  const v = volHit(a);
  const hit = v.hit, days = v.days;
  if (Math.abs(hit) < 1e3) return rising || easing ? head + '.' : null;
  if (!rising && !easing && days < 1) return null;
  return head + '. ' + vegaSide(c) + ', so that ' + (hit >= 0 ? 'made' : 'cost') + ' them ~' + usd(hit) +
    (days >= 1 ? ', about ' + Math.round(days) + ' day' + (Math.round(days) === 1 ? '' : 's') + ' of time decay.' : '.');
}

// gamma: dealer net/gross gamma ratio near spot (from Deribit options), or null.
export function readMM(a, gamma, asset, cfg, neutral) {
  const gap = a.ivWeek - a.rvWeek;
  const lines = [];
  let tone, headline, action;

  if (gap >= cfg.gapPts) {
    tone = 'win';
    headline = 'Dealers are winning: ' + asset + ' moved less than options priced';
    action = 'Options price in more movement than ' + asset + ' is delivering, so calm, range-bound trading is the norm. ' +
      'The risk is a sudden move catching everyone off guard: watch for implied vol jumping.';
  } else if (gap <= -cfg.gapPts) {
    tone = 'lose';
    headline = 'Dealers are losing: ' + asset + ' moved more than options priced';
    action = 'Dealers who sold options are paying more to re-hedge than they collect, so they tend to raise option prices and hedge harder. ' +
      'Big moves tend to keep going: use wider stops and smaller size.';
  } else {
    tone = 'even';
    headline = 'Balanced: ' + asset + ' moved about as much as options priced';
    action = 'Options are fairly priced against recent movement, so volatility gives no edge either way. Follow the Fragility and Forced Flow readings.';
  }

  lines.push('Last ' + cfg.rvDays + ' days: options priced ' + d(a.ivWeek) + ' a day, ' + asset + ' actually moved ' + d(a.rvWeek) + ' a day.');
  lines.push('Now options price ' + d(a.ivNow) + ' a day (implied vol ' + a.ivNow.toFixed(0) + '%, ' + pts(a.ivChange24h) + ' in 24h; ' +
    (a.ivPct >= 90 ? 'near its 30-day high: the market expects bigger moves' : a.ivPct <= 10 ? 'near its 30-day low: the market expects calm' :
    a.ivPct >= 70 ? 'on the high side for the last 30 days' : a.ivPct <= 30 ? 'on the low side for the last 30 days' : 'middle of the last 30 days') + ').');
  if (a.rvDay != null && a.rvDay - a.ivNow >= cfg.spikePts) lines.push('Last 24h was unusually wild: ' + asset + ' moved at a ' + d(a.rvDay) + ' a day pace.');
  else if (a.rvDay != null) lines.push('Last 24h ' + asset + ' moved at a ' + d(a.rvDay) + ' a day pace.');
  const money = readCarry(a.carry, gap, cfg);
  if (money) lines.push(money);
  const vol = readVolMove(a, cfg);
  if (vol) lines.push(vol);
  if (gamma != null) {
    const g = Math.round(gamma * 100) / 100;
    if (Math.abs(g) < neutral) lines.push('Dealer gamma near the price is about neutral, so their hedging has little effect either way.');
    else if (g < 0) lines.push('Dealers are net short gamma near the price: their hedging chases moves, so this is where losing dealers make moves bigger.');
    else lines.push('Dealers are net long gamma near the price: their hedging leans against moves, which helps keep things calm.');
  }
  return { tone: tone, headline: headline, action: action, lines: lines, gap: gap };
}

// Winning / balanced / losing with a buffer, for alerts that shouldn't flap:
// once losing, dealers stay "losing" until the gap is back above −gapPts + flipBufferPts
// (and the same for winning).
export function dealerSide(gap, prev, cfg) {
  const b = cfg.flipBufferPts;
  if (gap >= cfg.gapPts || (prev === 'win' && gap > cfg.gapPts - b)) return 'win';
  if (gap <= -cfg.gapPts || (prev === 'lose' && gap < -cfg.gapPts + b)) return 'lose';
  return 'even';
}

// One combined verdict joining steps 1–3 with the Fragility zone.
// Each part adds pressure points (or takes them away); the reasons that pushed
// hardest are named. fr: { score, zone } from Fragility, or null.
const ZONE_POINTS = { Calm: 0, Building: 1, Primed: 2 };
export const OVERALL = { steady: 'Steady', watch: 'On watch', unstable: 'Unstable' };

export function readOverall(a, gamma, fr, cfg, neutral) {
  const gap = a.ivWeek - a.rvWeek;
  const parts = [];
  if (gap <= -cfg.gapPts) parts.push({ p: 2, why: 'dealers are losing on the moves' });
  else if (gap >= cfg.gapPts) parts.push({ p: -1, why: 'dealers are well paid for the moves' });
  if (a.carry && a.carry.total.net < 0) parts.push({ p: 1, why: 'they are losing ~' + usd(a.carry.total.net) + ' a day' });
  if (gamma != null && gamma <= -neutral) parts.push({ p: 1, why: 'their hedging chases moves near the price' });
  else if (gamma != null && gamma >= neutral) parts.push({ p: -1, why: 'their hedging leans against moves near the price' });
  const v = volHit(a);
  if (v.hit < 0 && v.days >= 1) parts.push({ p: 1, why: 'the last day\'s implied vol move cost them ~' + usd(v.hit) });
  if (fr && ZONE_POINTS[fr.zone]) parts.push({ p: ZONE_POINTS[fr.zone], why: fr.zone === 'Primed' ? 'leverage is stretched' : 'leverage is building' });

  const points = parts.reduce(function (s, x) { return s + x.p; }, 0);
  const level = points >= 4 ? 'unstable' : points >= 2 ? 'watch' : 'steady';
  const pick = function (f) {
    return parts.filter(f).sort(function (x, y) { return Math.abs(y.p) - Math.abs(x.p); }).map(function (x) { return x.why; });
  };
  const cap = function (t) { return t.charAt(0).toUpperCase() + t.slice(1); };
  const pushing = pick(function (x) { return x.p > 0; }), calming = pick(function (x) { return x.p < 0; });
  let reason;
  if (level === 'steady') {
    if (calming.length) reason = cap(calming.slice(0, 2).join(' and ')) + '.' + (pushing.length ? ' One thing to watch: ' + pushing[0] + '.' : '');
    else reason = pushing.length ? 'Only one thing to watch: ' + pushing[0] + '.' : 'Nothing stands out either way.';
  } else {
    reason = cap(pushing.slice(0, 2).join(' and ')) + '.';
  }
  return { level: level, points: points, name: OVERALL[level], reason: reason,
    text: 'Overall: ' + OVERALL[level].toLowerCase() + '. ' + reason };
}
