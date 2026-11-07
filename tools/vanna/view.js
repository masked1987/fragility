// Vanna tab: ETH 24-hour Vanna + Charm flow (7 Nov 2026, moved here from the owner's
// ChatGPT-built dashboard so it is public and its phone alert has a page to open).
// Reading card, the three implied-vol scenarios, the flow by expiry, the phone alert's
// last check, and how it works. Numbers come from collectFlow(), the same code the
// alert job runs (jobs/vanna-flow.mjs).
import { VANNA_CONFIG as CFG } from './config.js';
import { collectFlow } from './collect.js';
import { CONFIG as FRAG } from '../fragility/config.js';
import { headHtml, moreHtml } from '../../shared/head.js';

const STATE_URL = FRAG.historyUrl.replace(/log\.csv$/, 'vanna-flow.json');

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
// $ amounts: ~$10.5M, ~$850k.
function usd(x) {
  const a = Math.abs(x);
  return '$' + (a >= 1e9 ? (a / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? Math.round(a / 1e3) + 'k' : Math.round(a));
}
// Hedge flow in words: positive = dealers buy ETH.
function flowWord(x) { return (x >= 0 ? 'buy ' : 'sell ') + usd(x); }
function signed(x) { return Math.abs(x) < 0.5 ? '0' : (x >= 0 ? '+' : '−') + usd(x); }
function px(x) { return x.toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function when(t) { return new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }); }
function ago(t) {
  const m = Math.round((Date.now() - t) / 6e4);
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 48 * 60 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
}
function expDay(t) { return new Date(t).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: '2-digit' }); }
function tone(label) { return label === 'Bullish' ? 'win' : label === 'Bearish' ? 'lose' : 'even'; }

