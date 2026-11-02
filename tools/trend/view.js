// Trend tab: the 50-day average rule, long only (asked 2 Nov 2026, "create separate tab
// with that strategy"). Reading card, IN / OUT card with tonight's line and the exact
// rules, a 6-month chart, the trades, and the backtest behind it.
import { TREND_CONFIG as CFG } from './config.js';
import { collectTrend } from './collect.js';
import { tonight, DAY } from './model.js';
import { headHtml, moreHtml, splitHead } from '../../shared/head.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function px(x) { return '~' + Math.round(x).toLocaleString('en-US'); }
function num(x) { return x.toLocaleString('en-US', { minimumFractionDigits: x < 10000 ? 1 : 0, maximumFractionDigits: x < 10000 ? 1 : 0 }); }
function sp(x, d) { return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d == null ? 1 : d) + '%'; }
// Dates of daily closes in UTC (a close at 00:00 UTC on 9 Oct is "9 Oct").
function day(t, year) { return new Date(t).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: year ? 'numeric' : undefined }); }
function localTime(t) { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }
function inHours(t) { const h = (t - Date.now()) / 36e5; return h < 1 ? 'in ' + Math.max(1, Math.round(h * 60)) + ' min' : 'in ' + Math.round(h) + ' h'; }

export function mount(el) {
  const data = {};
  let selected = CFG.assets[0], loading = false;

  el.innerHTML =
    '<div class="row between">' +
      '<div class="seg" id="tr-assets"></div>' +
      '<button class="btn" id="tr-refresh" type="button">Refresh</button>' +
    '</div>' +
    '<div id="tr-body"><section class="card"><p class="muted">Loading…</p></section></div>';
  const assetsEl = el.querySelector('#tr-assets'), bodyEl = el.querySelector('#tr-body'), refreshBtn = el.querySelector('#tr-refresh');

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
    try { data[asset] = await collectTrend(asset, CFG); }
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
    bodyEl.innerHTML = readingHtml(d) + decisionHtml(d) + chartHtml(d) + tradesHtml(d) + backtestHtml(d);
  }

  // BUY / SELL for the first day after the close that crossed, then IN / OUT.
  function action(d) {
    const m = d.model, fresh = m.since.crossed && Date.now() - m.since.t < CFG.freshHours * 36e5;
    return fresh ? (m.on ? 'buy' : 'sell') : (m.on ? 'in' : 'out');
  }

  function readingHtml(d) {
    const m = d.model, a = esc(d.asset), act = action(d), tn = tonight(m, d.price);
    const head = {
      buy: 'Buy: ' + a + ' closed above its ' + CFG.days + '-day average',
      sell: 'Sell: ' + a + ' closed under its ' + CFG.days + '-day average',
      in: 'In: ' + a + ' is above its ' + CFG.days + '-day average',
      out: 'Out: ' + a + ' is under its ' + CFG.days + '-day average',
    }[act];
    const flipWord = m.on ? 'SELL' : 'BUY';
    const meaning = (m.on
      ? (act === 'buy' ? 'Buy and hold ' + a + '. ' : 'Hold ' + a + '. ') + 'Sell on the first daily close under ' + px(m.line) + ' (tonight\'s line).'
      : (act === 'sell' ? 'Sell and stay in cash. ' : 'Stay in cash. ') + 'Buy on the first daily close above ' + px(m.line) + ' (tonight\'s line).') +
      (tn.flips ? ' Price is ' + (m.on ? 'under' : 'over') + ' that line now: if ' + a + ' closes like this tonight, that\'s a ' + flipWord + '.' : '');
    const lines = [
      'Last daily close (' + day(m.lastClose) + ', 00:00 UTC): ' + num(m.close) + ', ' + CFG.days + '-day average ' + num(m.avg) + ' (' + sp(m.distPct) + ').',
      'Price now ' + num(d.price) + '; tonight\'s line ' + num(m.line) + ' (' + sp((d.price / m.line - 1) * 100) + ' from it).',
      'The average is ' + (m.slope >= 0 ? 'rising' : 'falling') + ' (' + sp(m.slope) + ' over 5 days)' +
        (m.on ? '.' : (m.slope < 0 ? ', so the line comes down to meet the price.' : ', so the price has more to climb.')),
      (m.on ? 'In' : 'Out') + ' since the close on ' + day(m.since.t, true) + ' at ' + num(m.since.price) +
        (m.on && m.open ? ' (' + sp((d.price / m.open.price - 1) * 100) + ' so far)' : '') + '.',
      'Next check: tonight\'s daily close, 00:00 UTC (' + localTime(d.nextClose) + ' your time), ' + inHours(d.nextClose) + '.',
    ];
    const tone = act === 'sell' ? 'lose' : m.on ? 'win' : 'even';
    return '<section class="card verdict ' + tone + '">' +
      '<div class="label">' + a + ' reading</div>' +
      headHtml(head) +
      '<p class="verdict-action"><b>What it means:</b> ' + esc(meaning) + '</p>' +
      moreHtml('<ul class="verdict-lines small">' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>', lines.length) +
      '<p class="muted small">Gate daily candles. Context, not a trade signal.</p>' +
    '</section>';
  }

  function decisionHtml(d) {
    const m = d.model, a = esc(d.asset), act = action(d), tn = tonight(m, d.price), cls = m.on ? 'buy' : act === 'sell' ? 'sell' : 'hold';
    const head = m.on ? (act === 'buy' ? 'Bought at the close on ' + day(m.since.t) : 'Holding since ' + day(m.since.t))
      : (act === 'sell' ? 'Sold at the close on ' + day(m.since.t) : 'In cash since ' + day(m.since.t));
    const lineRow = '<dt>Tonight\'s line</dt><dd><b class="num">' + num(m.line) + '</b> <span class="muted">' +
      (m.on ? 'a daily close under it = SELL' : 'a daily close over it = BUY') + '</span></dd>';
    const body = '<dl class="pb-dl">' +
      '<dt>Price now</dt><dd><b class="num">' + num(d.price) + '</b> <span class="muted">' + sp((d.price / m.line - 1) * 100) + ' from the line' +
        (tn.flips ? ', a ' + (m.on ? 'SELL' : 'BUY') + ' if it closes like this' : '') + '</span></dd>' +
      lineRow +
      '<dt>' + CFG.days + '-day average</dt><dd class="num">' + num(m.avg) + ' <span class="muted">at the last close (' + num(m.close) + ', ' + sp(m.distPct) + ')</span></dd>' +
      (m.on && m.open ? '<dt>This trade</dt><dd>bought <b class="num">' + num(m.open.price) + '</b> on ' + day(m.open.t) + ', <b>' + sp((d.price / m.open.price - 1) * 100) + '</b> so far</dd>' : '') +
      '<dt>Next check</dt><dd>00:00 UTC (' + localTime(d.nextClose) + ' your time), ' + inHours(d.nextClose) + '</dd></dl>';
    const rules = '<div class="mm-rules"><div class="label">The rules, exactly as backtested</div><ol class="small">' +
      '<li>Check once a day, at the daily close: <b>00:00 UTC</b> (' + localTime(d.nextClose) + ' your time).</li>' +
      '<li>The ' + CFG.days + '-day average = the average of the last ' + CFG.days + ' daily closes (an SMA ' + CFG.days + ' on a daily chart).</li>' +
      '<li>Close <b>above</b> the average: own ' + a + '. If you are out, buy at that close.</li>' +
      '<li>Close <b>below</b> the average: hold cash. If you are in, sell at that close.</li>' +
      '<li>Nothing else: no stop loss, no target, no trading during the day. Long only, no leverage.</li>' +
      '</ol><p class="small muted">"Tonight\'s line" is the price today\'s close has to beat to sit above its own ' + CFG.days + '-day average (the average of the last ' + (CFG.days - 1) + ' closes).</p></div>';
    return '<section class="card tc-dec ' + cls + '">' +
      '<div class="tc-dec-top"><span class="tc-dec-badge">' + act.toUpperCase() + '</span>' +
        '<div><div class="label">' + a + ' · trend ' + CFG.days + '</div><p class="tc-dec-head">' + esc(splitHead(head).title) + '</p></div></div>' +
      body + rules +
    '</section>';
  }

  function chartHtml(d) {
    const st = d.model.states.slice(-CFG.chartDays);
    if (st.length < 2) return '';
    const W = 340, H = 190, padL = 4, padR = 46;
    let lo = Infinity, hi = -Infinity;
    st.forEach(function (s) { lo = Math.min(lo, s.close, s.avg); hi = Math.max(hi, s.close, s.avg); });
    lo = Math.min(lo, d.price); hi = Math.max(hi, d.price);
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const n = st.length;
    const x = function (i) { return padL + i / n * (W - padL - padR); };
    const y = function (p) { return H - (p - lo) / (hi - lo) * H; };
    let s = '';
    // Shade the days spent IN.
    let i0 = null;
    for (let i = 0; i <= n; i++) {
      const on = i < n && st[i].on;
      if (on && i0 === null) i0 = i;
      if (!on && i0 !== null) { s += '<rect class="tr-in" x="' + x(i0).toFixed(1) + '" y="0" width="' + (x(i) - x(i0)).toFixed(1) + '" height="' + H + '"/>'; i0 = null; }
    }
    // Price labels on the right: top, bottom.
    [hi - pad, lo + pad].forEach(function (p) {
      s += '<text class="axis" x="' + (W - padR + 4) + '" y="' + (y(p) + 3).toFixed(1) + '">' + Math.round(p).toLocaleString('en-US') + '</text>';
    });
    s += '<polyline class="tr-ma" points="' + st.map(function (k, i) { return x(i).toFixed(1) + ',' + y(k.avg).toFixed(1); }).join(' ') + '"/>';
    s += '<polyline class="tr-px" points="' + st.map(function (k, i) { return x(i).toFixed(1) + ',' + y(k.close).toFixed(1); }).join(' ') + ' ' + x(n).toFixed(1) + ',' + y(d.price).toFixed(1) + '"/>';
    for (let i = 1; i < n; i++) {
      if (st[i].on === st[i - 1].on) continue;
      s += st[i].on
        ? '<path class="al-buy" d="M' + x(i).toFixed(1) + ',' + (y(st[i].close) + 10).toFixed(1) + ' l-5,8 h10 z"/>'
        : '<path class="al-sell" d="M' + x(i).toFixed(1) + ',' + (y(st[i].close) - 10).toFixed(1) + ' l-5,-8 h10 z"/>';
    }
    s += '<circle class="tr-now" cx="' + x(n).toFixed(1) + '" cy="' + y(d.price).toFixed(1) + '" r="3.5"/>' +
      '<text class="tr-nowt" x="' + (W - padR + 4) + '" y="' + (y(d.price) + 3).toFixed(1) + '">' + Math.round(d.price).toLocaleString('en-US') + '</text>';
    return '<section class="card"><h3>Last ' + Math.round(n / 30) + ' months</h3>' +
      '<div class="legend small"><span><i class="ln"></i>Daily close</span><span><i class="ln tr-mal"></i>' + CFG.days + '-day average</span>' +
        '<span><i class="tr-insw"></i>In</span><span><i class="al-tri"></i>Buy</span><span><i class="al-tri dn"></i>Sell</span></div>' +
      '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(d.asset) + ' daily closes and the ' + CFG.days + '-day average, last ' + n + ' days">' + s + '</svg></div></section>';
  }

  function tradesHtml(d) {
    const m = d.model, r = m.result;
    const rows = [];
    if (m.open) rows.push('<tr><td>' + day(m.open.t, true) + '<br><span class="num">' + num(m.open.price) + '</span></td><td class="muted">open<br><span class="num">' + num(d.price) + ' now</span></td>' +
      '<td class="num"><b>' + sp((d.price / m.open.price - 1) * 100) + '</b></td><td class="num">' + Math.round((Date.now() - m.open.t) / DAY) + '</td></tr>');
    m.trades.slice().reverse().slice(0, 10 - rows.length).forEach(function (t) {
      rows.push('<tr><td>' + day(t.buy.t, true) + '<br><span class="num">' + num(t.buy.price) + '</span></td><td>' + day(t.sell.t, true) + '<br><span class="num">' + num(t.sell.price) + '</span></td>' +
        '<td class="num ' + (t.pct >= 0 ? 'ok' : 'bad') + '"><b>' + sp(t.pct) + '</b></td><td class="num">' + Math.round((t.sell.t - t.buy.t) / DAY) + '</td></tr>');
    });
    return '<section class="card"><h3>Trades</h3>' +
      '<p class="small">On Gate\'s ' + esc(d.asset) + ' prices since ' + day(r.from, true) + ': <b>' + sp(r.total, 0) + '</b> with these rules vs <b>' + sp(r.hold, 0) + '</b> just holding, ' +
        r.trades + ' trades, worst drop ' + r.dd.toFixed(0) + '% <span class="muted">(after 0.05% a side)</span>.</p>' +
      '<table class="stats"><tr><th>Bought</th><th>Sold</th><th>Result</th><th>Days</th></tr>' + rows.join('') + '</table>' +
      '<p class="small muted">Newest first, last ' + rows.length + '. Result after costs' + (m.open ? '; the open one at today\'s price' : '') + '.</p></section>';
  }

  function backtestHtml(d) {
    const b = CFG.backtest;
    const yrs = b.years.map(function (y) {
      return '<tr><td>' + esc(y[0]) + '</td><td class="num ' + (y[1] >= 0 ? 'ok' : 'bad') + '"><b>' + sp(y[1]) + '</b></td><td class="num muted">' + sp(y[2]) + '</td></tr>';
    }).join('');
    return '<section class="card"><h3>How it did on past data</h3>' +
      '<p class="small">' + esc(b.asset) + ', ' + esc(b.period) + ', these exact rules (Deribit daily closes, full position, compounded, 0.05% a side):</p>' +
      '<table class="stats"><tr><th></th><th>Trend ' + CFG.days + '</th><th>Just holding</th></tr>' + yrs +
        '<tr><td><b>3 years</b></td><td class="num ok"><b>' + sp(b.total) + '</b></td><td class="num muted">' + sp(b.hold) + '</td></tr>' +
        '<tr><td>Worst drop</td><td class="num">' + b.dd.toFixed(0) + '%</td><td class="num muted">' + b.holdDd.toFixed(0) + '%</td></tr></table>' +
      '<dl class="pb-dl"><dt>Trades</dt><dd>' + b.trades + ' (about 7 a year)</dd>' +
        '<dt>Months</dt><dd>' + b.monthsUp + ' up, ' + b.monthsDown + ' down (the rest in cash)</dd>' +
        '<dt>Crashes it sat out</dt><dd>' + esc(b.sidestepped) + '</dd>' +
        '<dt>Not a lucky number</dt><dd>every average from 30 to 200 days beat holding: ' + esc(b.neighbours) + '</dd></dl>' +
      '<p class="small al-warn"><b>The catch:</b> it lags. It buys after a rise has started and sells after a fall has started, so in sideways months it buys high and sells low, ' +
        'and it still had a ' + b.dd.toFixed(0) + '% drop. Most of the gain came from a few long trends (May–Aug 2025). Past results don\'t promise future ones.</p>' +
      (d.asset !== b.asset ? '<p class="small muted">The backtest was ' + esc(b.asset) + ' only; the line above the table shows ' + esc(d.asset) + ' on Gate prices.</p>' : '') +
    '</section>';
  }

  refresh();
  const timer = setInterval(function () { if (!el.closest('.pane[hidden]')) refresh(); }, CFG.refreshSeconds * 1000);
  return function () { clearInterval(timer); };
}
