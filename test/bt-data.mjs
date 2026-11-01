// Shared loaders for the Tactics backtests (test/tactics-backtest.mjs,
// test/tactics-compare.mjs): past ETH option chains, perpetual trades, option
// trades and 1-minute candles for one UTC day, cached as JSON in a folder.
// Downloads run as child processes so several days can load at once.
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const exec = promisify(execCb);
export const ASSET = 'ETH', DAY = 864e5, M15 = 15 * 6e4;
const TARDIS = 'https://datasets.tardis.dev/v1/deribit';
const DERIBIT = 'https://history.deribit.com/api/v2/public';
const MONTH = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
export const ymd = d => new Date(d).toISOString().slice(0, 10).replace(/-/g, '/');
export const px = x => Math.round(x).toLocaleString('en-US');

let CACHE = '.bt-cache';
export function setCache(dir) { CACHE = dir; mkdirSync(CACHE, { recursive: true }); }

export function cached(name, make) {
  const f = join(CACHE, name);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  return Promise.resolve(make()).then(v => { writeFileSync(f, JSON.stringify(v)); return v; });
}
export async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) { /* retry */ }
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error('failed: ' + url);
}

// Every ETH option at the start of the day: the last row per instrument in the
// file's first ~200 MB (about the first 20 minutes).
export function chainAt(D) {
  return cached('chain-' + ymd(D).replace(/\//g, '') + '.json', async () => {
    const raw = (await exec(`curl -s -r 0-209715199 "${TARDIS}/options_chain/${ymd(D)}/OPTIONS.csv.gz" | (gunzip 2>/dev/null || true) | grep '^deribit,ETH-' || true`,
      { maxBuffer: 2e9 })).stdout;
    const last = {};
    for (const line of raw.split('\n')) {
      const f = line.split(',');
      if (f.length < 17) continue;
      last[f[1]] = { strike: +f[5], type: f[4] === 'call' ? 'C' : 'P', expiry: +f[6] / 1000, oi: +f[7], iv: +f[16] / 100 };
    }
    return Object.values(last).filter(o => o.oi > 0 && o.iv > 0 && o.strike > 0);
  });
}

export function perpTradesOn(D) {
  return cached('perp-' + ymd(D).replace(/\//g, '') + '.json', async () => {
    const raw = (await exec(`curl -s "${TARDIS}/trades/${ymd(D)}/ETH-PERPETUAL.csv.gz" | gunzip`, { maxBuffer: 2e9 })).stdout;
    return raw.split('\n').slice(1).filter(Boolean).map(l => {
      const f = l.split(',');
      return { t: Math.floor(+f[2] / 1000), price: +f[6], usd: +f[7], dir: f[5] === 'buy' ? 1 : -1 };
    });
  });
}

// Same mapping as tools/tactics/sources.js optionTrades(), from the history API.
export function optionTradesOn(D) {
  return cached('opt-' + ymd(D).replace(/\//g, '') + '.json', async () => {
    const out = [];
    let end = D + DAY;
    for (let p = 0; p < 300; p++) {
      const j = await getJson(`${DERIBIT}/get_last_trades_by_currency_and_time?currency=${ASSET}&kind=option&start_timestamp=${D}&end_timestamp=${end}&count=1000&sorting=desc`);
      const tr = j.result.trades;
      out.push(...tr);
      if (!j.result.has_more || !tr.length) break;
      end = tr[tr.length - 1].timestamp - 1;
    }
    return out.reverse().map(t => {
      const p = t.instrument_name.split('-'), e = p[1].match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
      return { t: t.timestamp, type: p[3], strike: +p[2], expiry: e ? Date.UTC(2000 + +e[3], MONTH[e[2]], +e[1], 8) : null,
        dir: t.direction === 'buy' ? 1 : -1, usd: t.price * t.amount * t.index_price };
    }).filter(t => t.type === 'C' || t.type === 'P');
  });
}

// 1-minute candles (USD volume) from the day's start to 2 days later.
export function minutesFrom(D) {
  return cached('min-' + ymd(D).replace(/\//g, '') + '.json', async () => {
    const out = [];
    for (let a = D; a < D + 2 * DAY; a += DAY / 4) {
      const j = await getJson(`https://www.deribit.com/api/v2/public/get_tradingview_chart_data?instrument_name=${ASSET}-PERPETUAL&start_timestamp=${a}&end_timestamp=${a + DAY / 4 - 1}&resolution=1`);
      const r = j.result;
      r.ticks.forEach((t, i) => out.push({ t, o: r.open[i], h: r.high[i], l: r.low[i], c: r.close[i], usd: r.cost[i] }));
    }
    return out;
  });
}

// What happened after a signal: first target or stop first, within 24 hours.
export function outcome(s, side, T, minutes) {
  const tg = s.targets[0], risk = Math.abs(s.stop - s.entry), short = side === 'sell';
  let best = 0, worst = 0;
  const after = minutes.filter(m => m.t >= T && m.t < T + DAY);
  for (const m of after) {
    const fav = short ? s.entry - m.l : m.h - s.entry, adv = short ? m.h - s.entry : s.entry - m.l;
    best = Math.max(best, fav); worst = Math.max(worst, adv);
    const hitStop = short ? m.h >= s.stop : m.l <= s.stop;
    const hitTg = tg && (short ? m.l <= tg.price : m.h >= tg.price);
    if (hitStop) return { result: 'stop', R: -1, mins: (m.t - T) / 6e4, best: best / risk };
    if (hitTg) return { result: 'target', R: tg.r, mins: (m.t - T) / 6e4, best: best / risk };
  }
  const last = after[after.length - 1];
  const R = last ? (short ? s.entry - last.c : last.c - s.entry) / risk : 0;
  return { result: 'neither in 24h', R: R, mins: null, best: best / risk, worst: worst / risk };
}
