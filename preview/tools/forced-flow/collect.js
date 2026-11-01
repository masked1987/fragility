// Fetch and model one asset for the Forced Flow map.
import * as gate from '../../shared/sources/gate.js';
import { gammaFlip } from '../../shared/gamma.js';
import { collect as collectFragility } from '../fragility/collect.js';
import { evaluate } from '../fragility/score.js';
import { CONFIG as FRAGILITY_CONFIG } from '../fragility/config.js';
import { estimateBook, buildLadder, clusters, lastDayLiquidations } from './model.js';

export async function collectFlow(asset, cfg) {
  // Reuses the Fragility fetch (venue OI, Deribit options); the shared HTTP
  // cache means the Fragility tab and this one don't download it twice.
  const res = await Promise.allSettled([gate.hourly(asset), collectFragility(asset)]);
  if (res[0].status !== 'fulfilled') throw new Error('Gate history unavailable: ' + res[0].reason.message);
  const hours = res[0].value;
  const market = res[1].status === 'fulfilled' ? res[1].value : null;
  const now = Date.now();

  const opts = market && market.options ? market.options.options : null;
  const spot = market && market.options ? market.options.spot : hours[hours.length - 1].price;

  // Gate is one venue; scale its positions to the OI of every reachable venue.
  const gateOi = hours[hours.length - 1].oiCoins;
  const totalOi = market ? market.perps.reduce(function (a, p) { return a + p.oiCoins; }, 0) : 0;
  const scale = totalOi > gateOi ? totalOi / gateOi : 1;
  const venues = market ? market.perps.map(function (p) { return p.venue; }) : ['Gate'];

  const book = estimateBook(hours, cfg);
  const bins = buildLadder(book, opts, spot, now, scale, cfg);
  const fragility = market ? evaluate(market, FRAGILITY_CONFIG) : null;
  const funding = fragility ? fragility.inputs.find(function (i) { return i.key === 'funding'; }) : null;

  return {
    asset: asset,
    time: now,
    spot: spot,
    bins: bins,
    flip: opts ? gammaFlip(opts, spot, now) : null,
    clusters: clusters(bins, spot, opts, now, cfg),
    liq24: lastDayLiquidations(hours),
    scale: scale,
    venues: venues,
    fragility: fragility ? { score: fragility.score, zone: fragility.zone, funding: funding && funding.score != null ? funding.note.split(' · ')[0] : null } : null,
    sources: market ? market.sources : [],
  };
}
