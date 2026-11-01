// Fetch one asset for the Tactics tab and run the model.
import * as deribit from '../../shared/sources/deribit.js';
import { gammaFlip } from '../../shared/gamma.js';
import { optionTrades, perpTrades, minuteCandles } from './sources.js';
import { gexNodes, gexGrid, pickPivot, profile, drift, footprint, niceStep, setup, decide } from './model.js';

export async function collectTac(asset, cfg) {
  const now = Date.now();
  // Session = the UTC day; early in the day, yesterday's full session is used.
  const today = Math.floor(now / 864e5) * 864e5;
  const young = now - today < cfg.sessionMinHours * 36e5;
  const from = young ? today - 864e5 : today;
  const fpFrom = now - cfg.footprintHours * 36e5;

  const res = await Promise.allSettled([
    deribit.options(asset),
    minuteCandles(asset, Math.min(from, now - 8 * 36e5), now), // the interval map shows 8 hours
    optionTrades(asset, from, now),
    perpTrades(asset, Math.floor(fpFrom / (cfg.candleMinutes * 6e4)) * cfg.candleMinutes * 6e4, now),
  ]);
  if (res[0].status !== 'fulfilled') throw new Error('Deribit options unavailable: ' + res[0].reason.message);
  const chain = res[0].value, spot = chain.spot;
  const minutes = res[1].status === 'fulfilled' ? res[1].value : [];
  const optTr = res[2].status === 'fulfilled' ? res[2].value : null;
  const perp = res[3].status === 'fulfilled' ? res[3].value : [];

  const nodes = gexNodes(chain.options, spot, now, cfg.nodeRangePct);
  const pivot = pickPivot(nodes, spot, cfg);
  const flip = gammaFlip(chain.options, spot, now);
  const sessionCandles = minutes.filter(function (c) { return c.t >= from && (!young || c.t < today); });
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
  return {
    asset: asset, fetched: now, spot: spot, session: { from: from, today: today, young: young },
    nodes: nodes, pivot: pivot, flip: flip, grid: gexGrid(chain.options, spot, now, cfg),
    minutes: minutes, profile: prof, drift: dr, candles: candles, rowSize: rowSize,
    setup: s,
    decision: decide(s), // the six video rules: the tab's BUY / SELL / HOLD card and the phone alert both read this
    missing: [res[1].status !== 'fulfilled' ? 'volume profile (Gate)' : null, res[2].status !== 'fulfilled' ? 'premium drift (Deribit)' : null,
      res[3].status !== 'fulfilled' ? 'order flow (Deribit)' : null].filter(Boolean),
  };
}
