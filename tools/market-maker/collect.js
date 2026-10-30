// Fetch one asset for the Market Maker tab.
import * as deribit from '../../shared/sources/deribit.js';
import * as gate from '../../shared/sources/gate.js';
import { gex } from '../../shared/gamma.js';
import { analyse } from './model.js';

export async function collectMM(asset, cfg) {
  // Rounded to the hour so repeated loads share the HTTP cache.
  const end = Math.floor(Date.now() / 36e5) * 36e5 + 36e5;
  const start = end - (cfg.chartDays + cfg.rvDays + 1) * 864e5;
  const res = await Promise.allSettled([deribit.dvol(asset, start, end), gate.hourlyCloses(asset, (cfg.chartDays + cfg.rvDays + 1) * 24), deribit.options(asset)]);
  if (res[0].status !== 'fulfilled') throw new Error('Deribit implied vol unavailable: ' + res[0].reason.message);
  if (res[1].status !== 'fulfilled') throw new Error('Gate price history unavailable: ' + res[1].reason.message);
  const a = analyse(res[0].value, res[1].value, cfg);
  let gamma = null;
  if (res[2].status === 'fulfilled' && res[2].value.options.length) {
    const g = gex(res[2].value.options, res[2].value.spot, Date.now());
    if (g.gross > 0) gamma = g.net / g.gross;
  }
  return Object.assign({ asset: asset, fetched: Date.now(), gamma: gamma }, a);
}
