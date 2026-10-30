// Fragility tab: fetch, score, render, and watch for zone changes.
import { CONFIG } from './config.js';
import { collect } from './collect.js';
import { evaluate } from './score.js';
import { checkZoneChange, emitZoneChange, onZoneChange } from './alerts.js';
import { load, save } from '../../shared/storage.js';
import { loadHistory, renderHistory } from './history.js';

const COLORS = { funding: '#5b8def', basis: '#a77bdb', oiLevel: '#3fb8af', oiChange: '#7fc97f', gamma: '#e8a33d' };
const ZONE_CLASS = { Calm: 'calm', Building: 'building', Primed: 'primed' };

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

function fmtTime(t) {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Browser notifications only fire while this page is open. Real background
// alerts need a scheduled job: register another onZoneChange-style notifier there.
onZoneChange(function (c) {
  const text = c.asset + ': ' + c.from + ' → ' + c.to + ' (' + c.score.toFixed(0) + ')';
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Fragility zone change', { body: text });
  } catch (e) { /* mobile Chrome needs a service worker for this */ }
});

export function mount(el) {
  let results = {};
  let selected = load('fragility.asset', CONFIG.assets[0]);
  let loading = false;
  let lastChange = null;
  let history = null;      // rows from the scheduled job's log
  let historyError = null;

  el.innerHTML =
    '<div class="row between">' +
      '<div class="seg" id="fx-assets"></div>' +
      '<button class="btn" id="fx-refresh" type="button">Refresh</button>' +
    '</div>' +
    '<div id="fx-banner"></div>' +
    '<div id="fx-body"><section class="card"><p class="muted">Loading live data…</p></section></div>';

  const assetsEl = el.querySelector('#fx-assets');
  const bodyEl = el.querySelector('#fx-body');
  const bannerEl = el.querySelector('#fx-banner');
  const refreshBtn = el.querySelector('#fx-refresh');

  assetsEl.addEventListener('click', function (e) {
    const b = e.target.closest('button[data-asset]');
    if (!b) return;
    selected = b.getAttribute('data-asset');
    save('fragility.asset', selected);
    render();
  });
  refreshBtn.addEventListener('click', refresh);
  bodyEl.addEventListener('click', function (e) {
    if (e.target.id !== 'fx-notify' || typeof Notification === 'undefined') return;
    Notification.requestPermission().then(render);
  });

  function renderAssets() {
    assetsEl.innerHTML = CONFIG.assets.map(function (a) {
      const r = results[a];
      const s = r && r.score != null ? '<span class="pill ' + ZONE_CLASS[r.zone] + '">' + r.score.toFixed(0) + '</span>' : '';
      return '<button type="button" data-asset="' + a + '" class="' + (a === selected ? 'on' : '') + '">' + a + s + '</button>';
    }).join('');
  }

  function render() {
    renderAssets();
    bannerEl.innerHTML = lastChange
      ? '<div class="banner">Zone change: <b>' + esc(lastChange.asset) + '</b> ' + esc(lastChange.from) + ' → <b>' + esc(lastChange.to) + '</b> at ' + fmtTime(lastChange.time) + '</div>'
      : '';
    const r = results[selected];
    if (!r) return;
    const historyCard = '<section class="card"><h3>' + esc(selected) + ' history</h3><div id="fx-history"></div></section>';
    bodyEl.innerHTML = r.score == null
      ? '<section class="card"><p>No data sources reachable right now.</p></section>' + historyCard + sourcesHtml(r)
      : scoreHtml(r) + breakdownHtml(r) + historyCard + sourcesHtml(r);
    const histEl = bodyEl.querySelector('#fx-history');
    if (history) renderHistory(histEl, history, selected, CONFIG.zones);
    else histEl.innerHTML = '<p class="muted small">' + (historyError ? 'Log not available: ' + esc(historyError) : 'Loading log…') + '</p>';
  }

  function scoreHtml(r) {
    const cls = ZONE_CLASS[r.zone];
    let start = 0;
    const segs = CONFIG.zones.map(function (z) {
      const end = Math.min(z.max, 100);
      const html = '<div class="seg-zone ' + ZONE_CLASS[z.name] + '" style="width:' + (end - start) + '%"><span>' + z.name + '</span></div>';
      start = end;
      return html;
    }).join('');
    const stack = r.inputs.filter(function (i) { return i.points > 0.05; }).map(function (i) {
      return '<div title="' + esc(i.label) + ': ' + i.points.toFixed(1) + ' pts" style="width:' + i.points + '%;background:' + COLORS[i.key] + '"></div>';
    }).join('');
    return '<section class="card hero">' +
      '<div class="row between baseline">' +
        '<div><div class="label">' + esc(r.asset) + ' Fragility</div>' +
        '<div class="big">' + r.score.toFixed(0) + '<span class="of">/100</span></div></div>' +
        '<div class="zone ' + cls + '">' + r.zone + '</div>' +
      '</div>' +
      '<div class="gauge"><div class="zones">' + segs + '</div><div class="marker" style="left:' + r.score + '%"></div></div>' +
      '<div class="label small">What makes up the score</div>' +
      '<div class="stack">' + stack + '</div>' +
      '<p class="muted small">Updated ' + fmtTime(r.time) + ' · refreshes every ' + CONFIG.refreshMinutes + ' min' +
        (r.coverage < 1 ? ' · <b>' + Math.round(r.coverage * 100) + '% of inputs available</b>, missing ones re-weighted' : '') + '</p>' +
    '</section>';
  }

  function breakdownHtml(r) {
    const rows = r.inputs.map(function (i) {
      const ok = i.score != null;
      return '<div class="input' + (ok ? '' : ' off') + '">' +
        '<div class="row between baseline">' +
          '<div><span class="dot" style="background:' + COLORS[i.key] + '"></span><b>' + esc(i.label) + '</b>' +
          '<div class="muted small">' + esc(i.what) + '</div></div>' +
          '<div class="pts">' + (ok ? '+' + i.points.toFixed(1) + '<span class="muted small"> pts</span>' : '<span class="muted">—</span>') + '</div>' +
        '</div>' +
        '<div class="bar"><div style="width:' + (ok ? i.score : 0) + '%;background:' + COLORS[i.key] + '"></div></div>' +
        '<div class="row between small"><span>' + esc(i.value) + '</span>' +
          '<span class="muted">' + (ok ? 'sub-score ' + i.score.toFixed(0) + ' × weight ' + i.weight.toFixed(0) + '%' : 'not counted') + '</span></div>' +
        '<div class="muted small">' + esc(i.note) + '</div>' +
      '</div>';
    }).join('');
    return '<section class="card"><h3>Inputs</h3>' + rows + '</section>';
  }

  function sourcesHtml(r) {
    const list = r.sources.map(function (s) {
      return '<li><span class="' + (s.ok ? 'ok' : 'bad') + '">' + (s.ok ? '●' : '○') + '</span> ' + esc(s.name) +
        (s.ok ? '' : ' <span class="muted">— ' + esc(s.error) + '</span>') + '</li>';
    }).join('');
    const notify = typeof Notification === 'undefined' ? '' :
      Notification.permission === 'granted' ? '<p class="muted small">Desktop notifications on (while this page is open).</p>' :
      '<p class="small"><button class="btn" id="fx-notify" type="button">Notify me on zone change</button> <span class="muted">(only while this page is open)</span></p>';
    return '<section class="card"><h3>Data sources</h3><ul class="sources">' + list + '</ul>' + notify + '</section>';
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Loading…';
    try {
      loadHistory(CONFIG.historyUrl).then(function (rows) { history = rows; historyError = null; render(); })
        .catch(function (e) { historyError = e.message; render(); });
      const all = await Promise.all(CONFIG.assets.map(function (a) {
        return collect(a).then(function (d) { return evaluate(d, CONFIG); });
      }));
      all.forEach(function (r) {
        results[r.asset] = r;
        const change = checkZoneChange(r, CONFIG);
        if (change) { lastChange = Object.assign({ time: Date.now() }, change); emitZoneChange(change); }
      });
      render();
    } catch (e) {
      bodyEl.innerHTML = '<section class="card"><p>Error: ' + esc(e.message) + '</p></section>';
    } finally {
      loading = false;
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh';
    }
  }

  function onVisible() {
    const r = results[selected];
    if (document.visibilityState === 'visible' && (!r || Date.now() - r.time > 60e3)) refresh();
  }

  const timer = setInterval(refresh, CONFIG.refreshMinutes * 60e3);
  document.addEventListener('visibilitychange', onVisible);
  refresh();

  return function unmount() {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
