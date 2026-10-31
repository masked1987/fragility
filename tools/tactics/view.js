// Tactics tab: the GEX pivot + order-flow exhaustion setup from the owner's video,
// adapted to ETH. Separate from the Playbook. Screens, as in the video:
// reading card + checklist, trade card, interval map (GEX by strike over time),
// depth view (GEX by strike × expiry), net premium drift, footprint + volume profile.
import { TAC_CONFIG as CFG } from './config.js';
import { collectTac } from './collect.js';
import { readTac, checkLines, money } from './read.js';
import { signals } from './model.js';
import { load, save } from '../../shared/storage.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function px(x) { return '~' + Math.round(x).toLocaleString('en-US'); }
function num(x, d) { return x.toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
function hhmm(t) { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }
function kfmt(v) { const a = Math.abs(v); return a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? Math.round(a / 1e3) + '' : a > 0 ? '0' : ''; }
// Prices with the decimals the asset needs (ETH 2,236.5; BTC 77,085).
function pdec(x) { return x < 10000 ? 1 : 0; }

const STATUS = { ready: 'Ready', building: 'Building', waiting: 'Waiting', none: 'No pivot' };
const ICON = { ok: '✓', no: '✕', wait: '…' };

export function mount(el) {
  const data = {};
  let selected = CFG.assets[0];
  let loading = false;
  const open = {};
  const acct = { account: load('playbook.account', 10000), riskPct: load('playbook.riskPct', 1) };

  el.innerHTML =
    '<div class="row between">' +
      '<div class="seg" id="tc-assets"></div>' +
      '<button class="btn" id="tc-refresh" type="button">Refresh</button>' +
    '</div>' +
    '<div id="tc-body"><section class="card"><p class="muted">Loading…</p></section></div>';

  const assetsEl = el.querySelector('#tc-assets');
  const bodyEl = el.querySelector('#tc-body');
  const refreshBtn = el.querySelector('#tc-refresh');

  assetsEl.addEventListener('click', function (e) {
    const b = e.target.closest('button[data-asset]');
    if (!b) return;
    selected = b.getAttribute('data-asset');
    render();
    if (stale()) refresh();
  });
  refreshBtn.addEventListener('click', refresh);
  bodyEl.addEventListener('toggle', function (e) { if (e.target.id) open[e.target.id] = e.target.open; }, true);
  bodyEl.addEventListener('input', function (e) {
    if (e.target.id === 'tc-account') acct.account = +e.target.value;
    else if (e.target.id === 'tc-risk') acct.riskPct = +e.target.value;
    else return;
    save('playbook.account', acct.account);
    save('playbook.riskPct', acct.riskPct);
    const n = bodyEl.querySelector('#tc-size');
    if (n && data[selected] && data[selected].setup) n.innerHTML = sizeText(data[selected].setup);
  });

  function stale() {
    const d = data[selected];
    return !d || Date.now() - d.fetched > 30e3;
  }

  // Interval map history: the gamma nodes, saved on this device while the tab is open.
  function snapshot(d) {
    const key = 'tactics.snaps.' + d.asset;
    let snaps = load(key, []);
    snaps = snaps.filter(function (s) { return d.fetched - s.t < 24 * 36e5; });
    const last = snaps[snaps.length - 1];
    if (!last || d.fetched - last.t >= CFG.snapshotMinutes * 6e4 * 0.9) {
      snaps.push({ t: d.fetched, n: d.nodes.map(function (n) { return [n.strike, Math.round(n.call / 1e3), Math.round(n.put / 1e3)]; }) });
      save(key, snaps);
    }
    return snaps.map(function (s) { return { t: s.t, nodes: s.n.map(function (x) { return { strike: x[0], call: x[1] * 1e3, put: x[2] * 1e3, net: (x[1] + x[2]) * 1e3 }; }) }; });
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
    bodyEl.innerHTML = readingHtml(d) + tradeHtml(d) +
      '<section class="card"><h3>' + esc(d.asset) + ' interval map (GEX)</h3>' +
        '<div class="legend small"><span><span class="sw" style="background:var(--g-pos)"></span>Calls bigger (dealers long gamma)</span>' +
        '<span><span class="sw" style="background:var(--g-neg)"></span>Puts bigger (dealers short gamma)</span>' +
        '<span><span class="ln tc-pv"></span>Pivot</span></div>' +
        '<div class="chart tc-imap"></div>' +
        '<p class="muted small">Bubble size = dealer gamma at that strike ($ of hedging per 1% move). History builds up while this tab is open on this phone; the right edge is always live.</p></section>' +
      depthHtml(d) +
      '<section class="card"><h3>' + esc(d.asset) + ' net drift (premium)</h3>' +
        '<div class="legend small"><span><span class="ln tc-calls"></span>Calls ' + (d.drift ? money(d.drift.calls) : 'n/a') + '</span>' +
        '<span><span class="ln tc-puts"></span>Puts ' + (d.drift ? money(d.drift.puts) : 'n/a') + '</span>' +
        '<span><span class="ln tc-price"></span>' + esc(d.asset) + ' price</span></div>' +
        '<div class="chart tc-drift"></div>' +
        '<p class="muted small">Running total of option premium bought (+) or sold (−) on Deribit since ' + (d.session.young ? 'yesterday 00:00' : '00:00') + ' UTC. ' +
        'Puts above calls = bearish sentiment; calls above puts = bullish.</p></section>' +
      '<section class="card"><h3>' + esc(d.asset) + ' order flow (footprint)</h3>' +
        '<div class="legend small"><span><span class="ln tc-pv"></span>Pivot</span><span><span class="ln tc-va"></span>Value area high / low</span>' +
        '<span><span class="ln tc-poc"></span>Point of control</span></div>' +
        '<div class="tc-fp"></div>' +
        '<p class="muted small">' + CFG.candleMinutes + '-minute candles from Deribit ' + esc(d.asset) + ' perpetual trades. Each row: <b>sold × bought</b> in $k at that price. ' +
        '<b class="tc-red">Red</b> / <b class="tc-green">green</b> numbers are 3:1 imbalances. ▼ = buyers ran out or sellers stepped in; ▲ = the reverse. ' +
        'Orange bars on the right: the session volume profile (Gate).</p></section>' +
      notesHtml(d);
    drawIntervalMap(bodyEl.querySelector('.tc-imap'), d, snapshot(d));
    drawDrift(bodyEl.querySelector('.tc-drift'), d);
    drawFootprint(bodyEl.querySelector('.tc-fp'), d);
  }

  function readingHtml(d) {
    const r = readTac(d, CFG), s = d.setup;
    const lines = s.status === 'none' ? [] : checkLines(d, CFG);
    const sideP = s.side ? '<span class="pill ' + (s.side === 'short' ? 'primed' : 'calm') + '">' + (s.side === 'short' ? 'Short side' : 'Long side') + '</span>' : '';
    return '<section class="card verdict tc-' + r.tone + '">' +
      '<div class="label">' + esc(d.asset) + ' tactic · GEX pivot + exhaustion</div>' +
      '<p class="small verdict-urgency"><span class="pill tc-st-' + s.status + '">' + STATUS[s.status] + '</span> ' + sideP + '</p>' +
      '<p class="verdict-head">' + esc(r.headline) + '</p>' +
      (lines.length ? '<ul class="tc-checks small">' + lines.map(function (l) {
        return '<li class="' + l.state + '"><span class="tc-ic">' + ICON[l.state] + '</span><span><b>' + esc(l.name) + '.</b> ' + esc(l.text) + '</span></li>';
      }).join('') + '</ul>' : '') +
      '<p class="verdict-action"><b>What it means:</b> ' + esc(r.action) + '</p>' +
      '<p class="muted small">Worked out automatically from Deribit options and trades and Gate prices' +
        (d.missing.length ? ' (unavailable right now: ' + esc(d.missing.join(', ')) + ')' : '') + '. Context, not a trade signal.</p>' +
    '</section>';
  }

  function sizeText(s) {
    if (!(acct.account > 0 && acct.riskPct > 0 && s.risk > 0)) return '<span class="muted">Fill in your account below.</span>';
    const dollars = acct.account * acct.riskPct / 100, coins = dollars / s.risk;
    return '<b class="num">' + coins.toFixed(coins < 1 ? 3 : 2) + ' ' + esc(selected) + '</b> <span class="muted">(risking $' + num(dollars) + ')</span>';
  }

  function tradeHtml(d) {
    const s = d.setup;
    if (s.status === 'none') return '';
    const short = s.side === 'short', dp = pdec(d.spot);
    const tg = s.targets.length ? s.targets.map(function (t) {
      return '<li><b class="num">' + px(t.price) + '</b> <span class="muted">' + t.r.toFixed(1) + 'R</span><br><span class="small">' + esc(t.why.charAt(0).toUpperCase() + t.why.slice(1)) + '</span></li>';
    }).join('') : '<li class="muted">Nothing mapped at least 1R away.</li>';
    const title = s.status === 'ready' ? (short ? 'Short now' : 'Long now') : (short ? 'Short if the retest is rejected' : 'Long if the retest holds');
    return '<section class="card pb-plan ' + (short ? 'down' : 'up') + (s.status === 'ready' ? ' pref' : '') + '">' +
      '<div class="pb-top"><h3>' + esc(title) + '</h3><div class="pb-chips"><span class="chip' + (s.status === 'ready' ? ' pref' : '') + '">' + STATUS[s.status] + '</span>' +
      '<span class="pill ' + (short ? 'primed' : 'calm') + '">' + (short ? 'Short' : 'Long') + '</span></div></div>' +
      '<dl class="pb-dl">' +
        '<dt>Pivot</dt><dd>' + px(s.pivot) + ' <span class="muted">(dealer gamma ' + money(d.pivot.net) + ' per 1%)</span></dd>' +
        '<dt>Entry</dt><dd><b class="num">' + num(s.entry, dp) + '</b> <span class="muted">' + (s.atLevel ? '(price now)' : '(at the retest)') + '</span></dd>' +
        '<dt>Stop</dt><dd><b class="num">' + num(s.stop, dp) + '</b> <span class="muted">(' + num(s.risk, dp) + ' points, just ' + (short ? 'above' : 'below') + ' the retest)</span></dd>' +
        '<dt>Targets</dt><dd><ul class="pb-tg">' + tg + '</ul></dd>' +
        '<dt>Size</dt><dd id="tc-size">' + sizeText(s) + '</dd>' +
      '</dl>' +
      '<p class="small muted">Out if a ' + CFG.candleMinutes + '-minute candle closes back ' + (short ? 'above' : 'below') + ' the pivot. After the first target, move the stop to the entry.</p>' +
      '<details id="tc-acct"' + (open['tc-acct'] ? ' open' : '') + '><summary class="small">Account for the size</summary><div class="pb-calc">' +
        '<label for="tc-account">Account ($)<input id="tc-account" type="number" inputmode="decimal" min="0" value="' + acct.account + '"></label>' +
        '<label for="tc-risk">Risk per trade (%)<input id="tc-risk" type="number" inputmode="decimal" min="0" step="0.1" value="' + acct.riskPct + '"></label>' +
      '</div><p class="muted small">Shared with the Playbook tab, saved on this phone only.</p></details>' +
    '</section>';
  }

  // Depth view: net dealer gamma by strike (rows) and expiry (columns), $M per 1% move.
  function depthHtml(d) {
    const g = d.grid;
    if (!g.expiries.length) return '';
    let max = 0;
    g.strikes.forEach(function (s) { g.expiries.forEach(function (e) { max = Math.max(max, Math.abs(g.at(s, e))); }); });
    const nearest = g.strikes.reduce(function (a, b) { return Math.abs(b - d.spot) < Math.abs(a - d.spot) ? b : a; });
    const head = '<tr><th>Strike</th>' + g.expiries.map(function (e) { return '<th>' + new Date(e).toLocaleDateString([], { month: 'short', day: 'numeric' }) + '</th>'; }).join('') + '</tr>';
    const rows = g.strikes.map(function (s) {
      const cls = (s === nearest ? ' class="tc-spot"' : '') + (d.pivot && s === d.pivot.strike ? ' data-pivot="1"' : '');
      return '<tr' + cls + '><td class="tc-k">' + num(s) + (d.pivot && s === d.pivot.strike ? ' <span class="tc-pvtag">pivot</span>' : '') + (s === nearest ? ' <span class="muted">◀</span>' : '') + '</td>' +
        g.expiries.map(function (e) {
          const v = g.at(s, e), a = max ? Math.round(Math.min(1, Math.abs(v) / max) * 70) : 0;
          return '<td style="background:color-mix(in srgb, var(' + (v >= 0 ? '--g-pos' : '--g-neg') + ') ' + a + '%, transparent)">' + (Math.abs(v) >= 5e4 ? (v / 1e6).toFixed(1) : '') + '</td>';
        }).join('') + '</tr>';
    }).join('');
    return '<section class="card"><h3>' + esc(d.asset) + ' depth view (GEX by strike × expiry)</h3>' +
      '<div class="tc-scroll"><table class="tc-heat">' + head + rows + '</table></div>' +
      '<p class="muted small">$M of dealer hedging per 1% move, nearest ' + g.expiries.length + ' expiries. Blue: dealers long gamma (they calm moves); pink: short gamma (they add to moves). ◀ marks the price.</p></section>';
  }

  function notesHtml(d) {
    return '<section class="card"><details id="tc-how"' + (open['tc-how'] ? ' open' : '') + '><summary><b>How this tactic works</b></summary>' +
      '<p class="small">From the 10/14 QQQ trade in your video ("740 QQQ GEX + buyers exhaustion = 4.75R"), adapted to ' + esc(d.asset) + ', which trades around the clock:</p>' +
      '<ol class="small tc-steps">' +
        '<li><b>Plan the pivot.</b> The biggest dealer gamma strike within ±' + CFG.pivotRangePct + '% of the price (interval map, depth view). In the video: 740 on QQQ.</li>' +
        '<li><b>Wait for the retest.</b> Price comes back to the pivot (within ' + CFG.levelTolPct + '%) in the last ' + CFG.retestCandles * CFG.candleMinutes + ' minutes. Below the pivot it is resistance (short side); above it, support (long side).</li>' +
        '<li><b>Value area.</b> The pivot lines up with the session value area high (short) or low (long), within ' + CFG.alignPct + '%. The session is the UTC day' +
          ' (yesterday\'s until ' + CFG.sessionMinHours + 'h in), in place of US regular hours.</li>' +
        '<li><b>Premium.</b> Net option premium leans the same way: put-heavy for a short, call-heavy for a long.</li>' +
        '<li><b>Order flow, the trigger.</b> At the retest, buyers run out at the high (almost no buying on the top row) or sellers step in (sell imbalances on 2+ upper rows, or clearly negative delta). Mirror image for a long.</li>' +
        '<li><b>Dealer gamma.</b> Price on the side of the gamma flip where dealer hedging adds to the move.</li>' +
      '</ol>' +
      '<p class="small"><b>Ready</b> = the retest, the order-flow trigger, and at least 2 of the other 3. Stop just past the retest extreme (+' + CFG.stopBufferPct + '%); ' +
        'targets are the point of control, the far edge of the value area and the next big gamma nodes, at least 1R away. Tight stops are why the video\'s trade paid 4.75R.</p>' +
      '<p class="small">Differences from the video: no 3D gamma surface (the depth view shows the same numbers); the interval map only has history from while this tab was open; ' +
        'order flow is one venue (Deribit perpetual), the volume profile is Gate, premium is Deribit options. Nothing here is backtested.</p>' +
    '</details></section>';
  }

  // ---- Charts ----

  function svgWrap(box, W, H, s, label) {
    box.innerHTML = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(label) + '">' + s + '</svg><div class="tip"></div>';
    return { svg: box.querySelector('svg'), tip: box.querySelector('.tip') };
  }

  function drawIntervalMap(box, d, snaps) {
    const W = Math.max(box.clientWidth, 280), H = 240, pad = { l: 6, r: 50, t: 10, b: 20 };
    const t1 = d.fetched, t0 = t1 - 8 * 36e5;
    const prices = resample(d.minutes.filter(function (c) { return c.t >= t0; }), 5 * 6e4);
    const pv = d.pivot ? d.pivot.strike : null;
    let lo = Math.min.apply(null, prices.map(function (p) { return p.c; }).concat([d.spot]));
    let hi = Math.max.apply(null, prices.map(function (p) { return p.c; }).concat([d.spot]));
    if (pv) { lo = Math.min(lo, pv); hi = Math.max(hi, pv); }
    const padP = Math.max((hi - lo) * 0.25, d.spot * 0.004);
    lo -= padP; hi += padP;
    const x = function (t) { return pad.l + (t - t0) / (t1 - t0) * (W - pad.l - pad.r); };
    const y = function (v) { return pad.t + (hi - v) / (hi - lo) * (H - pad.t - pad.b); };
    const inView = function (n) { return n.strike >= lo && n.strike <= hi; };
    const cols = snaps.filter(function (s) { return s.t >= t0; });
    const step = Math.max(1, Math.ceil(cols.length / 48));
    const shown = cols.filter(function (s, i) { return i % step === 0; });
    shown.push({ t: t1, nodes: d.nodes, live: true });
    let max = 0;
    shown.forEach(function (s) { s.nodes.forEach(function (n) { if (inView(n)) max = Math.max(max, Math.abs(n.net)); }); });

    let s = '';
    let lastY = -99;
    d.nodes.filter(inView).sort(function (a, b) { return b.strike - a.strike; }).forEach(function (n) {
      const yy = y(n.strike);
      s += '<line class="tc-row" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '"/>';
      if (yy - lastY >= 11 && Math.abs(yy - y(d.spot)) >= 10) { s += '<text class="axis" x="' + (W - pad.r + 10) + '" y="' + (yy + 3).toFixed(1) + '">' + num(n.strike) + '</text>'; lastY = yy; }
    });
    shown.forEach(function (c) {
      c.nodes.filter(inView).forEach(function (n) {
        if (!max || !n.net) return;
        const r = 1.2 + 5.5 * Math.sqrt(Math.abs(n.net) / max);
        s += '<circle class="tc-b ' + (n.net >= 0 ? 'pos' : 'neg') + (c.live ? ' live' : '') + '" cx="' + x(c.t).toFixed(1) + '" cy="' + y(n.strike).toFixed(1) + '" r="' + r.toFixed(1) + '"/>';
      });
    });
    if (pv) {
      s += '<rect class="tc-pvband" x="' + pad.l + '" width="' + (W - pad.l - pad.r) + '" y="' + (y(pv * (1 + CFG.levelTolPct / 100))).toFixed(1) + '" height="' + (y(pv * (1 - CFG.levelTolPct / 100)) - y(pv * (1 + CFG.levelTolPct / 100))).toFixed(1) + '"/>' +
        '<line class="tc-pvl" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y(pv).toFixed(1) + '" y2="' + y(pv).toFixed(1) + '"/>' +
        '<text class="tc-pvt" x="' + (W - pad.r - 4) + '" y="' + (y(pv) - 4).toFixed(1) + '" text-anchor="end">PIVOT ' + num(pv) + '</text>';
    }
    if (prices.length > 1) s += '<polyline class="tc-px" points="' + prices.map(function (p) { return x(p.t).toFixed(1) + ',' + y(p.c).toFixed(1); }).join(' ') + '"/>';
    s += '<rect class="tc-now" x="' + (W - pad.r + 1) + '" y="' + (y(d.spot) - 7).toFixed(1) + '" width="' + (pad.r - 2) + '" height="14" rx="3"/>' +
      '<text class="tc-nowt" x="' + (W - pad.r + 4) + '" y="' + (y(d.spot) + 3.5).toFixed(1) + '">' + num(d.spot, pdec(d.spot)) + '</text>';
    s += '<text class="axis" x="' + pad.l + '" y="' + (H - 5) + '">' + hhmm(t0) + '</text><text class="axis" x="' + (W - pad.r) + '" y="' + (H - 5) + '" text-anchor="end">now</text>' +
      '<line class="cross" y1="' + pad.t + '" y2="' + (H - pad.b) + '" visibility="hidden"/>';

    const g = svgWrap(box, W, H, s, 'Price with dealer gamma by strike over the last 8 hours');
    const cross = g.svg.querySelector('.cross');
    function readout(t) {
      const p = prices.length ? prices.reduce(function (a, b) { return Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a; }) : { c: d.spot, t: t1 };
      const col = shown.reduce(function (a, b) { return Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a; });
      const node = pv ? col.nodes.find(function (n) { return n.strike === pv; }) : null;
      g.tip.innerHTML = '<span class="muted">' + hhmm(p.t) + ' · </span>' + esc(d.asset) + ' <b>' + num(p.c, pdec(p.c)) + '</b>' +
        (node ? ' · pivot ' + num(pv) + ': calls <span class="tc-green">' + money(node.call) + '</span>, puts <span class="tc-red">' + money(node.put) + '</span>, net <b>' + money(node.net) + '</b>' : '');
    }
    function show(e) {
      const r = g.svg.getBoundingClientRect(), xx = Math.max(pad.l, Math.min(W - pad.r, e.clientX - r.left));
      cross.setAttribute('x1', xx); cross.setAttribute('x2', xx); cross.setAttribute('visibility', 'visible');
      readout(t0 + (xx - pad.l) / (W - pad.l - pad.r) * (t1 - t0));
    }
    function hide() { cross.setAttribute('visibility', 'hidden'); readout(t1); }
    hide();
    g.svg.addEventListener('pointermove', show); g.svg.addEventListener('pointerdown', show); g.svg.addEventListener('pointerleave', hide);
  }

  function drawDrift(box, d) {
    if (!d.drift || d.drift.series.length < 2) { box.innerHTML = '<p class="muted small">Not enough option trades yet.</p>'; return; }
    const W = Math.max(box.clientWidth, 280), H = 190, pad = { l: 44, r: 8, t: 10, b: 20 };
    const ser = d.drift.series, t0 = ser[0].t, t1 = ser[ser.length - 1].t;
    let lo = 0, hi = 0;
    ser.forEach(function (p) { lo = Math.min(lo, p.calls, p.puts); hi = Math.max(hi, p.calls, p.puts); });
    const span = hi - lo || 1; lo -= span * 0.08; hi += span * 0.08;
    const x = function (t) { return pad.l + (t - t0) / Math.max(t1 - t0, 1) * (W - pad.l - pad.r); };
    const y = function (v) { return pad.t + (hi - v) / (hi - lo) * (H - pad.t - pad.b); };
    const prices = resample(d.minutes.filter(function (c) { return c.t >= t0; }), 5 * 6e4);
    const plo = Math.min.apply(null, prices.map(function (p) { return p.c; })), phi = Math.max.apply(null, prices.map(function (p) { return p.c; }));
    const py = function (v) { return pad.t + (phi - v) / ((phi - plo) || 1) * (H - pad.t - pad.b); };
    let s = '<line class="grid" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"/>' +
      '<text class="axis" x="' + (pad.l - 4) + '" y="' + (y(0) + 3).toFixed(1) + '" text-anchor="end">$0</text>' +
      '<text class="axis" x="' + (pad.l - 4) + '" y="' + (pad.t + 8) + '" text-anchor="end">' + money(hi) + '</text>' +
      '<text class="axis" x="' + (pad.l - 4) + '" y="' + (H - pad.b) + '" text-anchor="end">' + money(lo) + '</text>';
    if (prices.length > 1) s += '<polyline class="tc-dpx" points="' + prices.map(function (p) { return x(p.t).toFixed(1) + ',' + py(p.c).toFixed(1); }).join(' ') + '"/>';
    const path = function (k) { return ser.map(function (p) { return x(p.t).toFixed(1) + ',' + y(p[k]).toFixed(1); }).join(' '); };
    s += '<polyline class="tc-dc" points="' + path('calls') + '"/><polyline class="tc-dp" points="' + path('puts') + '"/>' +
      '<text class="axis" x="' + pad.l + '" y="' + (H - 5) + '">' + hhmm(t0) + '</text><text class="axis" x="' + (W - pad.r) + '" y="' + (H - 5) + '" text-anchor="end">now</text>' +
      '<line class="cross" y1="' + pad.t + '" y2="' + (H - pad.b) + '" visibility="hidden"/>';
    const g = svgWrap(box, W, H, s, 'Net call and put premium through the session');
    const cross = g.svg.querySelector('.cross');
    function readout(p) {
      const pr = prices.length ? prices.reduce(function (a, b) { return Math.abs(b.t - p.t) < Math.abs(a.t - p.t) ? b : a; }) : null;
      g.tip.innerHTML = '<span class="muted">' + hhmm(p.t) + ' · </span>calls <b class="tc-green">' + money(p.calls) + '</b> · puts <b class="tc-red">' + money(p.puts) + '</b> · difference <b>' + money(p.calls - p.puts) + '</b>' +
        (pr ? ' · ' + esc(d.asset) + ' ' + num(pr.c, pdec(pr.c)) : '');
    }
    function show(e) {
      const r = g.svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(ser.length - 1, Math.round((e.clientX - r.left - pad.l) / (W - pad.l - pad.r) * (ser.length - 1))));
      cross.setAttribute('x1', x(ser[i].t)); cross.setAttribute('x2', x(ser[i].t)); cross.setAttribute('visibility', 'visible');
      readout(ser[i]);
    }
    function hide() { cross.setAttribute('visibility', 'hidden'); readout(ser[ser.length - 1]); }
    hide();
    g.svg.addEventListener('pointermove', show); g.svg.addEventListener('pointerdown', show); g.svg.addEventListener('pointerleave', hide);
  }

  function drawFootprint(box, d) {
    const cs = d.candles.slice(-CFG.footprintCandles);
    if (!cs.length) { box.innerHTML = '<p class="muted small">No perpetual trades in the last hours.</p>'; return; }
    const W = Math.max(box.clientWidth, 280), axisW = 46, profW = 40, H = 340, pad = { t: 14, b: 34 };
    const plotW = W - axisW - profW, cw = plotW / cs.length, rs = d.rowSize;
    let lo = Math.min.apply(null, cs.map(function (c) { return c.l; })), hi = Math.max.apply(null, cs.map(function (c) { return c.h; }));
    const extra = [d.pivot && d.pivot.strike, d.profile && d.profile.vah, d.profile && d.profile.val, d.profile && d.profile.poc].filter(function (v) { return v; });
    const reach = Math.max(hi - lo, rs * 8) * 0.5;
    extra.forEach(function (v) { if (v > lo - reach && v < hi + reach) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    lo = Math.floor(lo / rs) * rs - rs; hi = Math.ceil(hi / rs) * rs + rs;
    const rows = Math.round((hi - lo) / rs), rh = (H - pad.t - pad.b) / rows;
    const y = function (v) { return pad.t + (hi - v) / (hi - lo) * (H - pad.t - pad.b); };
    const fs = Math.min(9, rh - 1.5);
    let s = '';
    // Axis labels every few rows.
    const every = Math.max(1, Math.ceil(11 / rh));
    for (let i = 0; i <= rows; i += every) {
      const v = lo + i * rs;
      s += '<text class="axis" x="' + (W - 2) + '" y="' + (y(v) + 3).toFixed(1) + '" text-anchor="end">' + num(v, rs < 1 ? 1 : 0) + '</text>';
    }
    cs.forEach(function (c, i) {
      const x0 = i * cw, sig = signals(c, CFG);
      c.rows.forEach(function (r) {
        const yt = y(r.price + rs), vol = r.buy + r.sell;
        const tint = vol ? (r.buy - r.sell) / vol : 0;
        s += '<rect class="tc-cell ' + (tint >= 0 ? 'pos' : 'neg') + '" x="' + (x0 + 6).toFixed(1) + '" y="' + yt.toFixed(1) + '" width="' + (cw - 8).toFixed(1) + '" height="' + (rh - 0.6).toFixed(1) + '" style="opacity:' + (0.08 + Math.abs(tint) * 0.3).toFixed(2) + '"/>';
        if (fs >= 6) {
          const sellImb = r.sell > 0 && r.sell >= CFG.imbalance * r.buy, buyImb = r.buy > 0 && r.buy >= CFG.imbalance * r.sell;
          s += '<text class="tc-fpt" x="' + (x0 + 6 + (cw - 8) / 2).toFixed(1) + '" y="' + (yt + rh / 2 + fs / 3).toFixed(1) + '" text-anchor="middle" style="font-size:' + fs.toFixed(1) + 'px">' +
            '<tspan class="' + (sellImb ? 'tc-imb-s' : '') + '">' + kfmt(r.sell) + '</tspan>×<tspan class="' + (buyImb ? 'tc-imb-b' : '') + '">' + kfmt(r.buy) + '</tspan></text>';
        }
      });
      // Candle: wick and body on the left edge of the column.
      const up = c.c >= c.o;
      s += '<line class="tc-wick" x1="' + (x0 + 3).toFixed(1) + '" x2="' + (x0 + 3).toFixed(1) + '" y1="' + y(c.h).toFixed(1) + '" y2="' + y(c.l).toFixed(1) + '"/>' +
        '<rect class="tc-body ' + (up ? 'pos' : 'neg') + '" x="' + (x0 + 1.5).toFixed(1) + '" width="3" y="' + y(Math.max(c.o, c.c)).toFixed(1) + '" height="' + Math.max(1, Math.abs(y(c.o) - y(c.c))).toFixed(1) + '"/>';
      if (sig.buyersExhausted || sig.sellersIn) s += '<text class="tc-mk neg" x="' + (x0 + cw / 2).toFixed(1) + '" y="' + (y(c.h + rs) - 2).toFixed(1) + '" text-anchor="middle">▼</text>';
      if (sig.sellersExhausted || sig.buyersIn) s += '<text class="tc-mk pos" x="' + (x0 + cw / 2).toFixed(1) + '" y="' + (y(c.l) + 10).toFixed(1) + '" text-anchor="middle">▲</text>';
      s += '<text class="tc-delta ' + (c.delta >= 0 ? 'pos' : 'neg') + '" x="' + (x0 + cw / 2).toFixed(1) + '" y="' + (H - pad.b + 13) + '" text-anchor="middle">' + (c.delta >= 0 ? '+' : '−') + kfmt(c.delta) + '</text>' +
        '<text class="axis" x="' + (x0 + cw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + hhmm(c.t) + '</text>';
    });
    // Session volume profile on the right, same price scale.
    if (d.profile) {
      const bins = d.profile.bins.filter(function (b) { return b.hi > lo && b.lo < hi; });
      const vmax = Math.max.apply(null, bins.map(function (b) { return b.usd; }).concat([1]));
      bins.forEach(function (b) {
        const y1 = y(Math.min(b.hi, hi)), y2 = y(Math.max(b.lo, lo));
        const inVa = b.mid >= d.profile.val && b.mid <= d.profile.vah;
        s += '<rect class="tc-prof' + (inVa ? ' va' : '') + '" x="' + plotW.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + (b.usd / vmax * (profW - 4)).toFixed(1) + '" height="' + Math.max(0.5, y2 - y1 - 0.4).toFixed(1) + '"/>';
      });
    }
    const line = function (v, cls, label) {
      if (!v) return '';
      // Off the chart: a label at the edge pointing to it.
      if (v < lo || v > hi) {
        const yy = v > hi ? pad.t - 3 : H - pad.b - 3;
        return '<text class="tc-ll ' + cls + 't" x="' + (W - axisW - 2) + '" y="' + yy.toFixed(1) + '" text-anchor="end">' + label + ' ' + num(v, pdec(v)) + (v > hi ? ' ↑' : ' ↓') + '</text>';
      }
      return '<line class="' + cls + '" x1="0" x2="' + (W - axisW) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
        '<text class="tc-ll ' + cls + 't" x="' + (W - axisW - 2) + '" y="' + (y(v) - 2).toFixed(1) + '" text-anchor="end">' + label + '</text>';
    };
    if (d.profile) s += line(d.profile.vah, 'tc-val', 'VAH') + line(d.profile.val, 'tc-val', 'VAL') + line(d.profile.poc, 'tc-pocl', 'POC');
    if (d.pivot) s += line(d.pivot.strike, 'tc-pvl', 'PIVOT');
    s += '<line class="tc-spotl" x1="0" x2="' + (W - axisW) + '" y1="' + y(d.spot).toFixed(1) + '" y2="' + y(d.spot).toFixed(1) + '"/>';
    box.innerHTML = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Order flow footprint, last ' + cs.length + ' candles">' + s + '</svg>';
  }

  function resample(cs, ms) {
    const out = [];
    cs.forEach(function (c) {
      const k = Math.floor(c.t / ms) * ms;
      if (out.length && out[out.length - 1].t === k) out[out.length - 1].c = c.c; else out.push({ t: k, c: c.c });
    });
    return out;
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Loading…';
    const asset = selected;
    try {
      data[asset] = await collectTac(asset, CFG);
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
  const timer = setInterval(function () { if (visible()) refresh(); }, CFG.refreshSeconds * 1e3);
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
