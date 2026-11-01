// Gather one asset's readings from the other tabs and build the plan.
// Forced Flow and Market Maker both fetch the Fragility inputs; the shared HTTP
// cache means they are downloaded once.
import { collectFlow } from '../forced-flow/collect.js';
import { FLOW_CONFIG } from '../forced-flow/config.js';
import { readFlow } from '../forced-flow/read.js';
import { collectMM } from '../market-maker/collect.js';
import { MM_CONFIG } from '../market-maker/config.js';
import { readMM, readOverall } from '../market-maker/read.js';
import { CONFIG as FRAGILITY } from '../fragility/config.js';
import { buildPlan } from './plan.js';
import { getJson } from '../../shared/http.js';
import * as deribit from '../../shared/sources/deribit.js';
import { pickLevels } from '../../shared/levels.js';

// The key gamma levels: the ones the alert job picked and saved (so this tab and
// the job agree). If that file can't be read, pick them the same way now.
async function alertLevels(asset) {
  const KL = FRAGILITY.keyLevels;
  if (KL.assets.indexOf(asset) < 0) return [];
  try {
    const st = await getJson(FRAGILITY.stateUrl);
    const k = st && st.keyLevels && st.keyLevels[asset];
    if (k && k.levels && k.levels.length) return k.levels;
  } catch (e) { /* fall through */ }
  try {
    const c = await deribit.options(asset);
    return pickLevels(c.options, c.spot, Date.now(), KL).map(function (l) { return l.price; });
  } catch (e) { return []; }
}

export async function collectPlay(asset, cfg) {
  const res = await Promise.allSettled([collectFlow(asset, FLOW_CONFIG), collectMM(asset, MM_CONFIG), alertLevels(asset)]);
  if (res[0].status !== 'fulfilled') throw new Error('Forced Flow unavailable: ' + res[0].reason.message);
  if (res[1].status !== 'fulfilled') throw new Error('Market Maker unavailable: ' + res[1].reason.message);
  const f = res[0].value, mm = res[1].value;
  const neutral = FRAGILITY.gamma.neutralRatio;
  const flow = readFlow(f, FLOW_CONFIG.read);
  const overall = readOverall(mm, mm.gamma, mm.fragility, MM_CONFIG, neutral);
  const fr = f.fragility;
  const s = {
    asset: asset,
    spot: f.spot,
    flip: f.flip,
    move: mm.ivNow / Math.sqrt(365) / 100,
    zone: fr ? fr.zone : null,
    score: fr ? fr.score : null,
    funding: fr && fr.funding ? (/crowded short/.test(fr.funding) ? 'short' : /crowded long/.test(fr.funding) ? 'long' : null) : null,
    fundingNote: fr ? fr.funding : null,
    gamma: mm.gamma,
    neutral: neutral,
    overall: overall,
    gap: mm.ivWeek - mm.rvWeek,
    gapPts: MM_CONFIG.gapPts,
    flow: flow,
    longs: f.clusters.longs,
    shorts: f.clusters.shorts,
    strikes: f.bins.map(function (b) { return { price: b.mid, gamma: b.gamma }; }),
    levels: res[2].status === 'fulfilled' ? res[2].value : [],
    closes: mm.points.slice(-4).map(function (p) { return p.price; }),
    mmHeadline: readMM(mm, mm.gamma, asset, MM_CONFIG, neutral).headline,
  };
  return { asset: asset, fetched: Date.now(), s: s, plan: buildPlan(s, cfg) };
}
