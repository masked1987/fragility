// Fetch one asset for the Market Maker tab.
import * as deribit from '../../shared/sources/deribit.js';
import * as gate from '../../shared/sources/gate.js';
import { gex } from '../../shared/gamma.js';
import { collect as collectFragility } from '../fragility/collect.js';
import { evaluate } from '../fragility/score.js';
import { CONFIG as FRAGILITY } from '../fragility/config.js';
import { analyse, carry } from './model.js';

// market: a Fragility collect() result if the caller already has one (the
// scheduled job does); otherwise it is fetched here. The shared HTTP cache means
// the Fragility tab and this one don't download it twice.
export async function collectMM(asset, cfg, market) {
  // Rounded to the hour so repeated loads share the HTTP cache.
  const end = Math.floor(Date.now() / 36e5) * 36e5 + 36e5;
  const start = end - (cfg.chartDays + cfg.rvDays + 1) * 864e5;
  const res = await Promise.allSettled([deribit.dvol(asset, start, end), gate.hourlyCloses(asset, (cfg.chartDays + cfg.rvDays + 1) * 24),
    market ? Promise.resolve(market) : collectFragility(asset)]);
  if (res[0].status !== 'fulfilled') throw new Error('Deribit implied vol unavailable: ' + res[0].reason.message);
  if (res[1].status !== 'fulfilled') throw new Error('Gate price history unavailable: ' + res[1].reason.message);
  const a = analyse(res[0].value, res[1].value, cfg);
  const m = res[2].status === 'fulfilled' ? res[2].value : null;
  let gamma = null, dollars = null, fragility = null;
  if (m && m.options && m.options.options.length) {
    const ch = m.options;
    const g = gex(ch.options, ch.spot, Date.now());
    if (g.gross > 0) gamma = g.net / g.gross;
    dollars = carry(ch.options, ch.spot, Date.now(), a.rvWeek);
  }
  if (m) {
    const fr = evaluate(m, FRAGILITY);
    if (fr.score != null) fragility = { score: fr.score, zone: fr.zone };
  }
  return Object.assign({ asset: asset, fetched: Date.now(), gamma: gamma, carry: dollars, fragility: fragility }, a);
}
