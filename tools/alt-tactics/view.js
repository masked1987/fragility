// Alt Tactics tab: the owner's own method on the huge gamma levels (kept apart from
// Tactics, which follows the video). BUY / WATCH / WAIT card, the Ichimoku checklist,
// the huge levels with their status, a 48-hour chart, and the backtest behind it.
import { ALT_CONFIG as CFG } from './config.js';
import { collectAlt } from './collect.js';
import { splitHead } from '../../shared/head.js';
import { load } from '../../shared/storage.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function px(x) { return '~' + Math.round(x).toLocaleString('en-US'); }
function num(x) { return x.toLocaleString('en-US', { minimumFractionDigits: x < 10000 ? 1 : 0, maximumFractionDigits: x < 10000 ? 1 : 0 }); }
function hhmm(t) { return new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }); }
function pct(a, b) { const v = (a / b - 1) * 100; return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%'; }
const ICON = { ok: '✓', no: '✕' };

export function mount(el) {
  const data = {};
  let selected = CFG.assets[0], loading = false;

  el.innerHTML =
    '<div class="row between">' +
      '<div class="seg" id="al-assets"></div>' +
      '<button class="btn" id="al-refresh" type="button">Refresh</button>' +
    '</div>' +
    '<div id="al-body"><section class="card"><p class="muted">Loading…</p></section></div>';
  const assetsEl = el.querySelector('#al-assets'), bodyEl = el.querySelector('#al-body'), refreshBtn = el.querySelector('#al-refresh');

  assetsEl.addEventListener('click', function (e) {
    const b = e.target.closest('button[data-asset]');
    if (!b) return;
    selected = b.getAttribute('data-asset');
    render();
    if (stale()) refresh();
  });
  refreshBtn.addEventListener('click', refresh);

  function stale() { return !data[selected] || Date.now() - data[selected].fetched > CFG.refreshSeconds * 1000; }

  async function refresh() {
    if (loading) return;
    loading = true;
    refreshBtn.disabled = true;
    const asset = selected;
    try { data[asset] = await collectAlt(asset, CFG); }
    catch (e) { data[asset] = { error: e.message, fetched: Date.now() }; }
    loading = false;
    refreshBtn.disabled = false;
    render();
  }

  function render() {
    assetsEl.innerHTML = CFG.assets.map(function (a) {
      return '<button type="button" data-asset="' + a + '" class="' + (a === selected ? 'on' : '') + '">' + a + '</button>';
    }).join('');
    const d = data[selected];
    if (!d) { bodyEl.innerHTML = '<section class="card"><p class="muted">Loading…</p></section>'; return; }
    if (d.error) { bodyEl.innerHTML = '<section class="card"><p>Could not load: ' + esc(d.error) + '</p></section>'; return; }
    bodyEl.innerHTML = decisionHtml(d) + ichimokuHtml(d) + levelsHtml(d) + chartHtml(d) + backtestHtml();
  }

  function sizeText(entry, stop) {
    const account = +load('playbook.account', 10000), riskPct = +load('playbook.riskPct', 1);
    const risk = account * riskPct / 100, per = Math.abs(entry - stop);
    if (!(risk > 0) || !(per > 0)) return '<span class="muted">set your account on the Plan tab</span>';
    return 'risking $' + Math.round(risk).toLocaleString('en-US') + ' (' + riskPct + '% of $' + Math.round(account).toLocaleString('en-US') + '): about <b class="num">' +
      (risk / per).toFixed(per > 100 ? 3 : 2) + ' ' + esc(selected) + '</b>';
  }

  function decisionHtml(d) {
    const dec = d.decision, a = esc(d.asset);
    // A signal is "BUY" for its first hour; after that the trade shows as OPEN, so an
    // old signal is never read as "buy now" (entering late means a wider stop).
    const fresh = dec.open && d.fetched - dec.open.signal.t <= 60 * 6e4;
    const act = dec.action === 'buy' ? (fresh ? 'buy' : 'open') : dec.action;
    let head, body;
    if (dec.action === 'buy') {
      const s = dec.open, g = s.signal;
      head = fresh ? 'Buy: ' + a + ' dipped through ' + px(s.level) + ' and buyers are back'
        : 'Open: the buy from the dip through ' + px(s.level) + ' is still running';
      body = '<dl class="pb-dl">' +
        '<dt>Bought at</dt><dd><b class="num">' + num(g.entry) + '</b> <span class="muted">(' + hhmm(g.t) + ', price now ' + num(d.spot) + ')</span></dd>' +
        '<dt>Stop</dt><dd><b class="num">' + num(g.stop) + '</b> <span class="muted">the lowest price of the dip, ' + s.depth.toFixed(1) + '% under ' + px(s.level) + '</span></dd>' +
        '<dt>Target</dt><dd><b class="num">' + px(g.target) + '</b> <span class="muted">the next huge level, ' + (g.rr ? g.rr.toFixed(1) + '× the risk' : '') + '</span></dd>' +
        '<dt>Size</dt><dd>' + sizeText(g.entry, g.stop) + '</dd></dl>' +
        (fresh ? '' : '<p class="small">Signal from ' + hhmm(g.t) + '. Buying now instead means a wider stop and less reward; the low stays the stop either way.</p>') +
        '<p class="verdict-action"><b>What it means:</b> the dip through ' + px(s.level) + ' looks like a shake-out, not a breakdown. ' +
        'If price goes back under ' + num(g.stop) + ' the idea is wrong; ' + px(s.level) + ' is then used, and the next chance is at the next huge level.</p>';
    } else if (act === 'watch') {
      const s = dec.waiting, now = dec.ichimoku ? dec.ichimoku.score : null;
      head = 'Watch: ' + a + ' dipped through ' + px(s.level) + ', waiting for buyers';
      body = '<dl class="pb-dl">' +
        '<dt>Dipped</dt><dd>' + hhmm(s.t0) + ', low so far <b class="num">' + num(s.low) + '</b> <span class="muted">(' + s.depth.toFixed(1) + '% under, a breakdown past ' + CFG.maxDepthPct + '%)</span></dd>' +
        '<dt>Waiting for</dt><dd>the ' + CFG.candleMinutes + '-minute Ichimoku score to reach ' + CFG.scoreBuy + ' <span class="muted">(now ' + (now == null ? '–' : now) + ')</span></dd>' +
        '<dt>Then</dt><dd>buy, stop at the low, target ' + (s.target ? px(s.target) : '<span class="muted">no huge level above</span>') + '</dd></dl>' +
        '<p class="verdict-action"><b>What it means:</b> the setup is live. Don\'t buy yet: the low can still go lower until buyers take over.</p>';
    } else {
      head = 'Wait: no dip through a huge level';
      body = '<p class="verdict-action"><b>What it means:</b> nothing to do. The setup starts when price trades below a huge level' +
        (dec.below ? ', the nearest is <b>' + px(dec.below) + '</b> (' + pct(dec.below, d.spot) + ')' : '') +
        (dec.above ? '. Next one up: ' + px(dec.above) + ' (' + pct(dec.above, d.spot) + ')' : '') + '.</p>';
    }
    const cls = act === 'buy' || act === 'open' ? 'buy' : act === 'watch' ? 'watch' : 'hold';
    return '<section class="card tc-dec ' + cls + '">' +
      '<div class="tc-dec-top"><span class="tc-dec-badge">' + act.toUpperCase() + '</span>' +
        '<div><div class="label">' + a + ' · your method</div><p class="tc-dec-head">' + esc(splitHead(head).rest || head) + '</p></div></div>' +
      body +
      '<p class="muted small">Buys only, once per level. Your own indicator may see what this doesn\'t; it has the last word. Context, not a trade signal.</p>' +
    '</section>';
  }

  function ichimokuHtml(d) {
    const ich = d.decision.ichimoku;
    if (!ich) return '';
    const p = ich.parts, rows = [
      [p.tenkan, 'Price above the Tenkan line (the 9-candle midpoint)'],
      [p.cross, 'Tenkan above the Kijun line (the 26-candle midpoint)'],
      [p.cloud, 'Price above the cloud'],
      [p.green, 'The cloud is bullish (green)'],
      [p.lag, 'Price above where it was 26 candles ago'],
    ];
    return '<section class="card"><h3>Ichimoku score ' + ich.score + ' / 100</h3>' +
      '<div class="al-meter" aria-hidden="true"><i style="width:' + ich.score + '%"></i><b style="left:' + CFG.scoreBuy + '%"></b></div>' +
      '<p class="small muted">' + CFG.candleMinutes + '-minute candles, 20 points each. A buy needs a dip through a huge level first, then this crossing up through ' + CFG.scoreBuy + '.</p>' +
      '<ul class="tc-checks small">' + rows.map(function (r) {
        return '<li class="' + (r[0] ? 'ok' : 'no') + '"><span class="tc-ic">' + (r[0] ? ICON.ok : ICON.no) + '</span><span>' + r[1] + '</span></li>';
      }).join('') + '</ul></section>';
  }

  function levelsHtml(d) {
    const setups = d.decision.setups;
    const status = function (L) {
      const last = setups.filter(function (s) { return s.level === L; }).pop();
      if (!last) return L <= d.spot ? 'Watching for a dip through' : 'Above the price';
      if (last.used) return 'Used (once per level)';
      if (last.taken) return last.trade.result === 'open' ? 'In the trade' : last.trade.result === 'target' ? 'Bought, target hit' : 'Bought, stopped';
      return { waiting: 'Dipped, waiting for buyers', broken: 'Broke through (more than ' + CFG.maxDepthPct + '%)', lapsed: 'Dipped, no buyers in ' + CFG.windowHours + ' h', signal: 'Signal, no level above' }[last.state] || '';
    };
    const rows = d.huge.slice().reverse().map(function (h) {
      return '<tr' + (h.price === d.decision.below ? ' class="al-near"' : '') + '><td class="num"><b>' + px(h.price) + '</b></td>' +
        '<td><span class="al-bar"><i style="width:' + Math.round(h.share * 100) + '%"></i></span></td>' +
        '<td class="num">' + pct(h.price, d.spot) + '</td><td>' + esc(status(h.price)) + '</td></tr>';
    }).join('');
    return '<section class="card"><h3>Huge levels</h3>' +
      '<p class="small muted">Strikes with at least ' + Math.round(CFG.hugeShare * 100) + '% of the biggest open interest (calls + puts) within ±' + CFG.rangePct + '%. Price ' + num(d.spot) + '.</p>' +
      '<table class="stats al-levels"><tr><th>Level</th><th>Size</th><th>From price</th><th>Status</th></tr>' + rows + '</table></section>';
  }

  function chartHtml(d) {
    // Normally the last chartHours; with a trade or a waiting dip, back to just before the dip.
    const dec = d.decision, live = dec.open || dec.waiting;
    const from = Math.min(d.fetched - CFG.chartHours * 36e5, live ? live.t0 - 2 * 36e5 : Infinity);
    const c = d.candles.filter(function (x) { return x.t >= from; });
    if (c.length < 2) return '';
    const W = 340, H = 180, padL = 4, padR = 46;
    const lv = d.huge.map(function (h) { return h.price; });
    let lo = Math.min.apply(null, c.map(function (x) { return x.l; })), hi = Math.max.apply(null, c.map(function (x) { return x.h; }));
    // Always show the huge level under and over the price (and the trade's level and stop).
    [dec.below, dec.above, live && live.level, dec.open && dec.open.signal.stop].forEach(function (L) { if (L) { lo = Math.min(lo, L); hi = Math.max(hi, L); } });
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const x = function (t) { return padL + (t - c[0].t) / (c[c.length - 1].t - c[0].t) * (W - padL - padR); };
    const y = function (p) { return H - (p - lo) / (hi - lo) * H; };
    let s = '';
    lv.forEach(function (L) {
      if (L < lo || L > hi) return;
      s += '<line class="al-lv" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(L).toFixed(1) + '" y2="' + y(L).toFixed(1) + '"/>' +
        '<text class="al-lvt" x="' + (W - padR + 4) + '" y="' + (y(L) + 3).toFixed(1) + '">' + Math.round(L).toLocaleString('en-US') + '</text>';
    });
    if (dec.open) {
      const st = dec.open.signal.stop;
      s += '<line class="al-stop" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(st).toFixed(1) + '" y2="' + y(st).toFixed(1) + '"/>' +
        '<text class="al-stopt" x="' + (W - padR + 4) + '" y="' + (y(st) + 3).toFixed(1) + '">stop</text>';
    }
    s += '<polyline class="al-px" points="' + c.map(function (k) { return x(k.t).toFixed(1) + ',' + y(k.c).toFixed(1); }).join(' ') + '"/>';
    d.decision.setups.forEach(function (st) {
      if (st === live && st.lowT && st.lowT >= from && isFinite(st.low)) s += '<circle class="al-low" cx="' + x(st.lowT).toFixed(1) + '" cy="' + y(st.low).toFixed(1) + '" r="3.5"/>';
      if (st.taken && st.signal.t >= from) s += '<path class="al-buy" d="M' + x(st.signal.t).toFixed(1) + ',' + (y(st.signal.entry) + 12).toFixed(1) + ' l-5,8 h10 z"/>';
    });
    return '<section class="card"><h3>' + (live ? 'Since the dip' : 'Last ' + CFG.chartHours + ' hours') + '</h3>' +
      '<div class="legend small"><span><i class="ln al-lvl"></i>Huge level</span><span><i class="dot al-lowdot"></i>Low of a dip</span><span><i class="al-tri"></i>Buy signal</span></div>' +
      '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Price and the huge levels, last ' + CFG.chartHours + ' hours">' + s + '</svg></div></section>';
  }

  function backtestHtml() {
    const b = CFG.backtest;
    return '<section class="card"><h3>How it did on past data</h3>' +
      '<p class="small">ETH, ' + b.from + ' to now, these exact rules (huge levels, ' + CFG.candleMinutes + '-minute Ichimoku, stop at the low, target the next huge level, once per level, 0.1% costs):</p>' +
      '<dl class="pb-dl"><dt>Trades</dt><dd>' + b.trades + ' (about 15 a year)</dd>' +
      '<dt>Reached target</dt><dd>' + b.hitPct + '%</dd>' +
      '<dt>Average</dt><dd><b>+' + b.avgR.toFixed(2) + 'R</b> per trade <span class="muted">(R = the stop distance)</span></dd>' +
      '<dt>By year</dt><dd>' + esc(b.years) + '</dd>' +
      '<dt>Worst run</dt><dd>' + b.worstRun + ' losses in a row</dd></dl>' +
      '<details class="tc-fold"><summary class="small"><b>The rules and the catch</b></summary><ol class="tc-steps small">' +
        '<li>Levels: only the huge strikes, at least ' + Math.round(CFG.hugeShare * 100) + '% of the biggest open interest.</li>' +
        '<li>Price was above a level and trades below it (spikes count).</li>' +
        '<li>Stop: the lowest price since the dip. More than ' + CFG.maxDepthPct + '% under the level is a real breakdown: no trade.</li>' +
        '<li>Buy when the ' + CFG.candleMinutes + '-minute Ichimoku score crosses up through ' + CFG.scoreBuy + ' (stand-in for your indicator).</li>' +
        '<li>Target: the next huge level up. One trade per level; a used level comes back after price crosses another one.</li>' +
        '<li>The catch: few trades, and the 10 best make most of the profit. Levels came from monthly snapshots, so yours may differ. Stops can fill worse in fast markets.</li>' +
      '</ol></details></section>';
  }

  refresh();
  const timer = setInterval(function () { if (!el.closest('.pane[hidden]')) refresh(); }, CFG.refreshSeconds * 1000);
  return function () { clearInterval(timer); };
}
