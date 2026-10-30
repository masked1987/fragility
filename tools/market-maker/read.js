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
export function readCarry(c) {
  if (!c) return null;
  const t = c.total;
  const big = c.groups.slice().sort(function (a, b) { return Math.abs(b.net) - Math.abs(a.net); })[0];
  return 'In dollars: dealers ' + (t.theta >= 0 ? 'collect ~' + usd(t.theta) + ' a day from time decay' : 'pay ~' + usd(t.theta) + ' a day in time decay') +
    ' and ' + (t.hedge <= 0 ? 'spend ~' + usd(t.hedge) + ' re-hedging' : 'make ~' + usd(t.hedge) + ' from re-hedging') +
    ', so they ' + (t.net >= 0 ? 'make' : 'lose') + ' ~' + usd(t.net) + ' a day at last week\'s pace' +
    (big && Math.abs(big.net) >= 0.5 * Math.abs(t.net) && Math.abs(t.net) > 0 ? ', biggest share from ' + big.key + ' options.' : '.');
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
  if (a.ivChange24h >= cfg.ivMovePts) lines.push('Fear is rising: implied vol up ' + a.ivChange24h.toFixed(1) + ' points in a day, which costs option sellers (vega).');
  if (a.ivChange24h <= -cfg.ivMovePts) lines.push('Fear is easing: implied vol down ' + Math.abs(a.ivChange24h).toFixed(1) + ' points in a day.');
  const money = readCarry(a.carry);
  if (money) lines.push(money);
  if (gamma != null) {
    const g = Math.round(gamma * 100) / 100;
    if (Math.abs(g) < neutral) lines.push('Dealer gamma near the price is about neutral, so their hedging has little effect either way.');
    else if (g < 0) lines.push('Dealers are net short gamma near the price: their hedging chases moves, so this is where losing dealers make moves bigger.');
    else lines.push('Dealers are net long gamma near the price: their hedging leans against moves, which helps keep things calm.');
  }
  return { tone: tone, headline: headline, action: action, lines: lines, gap: gap };
}
