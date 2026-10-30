// Forced Flow tab: estimated liquidation clusters and dealer gamma on one ladder.
import { FLOW_CONFIG as CFG } from './config.js';
import { collectFlow } from './collect.js';
import { readFlow } from './read.js';
import { load, save } from '../../shared/storage.js';

const ZONE_CLASS = { Calm: 'calm', Building: 'building', Primed: 'primed' };

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function usd(x) {
  const a = Math.abs(x);
  const s = a >= 1e9 ? (a / 1e9).toFixed(1) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(0) + 'M' : (a / 1e3).toFixed(0) + 'K';
  return (x < 0 ? '−$' : '$') + s;
}
function px(x) { return Math.round(x).toLocaleString('en-US'); }
function pct(x) { return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1) + '%'; }

export function mount(el) {
  const data = {};
  let selected = load('flow.asset', CFG.assets[0]);
  let loading = false;

  el.innerHTML =
    '<div class="row between">' +
      '<div class="seg" id="ff-assets"></div>' +
      '<button class="btn" id="ff-refresh" type="button">Refresh</button>' +
    '</div>' +
    '<div id="ff-body"><section class="card"><p class="muted">Loading…</p></section></div>';

  const assetsEl = el.querySelector('#ff-assets');
  const bodyEl = el.querySelector('#ff-body');
  const refreshBtn = el.querySelector('#ff-refresh');

  assetsEl.addEventListener('click', function (e) {
    const b = e.target.closest('button[data-asset]');
    if (!b) return;
    selected = b.getAttribute('data-asset');
    save('flow.asset', selected);
    render();
    if (stale()) refresh();
  });
  refreshBtn.addEventListener('click', refresh);

  function stale() {
    const d = data[selected];
    return !d || Date.now() - d.time > 60e3;
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
    bodyEl.innerHTML = readingHtml(d) + summaryHtml(d) + mapHtml(d) + notesHtml(d);
    drawLadder(bodyEl.querySelector('.ladder'), d);
  }

  function clusterRows(list, kind) {
    if (!list) return '<li class="muted">None estimated within ±' + CFG.rangePct + '%</li>';
    return list.map(function (c) {
      let effect = '';
      if (c.gammaThere != null) {
        effect = c.gammaThere < 0
          ? '<span class="tag neg">dealers short gamma: would amplify</span>'
          : '<span class="tag pos">dealers long gamma: likely absorbed</span>';
      }
      return '<li><div class="row between baseline"><span><b>' + px(c.price) + '</b> <span class="muted">(' + pct(c.pct) + ')</span></span>' +
        '<b>~' + usd(c.usd) + '</b></div>' +
        '<div class="small muted">' + (c.largest ? 'Largest' : 'Nearest big') + ' ' + kind + ' cluster</div>' + effect + '</li>';
    }).join('');
  }

  function readingHtml(d) {
    const r = readFlow(d, CFG.read);
    const urg = r.urgency
      ? '<p class="small verdict-urgency"><a href="#fragility" class="plain"><span class="pill ' + ZONE_CLASS[r.urgency.zone] + '">' +
        r.urgency.score.toFixed(0) + ' ' + r.urgency.zone + '</span></a> ' + esc(r.urgency.text) + '</p>'
      : '';
    return '<section class="card verdict ' + r.tone + '">' +
      '<div class="label">' + esc(d.asset) + ' reading</div>' +
      '<p class="verdict-head">' + esc(r.headline) + '</p>' + urg +
      '<ul class="verdict-lines small">' + r.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' +
      '<p class="verdict-action"><b>What it means:</b> ' + esc(r.action) + '</p>' +
      '<p class="muted small">Worked out automatically from the estimates below. Context, not a trade signal.</p>' +
    '</section>';
  }

  function summaryHtml(d) {
    const above = d.flip && d.spot > d.flip;
    const flipLine = d.flip
      ? 'Gamma flip <b>' + px(d.flip) + '</b>: spot is ' + (above ? 'above (dealers long gamma, moves tend to be absorbed)' : 'below (dealers short gamma, moves can speed up)')
      : 'No gamma flip within ±15%';
    const fr = d.fragility;
    const frLine = fr && fr.score != null
      ? '<a href="#fragility" class="plain">Fragility <span class="pill ' + ZONE_CLASS[fr.zone] + '">' + fr.score.toFixed(0) + ' ' + fr.zone + '</span></a>' +
        (fr.funding ? ' <span class="muted">· funding ' + esc(fr.funding) + '</span>' : '')
      : '';
    return '<section class="card">' +
      '<div class="row between baseline"><div><div class="label">' + esc(d.asset) + ' spot</div><div class="mid-num">' + px(d.spot) + '</div></div>' +
      '<div class="small" style="text-align:right">' + frLine + '</div></div>' +
      '<p class="small">' + flipLine + '</p>' +
      '<div class="two">' +
        '<div><h4><span class="sw" style="background:var(--liq-short)"></span>Above: forced buying</h4>' +
          '<div class="muted small">Short liquidations</div><ul class="clusters">' + clusterRows(d.clusters.shorts, 'short') + '</ul></div>' +
        '<div><h4><span class="sw" style="background:var(--liq-long)"></span>Below: forced selling</h4>' +
          '<div class="muted small">Long liquidations</div><ul class="clusters">' + clusterRows(d.clusters.longs, 'long') + '</ul></div>' +
      '</div>' +
      '<p class="small muted">Actually liquidated in the last 24h on Gate: longs ' + usd(d.liq24.longUsd) + ' · shorts ' + usd(d.liq24.shortUsd) + '</p>' +
    '</section>';
  }

  function mapHtml(d) {
    return '<section class="card"><h3>' + esc(d.asset) + ' forced-flow map</h3>' +
      '<div class="legend small">' +
        '<span><span class="sw" style="background:var(--liq-short)"></span>Short liquidations (forced buying)</span>' +
        '<span><span class="sw" style="background:var(--liq-long)"></span>Long liquidations (forced selling)</span>' +
        '<span><span class="sw" style="background:var(--g-pos)"></span>Dealer gamma + (absorbs)</span>' +
        '<span><span class="sw" style="background:var(--g-neg)"></span>Dealer gamma − (amplifies)</span>' +
        '<span><span class="ln"></span>Spot</span>' +
        '<span><span class="ln dash"></span>Gamma flip</span>' +
      '</div>' +
      '<div class="ladder"></div>' +
      '<div class="readout small" aria-live="polite"></div>' +
      '<p class="muted small">Updated ' + new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · refreshes every ' + CFG.refreshMinutes + ' min</p>' +
    '</section>';
  }

  function notesHtml(d) {
    const lev = CFG.leverage.map(function (l) { return l.x + 'x ' + Math.round(l.w * 100) + '%'; }).join(', ');
    return '<section class="card"><details><summary><b>How this is estimated</b></summary>' +
      '<p class="small">Exchanges don\'t publish where liquidations sit, so this is a model, like every liquidation map. ' +
      'It replays 30 days of hourly Gate data: new open interest is split long/short by taker buying, spread over a leverage mix (' + lev + '), ' +
      'shrunk when open interest falls, and removed once price trades through its liquidation price. ' +
      'Amounts are scaled ×' + d.scale.toFixed(1) + ' to the open interest of ' + esc(d.venues.join(', ')) + '.</p>' +
      '<p class="small">Gamma bars are Deribit net dealer gamma by strike (calls +, puts −, the usual assumption), in USD per 1% move. ' +
      'Treat clusters as zones, not exact prices.</p></details></section>';
  }

  function drawLadder(box, d) {
    const bins = d.bins;
    const n = bins.length;
    const W = Math.max(box.clientWidth, 280);
    const rowH = 9, top = 20;
    const H = top + n * rowH + 4;
    const labelW = 52, gammaW = Math.max(72, Math.round(W * 0.26));
    const x0 = labelW + 6, liqW = W - x0 - gammaW - 12;
    const gx = x0 + liqW + 12 + gammaW / 2;
    const step = bins[0].hi - bins[0].lo;
    const priceTop = bins[n - 1].hi;
    const yOf = function (p) { return top + (priceTop - p) / step * rowH; };
    const maxLiq = Math.max.apply(null, bins.map(function (b) { return b.longUsd + b.shortUsd; }).concat([1]));
    const maxG = Math.max.apply(null, bins.map(function (b) { return Math.abs(b.gamma); }).concat([1]));

    let s = '<text class="axis" x="' + x0 + '" y="12">Est. liquidations</text>' +
      '<text class="axis" x="' + gx + '" y="12" text-anchor="middle">Dealer gamma</text>' +
      '<line class="gz" x1="' + gx + '" x2="' + gx + '" y1="' + top + '" y2="' + (H - 4) + '"/>';
    const spotY = yOf(d.spot);
    for (let i = 0; i < n; i++) {
      const b = bins[i];
      const y = top + (n - 1 - i) * rowH + 1, h = rowH - 2;
      let x = x0;
      [['longUsd', 'long'], ['shortUsd', 'short']].forEach(function (k) {
        const w = b[k[0]] / maxLiq * liqW;
        if (w < 0.5) return;
        s += '<rect class="liq ' + k[1] + '" x="' + x.toFixed(1) + '" y="' + y + '" width="' + w.toFixed(1) + '" height="' + h + '" rx="2"/>';
        x += w;
      });
      const gw = Math.abs(b.gamma) / maxG * (gammaW / 2);
      if (gw >= 0.5) {
        s += '<rect class="g ' + (b.gamma >= 0 ? 'pos' : 'neg') + '" x="' + (b.gamma >= 0 ? gx : gx - gw).toFixed(1) + '" y="' + y + '" width="' + gw.toFixed(1) + '" height="' + h + '" rx="2"/>';
      }
      // Price labels every 2%, kept clear of the spot label.
      if (i % 4 === 0) {
        const ly = top + (n - 1 - i) * rowH + rowH;
        if (Math.abs(ly - spotY) > 16) s += '<text class="axis" x="' + (labelW - 2) + '" y="' + (ly + 3) + '" text-anchor="end">' + px(b.lo) + '</text>';
      }
    }
    if (d.flip && d.flip > bins[0].lo && d.flip < priceTop) {
      const fy = yOf(d.flip);
      s += '<line class="flip" x1="' + x0 + '" x2="' + W + '" y1="' + fy + '" y2="' + fy + '"/>' +
        '<text class="flip-label" x="' + (x0 + liqW) + '" y="' + (fy + (fy < spotY ? -3 : 10)) + '" text-anchor="end">flip ' + px(d.flip) + '</text>';
    }
    s += '<line class="spot" x1="0" x2="' + W + '" y1="' + spotY + '" y2="' + spotY + '"/>' +
      '<text class="spot-label" x="' + (labelW - 2) + '" y="' + (spotY - 3) + '" text-anchor="end">' + px(d.spot) + '</text>' +
      '<rect class="hl" x="0" width="' + W + '" height="' + rowH + '" visibility="hidden"/>';

    box.innerHTML = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Estimated liquidation levels and dealer gamma by price">' + s + '</svg>';

    const svg = box.querySelector('svg'), hl = svg.querySelector('.hl');
    const readout = box.parentNode.querySelector('.readout');
    function idle() {
      hl.setAttribute('visibility', 'hidden');
      readout.innerHTML = '<span class="muted">Tap or hover a row for details.</span>';
    }
    function show(e) {
      const r = Math.floor((e.clientY - svg.getBoundingClientRect().top - top) / rowH);
      if (r < 0 || r >= n) return idle();
      const b = bins[n - 1 - r];
      hl.setAttribute('y', top + r * rowH);
      hl.setAttribute('visibility', 'visible');
      const parts = [];
      if (b.shortUsd > 0) parts.push('short liqs ~' + usd(b.shortUsd));
      if (b.longUsd > 0) parts.push('long liqs ~' + usd(b.longUsd));
      parts.push('gamma ' + usd(b.gamma) + ' per 1%');
      readout.innerHTML = '<b>' + px(b.lo) + '–' + px(b.hi) + '</b> <span class="muted">(' + pct((b.lo + b.hi) / 2 / d.spot * 100 - 100) + ')</span> · ' + parts.join(' · ');
    }
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', idle);
    idle();
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Loading…';
    const asset = selected;
    try {
      data[asset] = await collectFlow(asset, CFG);
    } catch (e) {
      data[asset] = { error: e.message, time: Date.now() };
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
