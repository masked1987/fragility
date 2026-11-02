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

  // The stop loss as a number to type into the order, worked out from live prices:
  // CFG.stopBufferPct under the low (buys) / over the high (sells). from = the entry,
  // or the price now while a setup is still waiting.
  // Where the stop goes, in words: "at the low" or "0.4% under the low".
  function slWhere(buy) {
    return CFG.stopBufferPct > 0 ? CFG.stopBufferPct + '% ' + (buy ? 'under the low' : 'over the high') : (buy ? 'at the low' : 'at the high');
  }
  function stopBox(stop, ext, buy, from, fromWord, note, source) {
    const dist = Math.abs(from - stop);
    return '<div class="al-sl"><div class="label">' + (note ? 'Stop loss so far' : 'Your stop loss') + '</div>' +
      '<div class="al-sl-num num">' + num(stop) + '</div>' +
      '<div class="small">' + (CFG.stopBufferPct > 0 ? slWhere(buy) + ' ' + num(ext) : 'the ' + (buy ? 'low' : 'high') + ' of the ' + (buy ? 'dip' : 'spike')) + ' · ' +
        num(dist) + ' points (' + (dist / from * 100).toFixed(1) + '%) ' + (buy ? 'under ' : 'over ') + fromWord + '</div>' +
      (note ? '<div class="small muted">' + note + '</div>' : '') +
      '<div class="small muted">' + (source === 'Bitstamp' ? 'From Bitstamp ' + esc(selected) + '/USD, close to TradingView\'s ' + esc(selected) + '/USD (Oct 30 low 2,170.0 vs 2,169.92).'
        : 'From Gate (Bitstamp didn\'t answer); your chart can differ by a few points.') + '</div></div>';
  }

  function decisionHtml(d) {
    const dec = d.decision, a = esc(d.asset), b = CFG.backtest;
    // A signal is BUY / SELL for its first hour; after that the trade shows as OPEN, so an
    // old signal is never read as "trade now" (entering late means a wider stop).
    const o = dec.open, fresh = o && d.fetched - o.signal.t <= 60 * 6e4;
    const act = o ? (fresh ? o.side : 'open') : dec.action;
    const unproven = '<p class="small al-warn"><b>Unproven:</b> sells only come after a buy reached its target, so they are rare: ' + b.sell.trades +
      ' in the 3-year backtest, ' + b.sell.won + ' reached target. Far too few to judge. Your call.</p>';
    const whyHere = function (w) {
      return w ? '<p class="small"><b>Why a sell here:</b> the buy from ' + px(w.from) + ' reached its target at ' + px(w.level) + ' (' + hhmm(w.at) + '). After a win you look the other way.</p>' : '';
    };
    let head, body;
    if (o) {
      const g = o.signal, buy = o.side === 'buy', word = buy ? 'Buy' : 'Sell';
      const how = buy ? 'dipped through ' : 'spiked over ';
      head = fresh ? word + ': ' + a + ' ' + how + px(o.level) + (buy ? ' and buyers are back' : ' and sellers are back')
        : 'Open: the ' + word.toLowerCase() + ' from the ' + (buy ? 'dip through ' : 'spike over ') + px(o.level) + ' is still running';
      body = stopBox(g.stop, o.ext, buy, g.entry, 'the entry', null, d.source) + '<dl class="pb-dl">' +
        '<dt>' + (buy ? 'Bought' : 'Sold') + ' at</dt><dd><b class="num">' + num(g.entry) + '</b> <span class="muted">(' + hhmm(g.t) + ', price now ' + num(d.spot) + ')</span></dd>' +
        '<dt>Stop</dt><dd><b class="num">' + num(g.stop) + '</b> <span class="muted">the ' + (buy ? 'low' : 'high') + ' of the ' + (buy ? 'dip' : 'spike') + ' was ' + num(o.ext) + ', ' + o.depth.toFixed(1) + '% ' + (buy ? 'under ' : 'over ') + px(o.level) + '</span></dd>' +
        '<dt>Target</dt><dd><b class="num">' + px(g.target) + '</b> <span class="muted">the biggest huge level ' + (buy ? 'up' : 'down') + (g.rr ? ', ' + g.rr.toFixed(1) + '× the risk' : '') + '</span></dd>' +
        '<dt>Size</dt><dd>' + sizeText(g.entry, g.stop) + '</dd></dl>' +
        (fresh ? '' : '<p class="small">Signal from ' + hhmm(g.t) + '. Entering now instead means a wider stop and less reward; the stop stays at ' + num(g.stop) + ' either way.</p>') +
        (buy ? '' : whyHere(o.win)) + (buy ? '' : unproven) +
        '<p class="verdict-action"><b>What it means:</b> the ' + (buy ? 'dip through ' : 'spike over ') + px(o.level) + ' looks like a shake-out, not a real break. ' +
        'If price goes ' + (buy ? 'back under ' : 'back over ') + num(g.stop) + ' the idea is wrong; ' + px(o.level) + ' is then used, and the next chance is at another huge level.</p>';
    } else if (act === 'watch') {
      const w = dec.waiting, buy = w.side === 'buy', now = dec.ichimoku ? dec.ichimoku.score : null;
      head = 'Watch: ' + a + (buy ? ' dipped through ' : ' spiked over ') + px(w.level) + ', waiting for ' + (buy ? 'buyers' : 'sellers');
      const pre = w.ext * (1 + (buy ? -1 : 1) * CFG.stopBufferPct / 100);
      body = stopBox(pre, w.ext, buy, d.spot, 'the price now', 'It moves ' + (buy ? 'down if the low goes lower' : 'up if the high goes higher') +
          ' before ' + (buy ? 'buyers' : 'sellers') + ' are back; the ' + (buy ? 'BUY' : 'SELL') + ' card then shows the final number.', d.source) +
        '<dl class="pb-dl">' +
        '<dt>' + (buy ? 'Dipped' : 'Spiked') + '</dt><dd>' + hhmm(Math.max(w.t0, w.win ? w.win.at : 0)) + ', ' + (buy ? 'low' : 'high') + ' so far <b class="num">' + num(w.ext) + '</b> <span class="muted">(' + w.depth.toFixed(1) + '% ' + (buy ? 'under' : 'over') + ', a real break past ' + CFG.maxDepthPct + '%)</span></dd>' +
        '<dt>Waiting for</dt><dd>the ' + CFG.candleMinutes + '-minute Ichimoku score to ' + (buy ? 'reach ' + CFG.scoreBuy : 'drop to ' + CFG.scoreSell) + ' <span class="muted">(now ' + (now == null ? '–' : now) + ')</span></dd>' +
        '<dt>Then</dt><dd>' + (buy ? 'buy, stop ' + slWhere(true) : 'sell, stop ' + slWhere(false)) + ', target ' + (w.target ? px(w.target) : '<span class="muted">no huge level ' + (buy ? 'above' : 'below') + '</span>') + '</dd></dl>' +
        (buy ? '' : whyHere(w.win)) + (buy ? '' : unproven) +
        '<p class="verdict-action"><b>What it means:</b> the setup is live. Don\'t ' + (buy ? 'buy' : 'sell') + ' yet: the ' + (buy ? 'low can still go lower until buyers' : 'high can still go higher until sellers') + ' take over.</p>';
    } else {
      const st = dec.stopped;
      head = st ? 'Wait: the buy at ' + px(st.level) + ' was stopped' : 'Wait: no cross of a huge level';
      body = (st ? '<p class="small">Stopped at ' + num(st.signal.stop) + ' (' + hhmm(st.trade.at) + '). ' + px(st.level) +
          ' is used: no new buy there until price crosses another huge level. You re-enter at the next level, by all the rules.</p>' : '') +
        '<p class="verdict-action"><b>What it means:</b> nothing to do. The next buy starts when price dips below ' +
        (dec.nextBuy ? '<b>' + px(dec.nextBuy) + '</b> (' + pct(dec.nextBuy, d.spot) + ')' : 'a huge level (none open under the price now)') +
        (dec.above ? '. Next one up: ' + px(dec.above) + ' (' + pct(dec.above, d.spot) + ')' : '') + '.</p>' +
        (dec.sellReady ? '<p class="small">The buy from ' + px(dec.sellReady.from) + ' reached its target at ' + px(dec.sellReady.level) + ' (' + hhmm(dec.sellReady.at) +
          '). Until ' + hhmm(dec.sellReady.until) + ', a spike over ' + px(dec.sellReady.level) + ' with sellers coming back is a sell.</p>'
          : '<p class="small muted">Sells only come after a buy reaches its target, at that level.</p>');
    }
    const cls = act === 'buy' || (act === 'open' && o.side === 'buy') ? 'buy' : act === 'sell' || act === 'open' ? 'sell' : act === 'watch' ? 'watch' : 'hold';
    return '<section class="card tc-dec ' + cls + '">' +
      '<div class="tc-dec-top"><span class="tc-dec-badge">' + act.toUpperCase() + '</span>' +
        '<div><div class="label">' + a + ' · your method</div><p class="tc-dec-head">' + esc(splitHead(head).rest || head) + '</p></div></div>' +
      body +
      '<p class="muted small">Once per level. Sells only after a buy reached its target. Your own indicator may see what this doesn\'t; it has the last word. Context, not a trade signal.</p>' +
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
      const last = setups.filter(function (s) { return s.level === L && !s.noWin; }).pop();
      const sr = d.decision.sellReady;
      if (sr && sr.level === L && (!last || last.side === 'buy')) return 'Buy target hit: a spike over it is a sell until ' + hhmm(sr.until);
      if (!last) return L <= d.spot ? 'Watching for a dip through' : 'Above the price';
      const buy = last.side === 'buy';
      if (last.used) return 'Used (once per level)';
      if (last.taken && last.trade.result === 'stopped' && (d.decision.locked || []).indexOf(L) >= 0) return (buy ? 'Bought' : 'Sold') + ', stopped: used until price crosses another level';
      if (last.taken) return last.trade.result === 'open' ? (buy ? 'In a buy' : 'In a sell') : (buy ? 'Bought, ' : 'Sold, ') + (last.trade.result === 'target' ? 'target hit' : 'stopped');
      return { waiting: buy ? 'Dipped, waiting for buyers' : 'Spiked, waiting for sellers', broken: 'Broke through (more than ' + CFG.maxDepthPct + '%)',
        lapsed: buy ? 'Dipped, no buyers in ' + CFG.windowHours + ' h' : 'Spiked, no sellers in ' + CFG.windowHours + ' h', signal: 'Signal, no level beyond' }[last.state] || '';
    };
    const rows = d.huge.slice().reverse().map(function (h) {
      return '<tr' + (h.price === (d.decision.nextBuy || d.decision.below) ? ' class="al-near"' : '') + '><td class="num"><b>' + px(h.price) + '</b></td>' +
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
    [dec.below, dec.above, live && live.level, live && isFinite(live.ext) && live.ext * (1 + (live.side === 'buy' ? -1 : 1) * CFG.stopBufferPct / 100), dec.open && dec.open.signal.stop].forEach(function (L) { if (L) { lo = Math.min(lo, L); hi = Math.max(hi, L); } });
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const x = function (t) { return padL + (t - c[0].t) / (c[c.length - 1].t - c[0].t) * (W - padL - padR); };
    const y = function (p) { return H - (p - lo) / (hi - lo) * H; };
    let s = '';
    lv.forEach(function (L) {
      if (L < lo || L > hi) return;
      s += '<line class="al-lv" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(L).toFixed(1) + '" y2="' + y(L).toFixed(1) + '"/>' +
        '<text class="al-lvt" x="' + (W - padR + 4) + '" y="' + (y(L) + 3).toFixed(1) + '">' + Math.round(L).toLocaleString('en-US') + '</text>';
    });
    // Stop loss line with its price: the trade's stop, or while waiting the stop so far.
    const stopAt = dec.open ? dec.open.signal.stop
      : dec.waiting && isFinite(dec.waiting.ext) ? dec.waiting.ext * (1 + (dec.waiting.side === 'buy' ? -1 : 1) * CFG.stopBufferPct / 100) : null;
    if (stopAt) {
      const ys = y(stopAt), ty = ys > 16 ? ys - 4 : ys + 12; // label above the line unless at the very top
      s += '<line class="al-stop" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + ys.toFixed(1) + '" y2="' + ys.toFixed(1) + '"/>' +
        '<text class="al-stopt" text-anchor="end" x="' + (W - padR - 2) + '" y="' + ty.toFixed(1) + '">SL ' + num(stopAt) + (dec.open ? '' : ' so far') + '</text>';
    }
    s += '<polyline class="al-px" points="' + c.map(function (k) { return x(k.t).toFixed(1) + ',' + y(k.c).toFixed(1); }).join(' ') + '"/>';
    d.decision.setups.forEach(function (st) {
      if (st === live && st.extT && st.extT >= from && isFinite(st.ext)) s += '<circle class="al-low" cx="' + x(st.extT).toFixed(1) + '" cy="' + y(st.ext).toFixed(1) + '" r="3.5"/>';
      if (st.taken && st.signal.t >= from) s += st.side === 'buy'
        ? '<path class="al-buy" d="M' + x(st.signal.t).toFixed(1) + ',' + (y(st.signal.entry) + 12).toFixed(1) + ' l-5,8 h10 z"/>'
        : '<path class="al-sell" d="M' + x(st.signal.t).toFixed(1) + ',' + (y(st.signal.entry) - 12).toFixed(1) + ' l-5,-8 h10 z"/>';
    });
    return '<section class="card"><h3>' + (live ? (live.side === 'sell' ? 'Since the spike' : 'Since the dip') : 'Last ' + CFG.chartHours + ' hours') + '</h3>' +
      '<div class="legend small"><span><i class="ln al-lvl"></i>Huge level</span><span><i class="dot al-lowdot"></i>Low / high of the dip</span><span><i class="al-tri"></i>Buy</span><span><i class="al-tri dn"></i>Sell</span></div>' +
      '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Price and the huge levels, last ' + CFG.chartHours + ' hours">' + s + '</svg></div></section>';
  }

  function backtestHtml() {
    const b = CFG.backtest;
    return '<section class="card"><h3>How it did on past data</h3>' +
      '<p class="small"><b>Buys</b>, ETH, ' + b.from + ' to now, these exact rules (huge levels, ' + CFG.candleMinutes + '-minute Ichimoku, stop ' + slWhere(true) + ', dips up to ' + CFG.maxDepthPct + '%, target the biggest huge level above, once per level, 0.1% costs):</p>' +
      '<dl class="pb-dl"><dt>Trades</dt><dd>' + b.trades + ' (about 14 a year)</dd>' +
      '<dt>Reached target</dt><dd>' + b.hitPct + '%</dd>' +
      '<dt>Average</dt><dd><b>+' + b.avgR.toFixed(2) + 'R</b> per trade <span class="muted">(R = the stop distance)</span></dd>' +
      '<dt>By year</dt><dd>' + esc(b.years) + '</dd>' +
      '<dt>Worst run</dt><dd>' + b.worstRun + ' losses in a row</dd></dl>' +
      '<p class="small al-warn"><b>The catch:</b> two trades (' + esc(b.best2) + ') made ' + (b.without2 < 0 ? 'all' : 'most') + ' of it. The other ' + (b.trades - 2) + ' buys averaged ' +
        (b.without2 >= 0 ? '+' : '−') + Math.abs(b.without2).toFixed(1) + 'R each. ' + esc(b.before) + '</p>' +
      '<p class="small"><b>Sells</b> (only at the level a buy just reached as its target): ' + b.sell.trades + ' trades in 3 years, ' + b.sell.won +
        ' reached target. Too few to judge; the buys carry the method.</p>' +
      '<details class="tc-fold"><summary class="small"><b>The rules and the catch</b></summary><ol class="tc-steps small">' +
        '<li>Levels: only the huge strikes, at least ' + Math.round(CFG.hugeShare * 100) + '% of the biggest open interest.</li>' +
        '<li>Price was above a level and trades below it (spikes count).</li>' +
        '<li>Stop: ' + (CFG.stopBufferPct > 0 ? CFG.stopBufferPct + '% under the lowest price since the dip, so a quick wick just under the low doesn\'t stop you out' : 'the lowest price since the dip') + '. More than ' + CFG.maxDepthPct + '% under the level is a real breakdown: no trade.</li>' +
        '<li>Buy when the ' + CFG.candleMinutes + '-minute Ichimoku score crosses up through ' + CFG.scoreBuy + ' (stand-in for your indicator).</li>' +
        '<li>Target: the biggest huge level above (most open contracts), not just the nearest. One trade per level; a used level comes back after price crosses another one.</li>' +
        '<li>Sells only after a buy reached its target, at that level, within ' + CFG.afterWinHours + ' h: a spike over it, stop ' + slWhere(false) + ', score down through ' + CFG.scoreSell +
          ', target the biggest huge level below. When a sell reaches its target, that level is open for a buy again.</li>' +
        '<li>The catch: few trades, and the 10 best make most of the profit. Levels came from monthly snapshots, so yours may differ. Stops can fill worse in fast markets.</li>' +
      '</ol></details></section>';
  }

  refresh();
  const timer = setInterval(function () { if (!el.closest('.pane[hidden]')) refresh(); }, CFG.refreshSeconds * 1000);
  return function () { clearInterval(timer); };
}
