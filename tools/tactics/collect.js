// Fetch one asset for the Tactics tab and run the model.
import * as deribit from '../../shared/sources/deribit.js';
import { gammaFlip } from '../../shared/gamma.js';
import { optionTrades, perpTrades, minuteCandles } from './sources.js';
import { gexNodes, gexGrid, pickPivot, pickPivots, profile, drift, footprint, niceStep, setup, decideBoth } from './model.js';

// The session the tab uses at time `now`: the UTC day; early in the day,
// yesterday's full session.
export function session(now, cfg) {
  const today = Math.floor(now / 864e5) * 864e5;
  const young = now - today < cfg.sessionMinHours * 36e5;
  return { from: young ? today - 864e5 : today, today: today, young: young };
}

export async function collectTac(asset, cfg) {
  const now = Date.now();
  const ses = session(now, cfg);
  const fpFrom = now - cfg.footprintHours * 36e5;

  const res = await Promise.allSettled([
    deribit.options(asset),
    minuteCandles(asset, Math.min(ses.from, now - 8 * 36e5), now), // the interval map shows 8 hours
    optionTrades(asset, ses.from, now),
    perpTrades(asset, Math.floor(fpFrom / (cfg.candleMinutes * 6e4)) * cfg.candleMinutes * 6e4, now),
  ]);
  if (res[0].status !== 'fulfilled') throw new Error('Deribit options unavailable: ' + res[0].reason.message);
  const out = buildTac(asset, now, {
    chain: res[0].value,
    minutes: res[1].status === 'fulfilled' ? res[1].value : [],
    optTr: res[2].status === 'fulfilled' ? res[2].value : null,
    perp: res[3].status === 'fulfilled' ? res[3].value : [],
  }, cfg);
  out.missing = [res[1].status !== 'fulfilled' ? 'volume profile (Gate)' : null, res[2].status !== 'fulfilled' ? 'premium drift (Deribit)' : null,
    res[3].status !== 'fulfilled' ? 'order flow (Deribit)' : null].filter(Boolean);
  return out;
}

// Everything the tab and the alert read, from data already fetched. Pure: the
// backtest (test/tactics-backtest.mjs) feeds it past data, so live and past
// readings go through exactly the same steps.
//   chain = { spot, options }, minutes = 1-minute candles { t, o, h, l, c, usd },
//   optTr = option trades since the session start (or null), perp = perpetual
//   trades since the footprint window start.
export function buildTac(asset, now, data, cfg) {
  const chain = data.chain, spot = chain.spot, minutes = data.minutes, optTr = data.optTr, perp = data.perp;
  const ses = session(now, cfg);

  const nodes = gexNodes(chain.options, spot, now, cfg.nodeRangePct);
  const pivot = pickPivot(nodes, spot, cfg);
  const pivots = pickPivots(nodes, spot, cfg); // nearest big node above (SELL rules) and below (BUY rules)
  const flip = gammaFlip(chain.options, spot, now);
  const sessionCandles = minutes.filter(function (c) { return c.t >= ses.from && (!ses.young || c.t < ses.today); });
  const prof = sessionCandles.length ? profile(sessionCandles, cfg.profileRows, cfg.valueArea) : null;
  const dr = optTr ? drift(optTr, 5 * 6e4) : null;

  // Footprint rows sized to the candles shown.
  const shownFrom = now - cfg.footprintCandles * cfg.candleMinutes * 6e4;
  const shown = perp.filter(function (t) { return t.t >= shownFrom; });
  const lo = Math.min.apply(null, shown.map(function (t) { return t.price; }).concat(pivot ? [pivot.strike] : []));
  const hi = Math.max.apply(null, shown.map(function (t) { return t.price; }).concat(pivot ? [pivot.strike] : []));
  const rowSize = shown.length ? niceStep(Math.max(hi - lo, spot * 0.002), 16) : 1;
  const candles = footprint(perp, cfg.candleMinutes * 6e4, rowSize);

  const st = { spot: spot, pivot: pivot, flip: flip, nodes: nodes, profile: prof, drift: dr, candles: candles };
  const s = setup(st, cfg);
  // The six video rules on both sides at once: SELL at the pivot above, BUY at the pivot below.
  const sellS = pivots.above ? (pivots.above === pivot ? s : setup(Object.assign({}, st, { pivot: pivots.above }), cfg)) : null;
  const buyS = pivots.below ? (pivots.below === pivot ? s : setup(Object.assign({}, st, { pivot: pivots.below }), cfg)) : null;
  return {
    asset: asset, fetched: now, spot: spot, session: ses,
    nodes: nodes, pivot: pivot, pivots: pivots, flip: flip, grid: gexGrid(chain.options, spot, now, cfg),
    minutes: minutes, profile: prof, drift: dr, candles: candles, rowSize: rowSize,
    setup: s,
    decision: decideBoth(sellS, buyS, spot), // both sides; the tab's BUY / SELL / HOLD card and the phone alert both read this
    missing: [],
  };
}
