// Market Maker tab: are option dealers being paid enough for the moves they hedge?
// Step 1: implied vs realized volatility with a plain-English reading.
// Step 2: the same in dollars a day, time decay against re-hedging, by expiry group.
// Step 3: vega, what dealers make or lose if implied vol jumps.
// Step 4: one overall verdict at the top, joining all of it with Fragility.
import { MM_CONFIG as CFG } from './config.js';
import { collectMM } from './collect.js';
import { readMM, readOverall, readShock, vegaSide, usd, signedUsd } from './read.js';
import { dailyMove } from './model.js';
import { headHtml, moreHtml } from '../../shared/head.js';
import { load } from '../../shared/storage.js';
import { CONFIG as FRAGILITY } from '../fragility/config.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function day(v) { return '±' + dailyMove(v).toFixed(1) + '%'; }

export function mount(el) {
  const data = {};
  let selected = CFG.assets[0];
  let loading = false;

  el.innerHTML =
    '<div class="row between">' +
      '<div class="seg" id="mm-assets"></div>' +
      '<button class="btn" id="mm-refresh" type="button">Refresh</button>' +
    '</div>' +
    '<div id="mm-body"><section class="card"><p class="muted">Loading…</p></section></div>';

  const assetsEl = el.querySelector('#mm-assets');
  const bodyEl = el.querySelector('#mm-body');
  const refreshBtn = el.querySelector('#mm-refresh');

  assetsEl.addEventListener('click', function (e) {
    const b = e.target.closest('button[data-asset]');
    if (!b) return;
    selected = b.getAttribute('data-asset');
    render();
    if (stale()) refresh();
  });
  refreshBtn.addEventListener('click', refresh);

  function stale() {
    const d = data[selected];
    return !d || Date.now() - d.fetched > 60e3;
  }

  function render() {
    assetsEl.innerHTML = CFG.assets.map(function (a) {
      return '<button type="button" data-asset="' + a + '" class="' + (a === selected ? 'on' : '') + '">' + a + '</button>';
    }).join('');
    const d = data[selected];
    if (!d) return;
    if (d.error) {
      bodyEl.innerHTML = '<section class="card"><p>Could not load: ' + esc(d.error) + '</p></section>';
      return;
    }
    bodyEl.innerHTML = readingHtml(d) + flipHtml(d) + dollarsHtml(d) + vegaHtml(d) + chartHtml(d) + notesHtml();
    drawChart(bodyEl.querySelector('.chart'), d);
  }

  function readingHtml(d) {
    const r = readMM(d, d.gamma, d.asset, CFG, FRAGILITY.gamma.neutralRatio);
    const o = readOverall(d, d.gamma, d.fragility, CFG, FRAGILITY.gamma.neutralRatio);
    const fr = d.fragility;
    const pill = fr ? '<a href="#fragility" class="plain"><span class="pill ' + fr.zone.toLowerCase() + '">' + fr.score.toFixed(0) + ' ' + fr.zone + '</span></a> ' : '';
    return '<section class="card verdict ' + o.level + '">' +
      '<div class="label">' + esc(d.asset) + ' market makers</div>' +
      '<p class="small verdict-urgency">' + pill + '<b class="o-' + o.level + '">Overall: ' + esc(o.name.toLowerCase()) + '.</b> ' + esc(o.reason) + '</p>' +
      headHtml(r.headline) +
      '<p class="verdict-action"><b>What it means:</b> ' + esc(r.action) + '</p>' +
      moreHtml('<ul class="verdict-lines small">' + r.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>', r.lines.length) +
      '<p class="muted small">Worked out automatically from Deribit options, Gate prices and the Fragility score. Context, not a trade signal.</p>' +
    '</section>';
  }

  // The flip: the hour dealers turn losing, trade the way of the last 24h (flip.js).
  function flipHtml(d) {
    const st = d.flip, f = CFG.flip, a = esc(d.asset);
    if (!st) return '';
    const r = st.now, o = st.open, b = f.backtest;
    const px = function (v) { return '~' + Math.round(v).toLocaleString('en-US'); };
    const num = function (v) { return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
    const when = function (t) { return new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
    const pc = function (v) { return (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + '%'; };
    const sideWord = { win: 'winning', even: 'balanced', lose: 'losing' };
    const size = function (entry, stop) {
      const account = +load('playbook.account', 10000), riskPct = +load('playbook.riskPct', 1);
      const risk = account * riskPct / 100, amt = risk / Math.abs(entry - stop);
      return 'risking $' + Math.round(risk).toLocaleString('en-US') + ' (' + riskPct + '% of $' + Math.round(account).toLocaleString('en-US') + '): about <b class="num">' +
        amt.toFixed(amt >= 10 ? 1 : 2) + ' ' + a + '</b> <span class="muted">(set on the Plan tab)</span>';
    };
    const m = o ? o.move : r.m, ref = o ? o.entry : r.price;
    const rules = '<div class="mm-rules"><div class="label">Market Maker strategy: the rules, exactly as backtested</div><ol class="small">' +
      '<li><b>Signal:</b> dealers turn losing. Every hour, at the close: the last 7 days\' average implied vol (DVOL) minus how much ' + a +
        ' really moved over those 7 days. At −' + CFG.gapPts + ' points or lower they are losing; they stay losing until it is back above −' + (CFG.gapPts - CFG.flipBufferPts) + '.</li>' +
      '<li><b>Direction:</b> ' + a + ' up over the last 24 hours = BUY, down = SELL.</li>' +
      '<li><b>Entry:</b> the price at the close of that hour.</li>' +
      '<li><b>Stop:</b> ½ of a day\'s expected move from the entry <span class="muted">(day\'s move = implied vol ÷ √365; ' + (o ? 'this trade' : 'now') + ' ±' + (m * 100).toFixed(1) + '%, so ' +
        (f.stopMoves * m * 100).toFixed(1) + '% ≈ ' + Math.round(f.stopMoves * m * ref) + ' points)</span>.</li>' +
      '<li><b>Target:</b> 2 day\'s moves from the entry, 4× the risk <span class="muted">(' + (f.targetMoves * m * 100).toFixed(1) + '% ≈ ' + Math.round(f.targetMoves * m * ref) + ' points)</span>.</li>' +
      '<li><b>Exit:</b> stop or target, whichever is hit first on 5-minute candles; if one candle touches both, it counts as stopped. Neither after 3 days: out at the price then.</li>' +
      '<li><b>One at a time:</b> no new trade while one is open, and only the turn counts: no second trade while dealers stay losing.</li></ol>' +
      '<p class="small muted">The tab runs the same code as the backtest. Only the prices differ: Gate here, Deribit in the test (browsers can\'t read Deribit\'s history), so a level can be a few points off.</p></div>';
    let act, head, body;
    if (o) {
      const fresh = d.fetched - o.t <= f.freshHours * 36e5, buy = o.buy, dist = Math.abs(o.entry - o.stop);
      act = fresh ? (buy ? 'buy' : 'sell') : 'open';
      head = fresh ? (buy ? 'Buy' : 'Sell') + ': dealers just turned losing, ' + a + ' went ' + (buy ? 'up ' : 'down ') + pc(o.ret24).replace(/^[+−]/, '') + ' in 24h'
        : 'Open: the ' + (buy ? 'buy' : 'sell') + ' from the Market Maker strategy is still running';
      body = '<div class="al-sl"><div class="label">Your stop loss</div><div class="al-sl-num num">' + num(o.stop) + '</div>' +
          '<div class="small">½ of a day\'s move ' + (buy ? 'under' : 'over') + ' the entry · ' + num(dist) + ' points (' + (dist / o.entry * 100).toFixed(1) + '%)</div>' +
          '<div class="small muted">From Gate prices; your chart can differ by a few points.</div></div>' +
        '<dl class="pb-dl">' +
        '<dt>' + (buy ? 'Bought' : 'Sold') + ' at</dt><dd><b class="num">' + num(o.entry) + '</b> <span class="muted">(' + when(o.t) + ', price now ' + num(d.price) + ')</span></dd>' +
        '<dt>Target</dt><dd><b class="num">' + num(o.target) + '</b> <span class="muted">2 day\'s moves ' + (buy ? 'up' : 'down') + ' (' + (Math.abs(o.target - o.entry) / o.entry * 100).toFixed(1) + '%), 4× the risk</span></dd>' +
        '<dt>Ends</dt><dd>' + when(o.t + f.maxHours * 36e5) + ' <span class="muted">(out at the price then, if neither is hit)</span></dd>' +
        '<dt>Size</dt><dd>' + size(o.entry, o.stop) + '</dd></dl>' +
        (fresh ? '' : '<p class="small">Signal from ' + when(o.t) + '. Entering now instead means a different risk; the stop and target stay where they are.</p>') +
        '<p class="verdict-action"><b>What it means:</b> ' + a + ' has started moving more than options priced, so dealers are losing and their hedging tends to push the move further. ' +
          'The trade goes with the last day\'s direction. If price goes ' + (buy ? 'back under ' : 'back over ') + num(o.stop) + ' the move has failed.</p>';
    } else {
      act = 'wait';
      const L = st.last, buy = r.ret24 >= 0, stopPts = f.stopMoves * r.m * r.price, tgtPts = f.targetMoves * r.m * r.price;
      head = r.side === 'lose' ? 'Wait: dealers are already losing, the signal has fired' : 'Wait: no signal, dealers are ' + sideWord[r.side];
      const lastTxt = L ? (L.buy ? 'BUY' : 'SELL') + ' at ' + px(L.entry) + ' on ' + when(L.t) + ': ' +
          (L.trade.result === 'target' ? 'reached the target' : L.trade.result === 'stopped' ? 'stopped' : 'closed after 3 days') + ' (' +
          pc(((L.buy ? 1 : -1) * (L.trade.exit - L.entry)) / L.entry) + ')' : 'none in the last 30 days';
      body = '<dl class="pb-dl">' +
        '<dt>Gap now</dt><dd><b class="num">' + (r.gap >= 0 ? '+' : '−') + Math.abs(r.gap).toFixed(1) + ' points</b> <span class="muted">(dealers ' + sideWord[r.side] + '; the signal is at −' + CFG.gapPts + ')</span></dd>' +
        (r.side === 'lose' ? '' : '<dt>If it fired now</dt><dd>a <b>' + (buy ? 'BUY' : 'SELL') + '</b> <span class="muted">(' + a + ' ' + pc(r.ret24) + ' in 24h), stop ≈ ' + Math.round(stopPts) + ' points, target ≈ ' + Math.round(tgtPts) + ' points</span></dd>') +
        '<dt>Last signal</dt><dd>' + lastTxt + '</dd></dl>' +
        '<p class="verdict-action"><b>What it means:</b> ' + (r.side === 'lose'
          ? 'dealers have been losing since ' + when(st.losingSince) + '. The signal only fires on the turn, so the next one comes after they stop losing and turn losing again.'
          : 'nothing to do. The next signal comes when ' + a + ' starts moving more than options priced, after a calmer stretch.' + (a === 'ETH' ? ' Your phone rings 2 times when it fires, with the stop loss and take profit.' : '')) + '</p>';
    }
    const cls = act === 'buy' || (act === 'open' && o.buy) ? 'buy' : act === 'sell' || act === 'open' ? 'sell' : 'hold';
    return '<section class="card tc-dec ' + cls + '">' +
      '<div class="tc-dec-top"><span class="tc-dec-badge">' + act.toUpperCase() + '</span>' +
        '<div><div class="label">' + a + ' · Market Maker strategy</div><p class="tc-dec-head">' + esc(head.slice(head.indexOf(': ') + 2)) + '</p></div></div>' +
      body + rules +
      '<p class="small"><b>Market Maker strategy backtest, ETH ' + b.from + ' to now</b>' + ' (the one compared with Alt Tactics' + (d.asset === 'ETH' ? '' : ', tested on ETH only') + '; buys and sells together, 0.1% costs): ' + b.trades + ' trades, ' + b.winPct + '% won, ' +
        '+' + b.avgPct.toFixed(1) + '% a trade (wins +' + b.avgWin + '%, losses −' + Math.abs(b.avgLoss) + '%), +' + b.compounded + '% compounded, worst drop ' + b.maxDD + '%, ' +
        'worst losing run ' + b.worstRun + ', profitable in ' + b.quarters + ' quarters (' + b.years + '). ' + b.trades + ' trades is a small sample.</p>' +
      '<p class="muted small">Context, not a trade signal.</p>' +
    '</section>';
  }

  // Three tiles (decay, re-hedging, net) and the split by expiry group. Dealer's side, per day.
  function dollarsHtml(d) {
    const c = d.carry;
    if (!c) return '';
    const t = c.total;
    const tone = function (v) { return v >= 0 ? 'cash-in' : 'cash-out'; };
    const tile = function (label, num, sub, cls) {
      return '<div class="tile"><div class="label">' + label + '</div><div class="tile-num ' + (cls || '') + '">' + num + '</div><div class="muted small">' + sub + '</div></div>';
    };
    const rows = c.groups.filter(function (g) { return g.theta || g.hedge; }).map(function (g) {
      return '<tr><td>' + g.label + '</td><td>' + signedUsd(g.theta) + '</td><td>' + signedUsd(g.hedge) + '</td><td class="' + tone(g.net) + '">' + signedUsd(g.net) + '</td></tr>';
    }).join('');
    return '<section class="card"><h3>' + esc(d.asset) + ' dealers in dollars, per day</h3>' +
      '<div class="tiles">' +
        tile('Time decay', '~' + usd(t.theta), t.theta >= 0 ? 'collected a day' : 'paid a day') +
        tile('Re-hedging', '~' + usd(t.hedge), t.hedge <= 0 ? 'costs a day' : 'earned a day') +
        tile('Net', signedUsd(t.net), t.net >= 0 ? 'dealers make a day' : 'dealers lose a day', tone(t.net)) +
      '</div>' +
      '<table class="stats"><thead><tr><th>Expiry</th><th>Decay</th><th>Re-hedging</th><th>Net</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="muted small">From the dealers\' side: + is money in, − is money out. Re-hedging is priced at last ' + CFG.rvDays + ' days\' pace ' +
        '(' + day(d.rvWeek) + ' a day). Deribit options only; assumes dealers bought the calls and sold the puts customers trade, as for gamma everywhere on this site.</p>' +
    '</section>';
  }

  // What a jump in implied vol does to dealers: +/− the scenario, and the last 24h.
  function vegaHtml(d) {
    const c = d.carry;
    if (!c) return '';
    const pts = CFG.shockPts, up = c.total.vegaW * pts, hit = c.total.vegaW * d.ivChange24h;
    const tone = function (v) { return v >= 0 ? 'cash-in' : 'cash-out'; };
    const tile = function (label, v, sub) {
      return '<div class="tile"><div class="label">' + label + '</div><div class="tile-num ' + tone(v) + '">' + signedUsd(v) + '</div><div class="muted small">' + sub + '</div></div>';
    };
    const rows = c.groups.filter(function (g) { return g.vegaW; }).map(function (g) {
      return '<tr><td>' + g.label + '</td><td>' + signedUsd(g.vegaW) + '</td><td class="' + tone(g.vegaW * pts) + '">' + signedUsd(g.vegaW * pts) + '</td></tr>';
    }).join('');
    return '<section class="card"><h3>' + esc(d.asset) + ' dealers if implied vol jumps</h3>' +
      '<p class="small" style="margin:0 0 10px">' + esc(readShock(c, pts)) + ' ' + esc(vegaSide(c)) + '.</p>' +
      '<div class="tiles">' +
        tile('Vol +' + pts + ' pts', up, up >= 0 ? 'dealers make' : 'dealers lose') +
        tile('Vol −' + pts + ' pts', -up, up >= 0 ? 'dealers lose' : 'dealers make') +
        tile('Last 24h', hit, 'vol ' + (d.ivChange24h >= 0 ? '+' : '−') + Math.abs(d.ivChange24h).toFixed(1) + ' pts') +
      '</div>' +
      '<table class="stats"><thead><tr><th>Expiry</th><th>Per 1 point</th><th>If +' + pts + ' points</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="muted small">Points of 30-day implied vol (DVOL). Short-dated vol jumps more than long-dated, so a week out counts about 2× and the quarterly about ½–¾×. ' +
        'Same dealer assumption as above: they bought the calls and sold the puts customers trade.</p>' +
    '</section>';
  }

  function chartHtml(d) {
    return '<section class="card"><h3>' + esc(d.asset) + ' implied vs realized volatility</h3>' +
      '<div class="legend small">' +
        '<span><span class="ln iv"></span>Implied (what options price in)</span>' +
        '<span><span class="ln rv"></span>Realized (how much it actually moved, last ' + CFG.rvDays + ' days)</span>' +
        '<span><span class="sw" style="background:var(--calm)"></span>Dealers earning</span>' +
        '<span><span class="sw" style="background:var(--primed)"></span>Dealers losing</span>' +
      '</div>' +
      '<div class="chart"></div>' +
      '<p class="muted small">Annualised %. 50% is about ±2.6% a day. Updated ' +
        new Date(d.fetched).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · refreshes every ' + CFG.refreshMinutes + ' min</p>' +
    '</section>';
  }

  function notesHtml() {
    return '<section class="card"><details><summary><b>How this works</b></summary>' +
      '<p class="small">Market makers sell options and hedge the direction away. They collect time decay every day (theta) ' +
      'and lose a little each time they re-hedge a move (gamma). If the coin moves less than the options priced in, the decay wins and they earn; ' +
      'if it moves more, the re-hedging wins and they lose.</p>' +
      '<p class="small">Implied is Deribit\'s DVOL index: the volatility options price in for the next 30 days. ' +
      'Realized is worked out from hourly Gate prices over the last ' + CFG.rvDays + ' days. The reading compares the average implied over that same week ' +
      'with what actually happened. A gap under ' + CFG.gapPts + ' points counts as balanced.</p>' +
      '<p class="small">The dollar figures go option by option through Deribit\'s open interest. Each option\'s time decay comes from its own implied vol, ' +
      'and the re-hedging bill from how much the coin actually moved last week. Both scale with gamma (how fast the hedge has to change), ' +
      'so big expiries and options close to the price dominate. Options expiring within a day only count until they expire.</p>' +
      '<p class="small">Dealers can be short some expiries and long others. If they sold short-dated options and own longer-dated ones, ' +
      'they can collect decay and still earn from re-hedging at the same time; the table shows which expiry is doing what.</p>' +
      '<p class="small">The overall line at the top adds up pressure: dealers losing on the moves or in dollars, their hedging chasing moves, ' +
      'a vol move costing them more than a day of decay, and Fragility leverage building or stretched. Dealers being well paid or hedging against moves counts the other way. ' +
      'Steady, on watch, or unstable, with the main reasons named.</p>' +
      '<p class="small">The Market Maker strategy card: the hour dealers turn losing (the 7-day gap drops below −' + CFG.gapPts + ' points), trade the way the coin went over the last 24 hours. ' +
      'Stop ½ of a day\'s move (today\'s implied vol ÷ √365), target 2 day\'s moves, out at the price after 3 days if neither is hit. One trade at a time. ' +
      'It only fires on the turn, so it stays quiet while dealers keep losing.</p>' +
      '<p class="small">Vega is how much an option\'s price changes when implied vol moves 1 point. Long-dated options have the most of it, ' +
      'so whoever holds the quarterlies gains when fear rises and loses when it eases, even if the price itself doesn\'t move.</p></details></section>';
  }

  function drawChart(box, d) {
    const pts = d.points;
    const W = Math.max(box.clientWidth, 260), H = 200;
    const pad = { l: 30, r: 8, t: 10, b: 22 };
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    let lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) { lo = Math.min(lo, p.iv, p.rv); hi = Math.max(hi, p.iv, p.rv); });
    const step = hi - lo > 40 ? 20 : 10;
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const x = function (t) { return pad.l + (t - t0) / Math.max(t1 - t0, 1) * (W - pad.l - pad.r); };
    const y = function (v) { return pad.t + (hi - v) / (hi - lo) * (H - pad.t - pad.b); };

    let s = '';
    for (let v = lo; v <= hi; v += step) {
      s += '<line class="grid" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="axis" x="' + (pad.l - 4) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + v + '</text>';
    }
    // Gap between the lines, one slice per hour, green when implied is above realized.
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const earn = (a.iv - a.rv) + (b.iv - b.rv) >= 0;
      s += '<polygon class="gap ' + (earn ? 'earn' : 'lose') + '" points="' +
        x(a.t).toFixed(1) + ',' + y(a.iv).toFixed(1) + ' ' + x(b.t).toFixed(1) + ',' + y(b.iv).toFixed(1) + ' ' +
        x(b.t).toFixed(1) + ',' + y(b.rv).toFixed(1) + ' ' + x(a.t).toFixed(1) + ',' + y(a.rv).toFixed(1) + '"/>';
    }
    const path = function (k) { return pts.map(function (p) { return x(p.t).toFixed(1) + ',' + y(p[k]).toFixed(1); }).join(' '); };
    s += '<polyline class="vl rv" points="' + path('rv') + '"/><polyline class="vl iv" points="' + path('iv') + '"/>';
    const fmt = function (t) { return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
    s += '<text class="axis" x="' + pad.l + '" y="' + (H - 6) + '">' + fmt(t0) + '</text>' +
      '<text class="axis" x="' + (W - pad.r) + '" y="' + (H - 6) + '" text-anchor="end">now</text>' +
      '<line class="cross" y1="' + pad.t + '" y2="' + (H - pad.b) + '" visibility="hidden"/>';

    box.innerHTML = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Implied and realized volatility, last ' + CFG.chartDays + ' days">' + s + '</svg><div class="tip"></div>';
    const svg = box.querySelector('svg'), cross = svg.querySelector('.cross'), tip = box.querySelector('.tip');
    function readout(p) {
      const gap = p.iv - p.rv;
      tip.innerHTML = '<span class="muted">' + new Date(p.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' · </span>' +
        'implied <b>' + p.iv.toFixed(0) + '%</b> (' + day(p.iv) + '/day) · realized <b>' + p.rv.toFixed(0) + '%</b> (' + day(p.rv) + '/day) · ' +
        '<span style="color:var(--' + (gap >= 0 ? 'calm' : 'primed') + ')">' + (gap >= 0 ? 'dealers earning' : 'dealers losing') + '</span>';
    }
    function show(e) {
      const px = e.clientX - svg.getBoundingClientRect().left;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round((px - pad.l) / (W - pad.l - pad.r) * (pts.length - 1))));
      cross.setAttribute('x1', x(pts[i].t)); cross.setAttribute('x2', x(pts[i].t)); cross.setAttribute('visibility', 'visible');
      readout(pts[i]);
    }
    function hide() { cross.setAttribute('visibility', 'hidden'); readout(pts[pts.length - 1]); }
    hide();
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Loading…';
    const asset = selected;
    try {
      data[asset] = await collectMM(asset, CFG);
    } catch (e) {
      data[asset] = { error: e.message, fetched: Date.now() };
    } finally {
      loading = false;
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh';
    }
    render();
  }

  // Only refresh while this tab is showing; catch up when it's opened again.
  function visible() { return !el.hidden && document.visibilityState === 'visible'; }
  function onShow() { if (visible() && stale()) refresh(); }
  const timer = setInterval(function () { if (visible()) refresh(); }, CFG.refreshMinutes * 60e3);
  let lastW = 0;
  function onResize() {
    const w = el.clientWidth;
    if (w && w !== lastW && data[selected] && !data[selected].error) { lastW = w; render(); }
  }
  window.addEventListener('hashchange', onShow);
  document.addEventListener('visibilitychange', onShow);
  window.addEventListener('resize', onResize);
  render();
  refresh();

  return function unmount() {
    clearInterval(timer);
    window.removeEventListener('hashchange', onShow);
    document.removeEventListener('visibilitychange', onShow);
    window.removeEventListener('resize', onResize);
  };
}
