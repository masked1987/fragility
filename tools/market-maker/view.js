// Market Maker tab: are option dealers being paid enough for the moves they hedge?
// Step 1: implied vs realized volatility with a plain-English reading.
import { MM_CONFIG as CFG } from './config.js';
import { collectMM } from './collect.js';
import { readMM } from './read.js';
import { dailyMove } from './model.js';
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
    bodyEl.innerHTML = readingHtml(d) + chartHtml(d) + notesHtml();
    drawChart(bodyEl.querySelector('.chart'), d);
  }

  function readingHtml(d) {
    const r = readMM(d, d.gamma, d.asset, CFG, FRAGILITY.gamma.neutralRatio);
    return '<section class="card verdict ' + r.tone + '">' +
      '<div class="label">' + esc(d.asset) + ' market makers</div>' +
      '<p class="verdict-head">' + esc(r.headline) + '</p>' +
      '<ul class="verdict-lines small">' + r.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' +
      '<p class="verdict-action"><b>What it means:</b> ' + esc(r.action) + '</p>' +
      '<p class="muted small">Worked out automatically from Deribit options and Gate prices. Context, not a trade signal.</p>' +
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
      'with what actually happened. A gap under ' + CFG.gapPts + ' points counts as balanced.</p></details></section>';
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