export function mount(el) {
  let data = null, alertState = null, loading = false;

  el.innerHTML =
    '<div class="row between">' +
      '<div class="seg"><button type="button" class="on">ETH</button></div>' +
      '<button class="btn" id="vf-refresh" type="button">Refresh</button>' +
    '</div>' +
    '<div id="vf-body"><section class="card"><p class="muted">Loading…</p></section></div>';
  const bodyEl = el.querySelector('#vf-body'), refreshBtn = el.querySelector('#vf-refresh');
  refreshBtn.addEventListener('click', refresh);

  async function refresh() {
    if (loading) return;
    loading = true;
    refreshBtn.disabled = true;
    const [flow, saved] = await Promise.allSettled([
      collectFlow(),
      fetch(STATE_URL + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }),
    ]);
    data = flow.status === 'fulfilled' ? flow.value : { ok: false, why: flow.reason && flow.reason.message || 'could not load' };
    data.fetched = Date.now();
    alertState = saved.status === 'fulfilled' ? saved.value : null;
    loading = false;
    refreshBtn.disabled = false;
    render();
  }

  function render() {
    if (!data) return;
    if (!data.ok) {
      bodyEl.innerHTML = '<section class="card verdict even"><div class="label">ETH · 24h flow</div>' +
        headHtml('No reading: ' + data.why) +
        '<p class="verdict-action"><b>What it means:</b> nothing to read right now. It tries again in ' + Math.round(CFG.refreshSeconds / 60) + ' minutes, or tap Refresh.</p></section>' +
        alertHtml(null) + howHtml();
      return;
    }
    bodyEl.innerHTML = readingHtml(data) + scenariosHtml(data) + alertHtml(data) + expiriesHtml(data) + howHtml();
  }

  function readingHtml(d) {
    const r = d.reading, flat = r.rows[1], res = d.result;
    const charmFlow = -d.book.total.charm, vannaFlow = -d.book.total.vanna;
    let head, meaning;
    if (r.label === 'Bullish' || r.label === 'Bearish') {
      const up = r.label === 'Bullish';
      head = r.label + ': dealer hedging ' + (up ? 'buys' : 'sells') + ' ~' + usd(flat.total) + ' of ETH over the next day';
      meaning = 'As time passes (with implied vol steady), dealers have to ' + (up ? 'buy' : 'sell') + ' ETH to stay hedged: a ' +
        (up ? 'tailwind' : 'headwind') + ' for price. It holds whether implied vol rises or falls 3 points. Size: ' + r.strength.toLowerCase() + ' (' +
        r.pct.toFixed(2) + '% of a day\'s trading).';
    } else if (!r.robust) {
      head = 'Neutral: it depends on which way implied vol moves';
      meaning = 'If implied vol falls 3 points the hedging is ' + r.rows[0].label.toLowerCase() + ' (' + flowWord(r.rows[0].total) + '), if it rises 3 points ' +
        r.rows[2].label.toLowerCase() + ' (' + flowWord(r.rows[2].total) + '). No clear lean, so no push either way.';
    } else {
      head = 'Neutral: the hedging flow is too small to matter';
      meaning = 'Over the next day dealers ' + flowWord(flat.total) + ' of ETH at most, under ' + (res.threshold ? usd(res.threshold) : '0.01%') +
        ' (0.01% of a day\'s trading) or the time and vol parts cancel out. No push either way.';
    }
    const lines = [
      'Steady implied vol: dealers ' + flowWord(flat.total) + ' of ETH in 24h = ' + r.pct.toFixed(3) + '% of the day\'s ETH perpetual trading (' + usd(r.turnover) + ', ' + r.sources.join(' + ') + ').',
      'Time passing (Charm) alone: ' + flowWord(charmFlow) + ' a day. Each 1 point rise in implied vol (Vanna): ' + flowWord(vannaFlow) + '.',
      'Implied vol −3 / flat / +3 points: ' + r.rows.map(function (x) { return x.label; }).join(' / ') + (r.robust ? ' (all agree).' : ' (they disagree, so Neutral).'),
      'Dealer gamma across all expiries: ' + (d.netGamma >= 0 ? 'long' : 'short') + ' ' + usd(Math.abs(d.netGamma) * 1e6) + ' per 1% move' +
        (d.netGamma < 0 ? ' (short gamma makes a clear lean one step stronger).' : '.'),
      'Spot ' + px(r.spot) + ' (Deribit index); ' + r.series + ' options over ' + r.expiryCount + ' expiries.' + (r.fallback ? ' Turnover from the backup exchanges (Binance / Bybit did not answer).' : ''),
    ];
    return '<section class="card verdict ' + tone(r.label) + '">' +
      '<div class="label">ETH · 24h flow (Vanna + Charm)</div>' +
      headHtml(head) +
      '<p class="verdict-action"><b>What it means:</b> ' + esc(meaning) + '</p>' +
      moreHtml('<ul class="verdict-lines small">' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>', lines.length) +
      '<p class="muted small">Deribit options, all expiries; dealers assumed long calls, short puts. Updated ' + ago(d.fetched) + '. Context, not a trade signal.</p>' +
    '</section>';
  }

  function scenariosHtml(d) {
    const res = d.result;
    const names = { '-3': 'Implied vol falls 3', '0': 'Implied vol steady', '3': 'Implied vol rises 3' };
    const rows = res.rows.map(function (x) {
      const cls = x.label === 'Bullish' ? 'ok' : x.label === 'Bearish' ? 'bad' : 'muted';
      return '<tr' + (x.iv === 0 ? ' class="al-near"' : '') + '><td>' + names[String(x.iv)] + '</td>' +
        '<td class="num">' + signed(x.charm) + '</td><td class="num">' + signed(x.vanna) + '</td>' +
        '<td class="num"><b>' + signed(x.total) + '</b></td><td class="' + cls + '"><b>' + x.label + '</b></td></tr>';
    }).join('');
    return '<section class="card"><h3>Next 24 hours, three ways</h3>' +
      '<p class="small">What dealers buy (+) or sell (−) in ETH to stay hedged, for each move in implied vol (DVOL points).</p>' +
      '<table class="stats"><tr><th></th><th>Time</th><th>Vol</th><th>Total</th><th></th></tr>' + rows + '</table>' +
      '<p class="small muted">Time = Charm (one day passing). Vol = Vanna × the vol move. A label needs the total above ' +
        (res.threshold ? usd(res.threshold) : '0.01% of turnover') + ' (0.01% of a day\'s trading) and the two parts not cancelling within 10%. ' +
        'Strength: under 0.1% of turnover weak, 0.1–0.3% moderate, over 0.3% strong.</p></section>';
  }

  function alertHtml(d) {
    const s = alertState && alertState.reading;
    let last = '<p class="small muted">The alert job has not saved a reading yet.</p>';
    if (s) {
      last = '<dl class="pb-dl"><dt>Last check</dt><dd><b>' + esc(s.label) + '</b> · ' + when(s.observedAt) + ' (' + ago(s.observedAt) + ')</dd>' +
        '<dt>Turnover from</dt><dd>' + esc((s.sources || []).join(' + ')) + '</dd>' +
        (alertState.lastNotification ? '<dt>Last alert</dt><dd>' + esc(alertState.lastNotification.from) + ' → ' + esc(alertState.lastNotification.to) + ', ' + when(alertState.lastNotification.at) + '</dd>' : '<dt>Last alert</dt><dd class="muted">none yet (the label has not changed)</dd>') +
        '</dl>';
      if (d && d.ok && s.label !== d.reading.label) {
        last += '<p class="small al-warn">This page reads <b>' + esc(d.reading.label) + '</b> now. The job checks every 15 minutes (GitHub can run it late), ' +
          'and it may use other exchanges for turnover (' + esc(d.reading.sources.join(' + ')) + ' here), which can move a reading near the line.</p>';
      }
    }
    return '<section class="card"><h3>Phone alert</h3>' +
      '<p class="small">Rings once (normal priority) when the label changes between <b>Bullish</b>, <b>Bearish</b> and <b>Neutral</b>. ' +
        'The first reading only sets the starting point; changes in size or strength alone don\'t ring. Tapping it opens this tab.</p>' + last + '</section>';
  }

  function expiriesHtml(d) {
    const rows = d.book.expiries.slice(0, CFG.expiryRows).map(function (e) {
      const days = (e.key - d.book.now) / 864e5;
      return '<tr><td>' + expDay(e.key) + ' <span class="muted">' + (days < 1 ? Math.max(1, Math.round(days * 24)) + 'h' : Math.round(days) + 'd') + '</span></td>' +
        '<td class="num">' + signed(-e.charm) + '</td><td class="num">' + signed(-e.vanna) + '</td><td class="num muted">' + px(e.oi) + '</td></tr>';
    }).join('');
    const more = d.book.expiries.length - CFG.expiryRows;
    return '<section class="card"><h3>By expiry</h3>' +
      '<p class="small">Dealers\' hedge flow from each expiry: a day passing (Time) and a 1 point rise in implied vol (Vol). Short-dated options decay fastest, so they usually lead.</p>' +
      '<table class="stats"><tr><th>Expiry</th><th>Time</th><th>Vol +1</th><th>Open ETH</th></tr>' + rows +
        '<tr><td><b>All</b></td><td class="num"><b>' + signed(-d.book.total.charm) + '</b></td><td class="num"><b>' + signed(-d.book.total.vanna) + '</b></td><td class="num muted">' + px(d.book.total.oi) + '</td></tr></table>' +
      (more > 0 ? '<p class="small muted">' + more + ' later expiries are in the total, not listed.</p>' : '') + '</section>';
  }

  function howHtml() {
    return '<section class="card"><h3>How this works</h3><ul class="small">' +
      '<li><b>Vanna</b>: how much an option\'s delta (its ETH exposure) changes when implied vol moves. <b>Charm</b>: how much it changes as a day passes.</li>' +
      '<li>Dealers hedge their options in ETH. When those Greeks shift their delta, they buy or sell ETH to stay flat. That buying or selling is the "flow".</li>' +
      '<li>Dealers are assumed long calls and short puts (same as every tab). Real dealer positions are not public, so this is a scenario, not their actual book.</li>' +
      '<li>The flow is compared with one day of ETH perpetual trading on two exchanges, so a small number is called Neutral.</li>' +
      '<li>Same rules as your ChatGPT dashboard it came from, and the same code as the phone alert.</li>' +
      '</ul></section>';
  }

  refresh();
  const timer = setInterval(function () { if (!el.closest('.pane').hidden) refresh(); }, CFG.refreshSeconds * 1000);
  return function () { clearInterval(timer); };
}
