// History card: the logged score over time and what price did afterwards.
// Reads log.csv written by jobs/monitor.mjs.

const DAY = 864e5;
const CHART_DAYS = 14;

export async function loadHistory(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return parse(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

function parse(text) {
  const lines = text.trim().split('\n');
  const head = lines.shift().split(',');
  return lines.map(function (l) {
    const v = l.split(',');
    const row = {};
    head.forEach(function (h, i) { row[h] = v[i]; });
    return { t: Date.parse(row.time), asset: row.asset, price: +row.price, score: +row.score, zone: row.zone };
  }).filter(function (r) { return isFinite(r.t) && r.price > 0; });
}

// For each reading with a full day after it: the largest move from that price
// within the next 24h, in percent.
function nextDayMoves(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let biggest = 0, lastT = r.t;
    for (let j = i + 1; j < rows.length && rows[j].t <= r.t + DAY; j++) {
      biggest = Math.max(biggest, Math.abs(rows[j].price / r.price - 1) * 100);
      lastT = rows[j].t;
    }
    if (lastT >= r.t + 23 * 3.6e6) out.push({ zone: r.zone, move: biggest });
  }
  return out;
}

function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function statsHtml(rows, zones) {
  const moves = nextDayMoves(rows);
  if (!moves.length) {
    return '<p class="muted small">Next-day results appear once the log has more than 24 hours of readings.</p>';
  }
  const body = zones.map(function (z) {
    const m = moves.filter(function (x) { return x.zone === z.name; }).map(function (x) { return x.move; });
    const avg = m.length ? m.reduce(function (a, b) { return a + b; }, 0) / m.length : null;
    const max = m.length ? Math.max.apply(null, m) : null;
    return '<tr><td><span class="pill ' + z.name.toLowerCase() + '">' + z.name + '</span></td>' +
      '<td>' + m.length + '</td>' +
      '<td>' + (avg == null ? '—' : avg.toFixed(1) + '%') + '</td>' +
      '<td>' + (max == null ? '—' : max.toFixed(1) + '%') + '</td></tr>';
  }).join('');
  return '<table class="stats"><thead><tr><th>Zone</th><th>Readings</th><th>Avg biggest move next 24h</th><th>Largest</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table>' +
    '<p class="muted small">If the zones work, moves after Primed should be clearly bigger than after Calm. Needs a few weeks of data to mean much.</p>';
}

// Score line over the zone bands, with a hover/touch readout.
function drawChart(box, rows, zones) {
  const W = Math.max(box.clientWidth, 260), H = 170;
  const pad = { l: 28, r: 8, t: 8, b: 22 };
  const t1 = Date.now(), t0 = Math.max(t1 - CHART_DAYS * DAY, rows[0].t);
  const pts = rows.filter(function (r) { return r.t >= t0; });
  const x = function (t) { return pad.l + (t - t0) / Math.max(t1 - t0, 1) * (W - pad.l - pad.r); };
  const y = function (s) { return pad.t + (1 - s / 100) * (H - pad.t - pad.b); };

  let svg = '';
  let lo = 0;
  zones.forEach(function (z) {
    const hi = Math.min(z.max, 100);
    svg += '<rect class="band ' + z.name.toLowerCase() + '" x="' + pad.l + '" y="' + y(hi) + '" width="' + (W - pad.l - pad.r) + '" height="' + (y(lo) - y(hi)) + '"/>';
    svg += '<text class="band-label" x="' + (W - pad.r - 4) + '" y="' + (y(hi) + 12) + '" text-anchor="end">' + z.name + '</text>';
    if (lo > 0) svg += '<text class="axis" x="' + (pad.l - 4) + '" y="' + (y(lo) + 4) + '" text-anchor="end">' + lo + '</text>';
    lo = hi;
  });
  svg += '<text class="axis" x="' + (pad.l - 4) + '" y="' + (y(100) + 8) + '" text-anchor="end">100</text>';
  const fmt = function (t) { return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  svg += '<text class="axis" x="' + pad.l + '" y="' + (H - 6) + '">' + fmt(t0) + '</text>';
  svg += '<text class="axis" x="' + (W - pad.r) + '" y="' + (H - 6) + '" text-anchor="end">now</text>';
  if (pts.length > 1) {
    svg += '<polyline class="line" points="' + pts.map(function (p) { return x(p.t).toFixed(1) + ',' + y(p.score).toFixed(1); }).join(' ') + '"/>';
  }
  if (pts.length) {
    const last = pts[pts.length - 1];
    svg += '<circle class="dot" cx="' + x(last.t) + '" cy="' + y(last.score) + '" r="4"/>';
  }
  svg += '<line class="cross" y1="' + pad.t + '" y2="' + (H - pad.b) + '" visibility="hidden"/>' +
    '<circle class="dot hover" r="5" visibility="hidden"/>';

  box.innerHTML = '<svg width="' + W + '" height="' + H + '" role="img" aria-label="Fragility score, last ' + CHART_DAYS + ' days">' + svg + '</svg><div class="tip"></div>';
  if (!pts.length) return;

  const el = box.querySelector('svg'), cross = el.querySelector('.cross'), dot = el.querySelector('.hover'), tip = box.querySelector('.tip');
  function readout(p) {
    tip.innerHTML = '<b>' + p.score.toFixed(0) + '</b> ' + esc(p.zone) + ' <span class="muted">· ' +
      new Date(p.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) +
      ' · $' + Math.round(p.price).toLocaleString('en-US') + '</span>';
  }
  function show(e) {
    const px = e.clientX - el.getBoundingClientRect().left;
    let near = pts[0];
    pts.forEach(function (p) { if (Math.abs(x(p.t) - px) < Math.abs(x(near.t) - px)) near = p; });
    const cx = x(near.t), cy = y(near.score);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
    readout(near);
  }
  function hide() {
    cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden');
    readout(pts[pts.length - 1]);
  }
  hide();
  el.addEventListener('pointermove', show);
  el.addEventListener('pointerdown', show);
  el.addEventListener('pointerleave', hide);
}

export function renderHistory(el, all, asset, zones) {
  const rows = all.filter(function (r) { return r.asset === asset; }).sort(function (a, b) { return a.t - b.t; });
  if (!rows.length) {
    el.innerHTML = '<p class="muted small">No log yet. The scheduled job adds a reading every hour.</p>';
    return;
  }
  const days = (rows[rows.length - 1].t - rows[0].t) / DAY;
  const hours = Math.max(1, Math.round(days * 24));
  const span = rows.length < 2 ? '1 hourly reading so far'
    : rows.length + ' hourly readings over ' + (days < 1 ? hours + (hours === 1 ? ' hour' : ' hours') : days.toFixed(1) + ' days');
  el.innerHTML = '<p class="muted small">' + span + '.</p>' +
    '<div class="chart"></div>' + statsHtml(rows, zones);
  drawChart(el.querySelector('.chart'), rows, zones);
}
