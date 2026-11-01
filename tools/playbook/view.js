// Playbook tab: picks a trading mode from Fragility, Forced Flow, Market Maker
// and dealer gamma, and lays out the possible decisions with levels and size.
import { PLAY_CONFIG as CFG } from './config.js';
import { collectPlay } from './collect.js';
import { load, save } from '../../shared/storage.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function px(x) { return '~' + Math.round(x).toLocaleString('en-US'); }
function pts(x) { return Math.round(Math.abs(x)).toLocaleString('en-US'); }
function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
function day(x, dayPts) { const f = Math.abs(x) / dayPts; return f < 0.375 ? '¼' : f < 0.625 ? '½' : f < 0.875 ? '¾' : f.toFixed(1) + '×'; }
const ZONE_CLASS = { Calm: 'calm', Building: 'building', Primed: 'primed' };

// Headline and "What it means" per mode.
function modeText(p, s) {
  const d = px(p.down), u = px(p.up), first = function (k) { const x = p.plans.find(function (q) { return q.key === k; }); return x && x.targets && x.targets[0] ? px(x.targets[0].price) : null; };
  const fl = p.plans.find(function (q) { return q.key === 'flush'; });
  const flz = fl ? px(fl.zone[0]) + (fl.zone[1] !== fl.zone[0] ? '–' + Math.round(fl.zone[1]).toLocaleString('en-US') : '') : '';
  switch (p.mode.key) {
    case 'cascade': return {
      head: 'Cascade risk: let the ' + (p.mode.dir === 'up' ? 'squeeze into ' : 'flush into ') + flz + ' finish, then trade the snap-back',
      action: 'Leverage or dealer pressure is high enough for moves to feed on themselves. Trade half size, keep stops wide and clear of clusters, and don\'t fade the move while it runs.' };
    case 'squeezeUp': return {
      head: 'Squeeze up: buy a hold above ' + u + (first('breakUp') ? ', aim for ' + first('breakUp') : ''),
      action: 'Shorts are crowded and their liquidations sit within reach above. A reclaim of ' + u + ' can force them out. Don\'t short into it just because it looks high.' };
    case 'squeezeDown': return {
      head: 'Squeeze down: sell a failed bounce at ' + d + (first('breakDown') ? ', aim for ' + first('breakDown') : ''),
      action: 'Longs are crowded and their liquidations sit within reach below. A break of ' + d + ' can force them out. Don\'t buy the dip into it.' };
    case 'trendDown': return {
      head: 'Trend down: sell failed bounces at ' + d + (first('breakDown') ? ', aim for ' + first('breakDown') : ''),
      action: 'Below the gamma flip dealers sell into drops, so moves run further. Trade breaks in the direction of the move and trail the stop. Don\'t catch falling knives.' };
    case 'trendUp': return {
      head: 'Trend up: buy holds above ' + u + (first('breakUp') ? ', aim for ' + first('breakUp') : ''),
      action: 'Dealers are losing on the moves, so moves run further. Trade breaks in the direction of the move and trail the stop. Don\'t fade it.' };
    case 'range': return {
      head: 'Range: fade ' + d + ' and ' + u + ' back to ' + px(p.mid),
      action: 'Above the gamma flip dealers buy dips and sell rips, so moves tend to stall. Fade the edges and take profit early. Breakouts usually fail here, so don\'t chase them.' };
    default: {
      const tb = p.plans.find(function (q) { return q.triggered; });
      if (tb) return {
        head: px(tb.trigger) + ' just ' + (tb.dir > 0 ? 'was reclaimed' : 'broke') + ': watch the retest',
        action: 'The rest of the map is neutral, so the only trade is the retest of ' + px(tb.trigger) + ' (card below). If it doesn\'t come, wait.' };
      return {
      head: 'No edge at ' + px(s.spot) + '. Wait for ' + d + ' to break or ' + u + ' to be reclaimed',
      action: 'Nothing is forcing a move: dealers are near neutral and options are fairly priced. Set alerts at the levels either side and wait. Don\'t trade out of boredom.' };
    }
  }
}

export function mount(el) {
  const data = {};
  let selected = CFG.assets[0];
  let loading = false;
  const acct = { account: load('playbook.account', CFG.account), riskPct: load('playbook.riskPct', CFG.riskPct) };

  el.innerHTML =
    '<div class="row between">' +
      '<div class="seg" id="pb-assets"></div>' +
      '<button class="btn" id="pb-refresh" type="button">Refresh</button>' +
    '</div>' +
    '<div id="pb-body"><section class="card"><p class="muted">Loading…</p></section></div>';

  const assetsEl = el.querySelector('#pb-assets');
  const bodyEl = el.querySelector('#pb-body');
  const refreshBtn = el.querySelector('#pb-refresh');

  assetsEl.addEventListener('click', function (e) {
    const b = e.target.closest('button[data-asset]');
    if (!b) return;
    selected = b.getAttribute('data-asset');
    render();
    if (stale()) refresh();
  });
  refreshBtn.addEventListener('click', refresh);
  // Size inputs: keep typing focus, only redraw the size lines.
  bodyEl.addEventListener('input', function (e) {
    if (e.target.id === 'pb-account') acct.account = +e.target.value;
    else if (e.target.id === 'pb-risk') acct.riskPct = +e.target.value;
    else return;
    save('playbook.account', acct.account);
    save('playbook.riskPct', acct.riskPct);
    bodyEl.querySelectorAll('[data-size]').forEach(function (n) { n.innerHTML = sizeText(+n.getAttribute('data-size'), +n.getAttribute('data-stop')); });
  });

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
    bodyEl.innerHTML = readingHtml(d) + '<h3 class="pb-h">Possible decisions</h3>' + d.plan.plans.map(function (p) { return planHtml(p, d); }).join('') +
      sizeHtml() + notesHtml(d);
  }

  function readingHtml(d) {
    const s = d.s, p = d.plan, t = modeText(p, s);
    const vs = s.flip ? s.spot / s.flip - 1 : null;
    const lines = [];
    if (s.flip == null) lines.push('No gamma flip nearby: dealer hedging gives no clear push.');
    else if (Math.abs(vs) * 100 <= CFG.flipBandPct) lines.push('Price ' + px(s.spot) + ' sits on the gamma flip (' + px(s.flip) + '): dealers are close to neutral.');
    else if (vs < 0) lines.push('Price is ' + (Math.abs(vs) * 100).toFixed(1) + '% below the gamma flip (' + px(s.flip) + '): dealers make moves bigger.');
    else lines.push('Price is ' + (vs * 100).toFixed(1) + '% above the gamma flip (' + px(s.flip) + '): dealers calm moves down.');
    if (s.zone) lines.push('Fragility ' + Math.round(s.score) + ' ' + s.zone + (s.funding === 'short' ? '; shorts are crowded (they pay funding)' : s.funding === 'long' ? '; longs are crowded (they pay funding)' : '') + '.');
    lines.push('Forced Flow: ' + s.flow.headline + '.');
    lines.push('Market Maker: ' + s.overall.text.replace(/^Overall: /, '').replace(/^\w/, function (c) { return c.toUpperCase(); }));
    lines.push('Options price ±' + (s.move * 100).toFixed(1) + '% a day (' + pts(p.dayPts) + ' points). Stops sit about ½ of that past the trigger; targets are the mapped clusters and strikes.');
    const fr = s.zone ? '<a href="#fragility" class="plain"><span class="pill ' + ZONE_CLASS[s.zone] + '">' + Math.round(s.score) + ' ' + s.zone + '</span></a> ' : '';
    return '<section class="card verdict pb-' + p.mode.tone + '">' +
      '<div class="label">' + esc(d.asset) + ' playbook</div>' +
      '<p class="small verdict-urgency"><span class="pill pb-' + p.mode.tone + '">' + esc(p.mode.name) + '</span> ' + fr + '</p>' +
      '<p class="verdict-head">' + esc(t.head) + '</p>' +
      '<ul class="verdict-lines small">' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' +
      '<p class="verdict-action"><b>What it means:</b> ' + esc(t.action) + '</p>' +
      '<p class="muted small">Worked out automatically from the other tabs. Context, not a trade signal; not financial advice.</p>' +
    '</section>';
  }

  function chip(p) {
    if (p.preferred) return '<span class="chip pref">' + (p.key === 'wait' ? 'Do this now' : 'Preferred') + '</span>';
    if (p.triggered) return '<span class="chip trig">Triggered</span>';
    return '<span class="chip">If it happens</span>';
  }
  function side(p) {
    const half = p.size === 0.5 ? ' · half size' : '';
    if (p.side === 'long') return '<span class="pill calm">Long' + half + '</span>';
    if (p.side === 'short') return '<span class="pill primed">Short' + half + '</span>';
    if (p.side === 'both') return '<span class="pill pb-accent">Both ways' + half + '</span>';
    return '<span class="pill pb-muted">No trade</span>';
  }
  function head(title, p) {
    return '<div class="pb-top"><h3>' + esc(title) + '</h3><div class="pb-chips">' + chip(p) + side(p) + '</div></div>';
  }
  function targetWhy(t, dir) {
    if (t.kind === 'strike') return 'dealers\' biggest long-gamma strike: ' + (dir > 0 ? 'rallies' : 'drops') + ' tend to stall here. Take most of it here';
    if (t.kind === 'move') return (t.share === 0.5 ? '½' : '¾') + ' of a day\'s move (nothing mapped nearer)';
    const what = dir > 0 ? 'short liquidations' : 'long liquidations';
    return what + ' (~$' + Math.round(t.usd / 1e6) + 'M)' + (t.amplify === true ? ', dealers add to it: can overshoot' : t.amplify === false ? ', dealers absorb it: likely stalls' : '');
  }

  function planHtml(p, d) {
    const s = d.s, a = d.asset, dp = d.plan.dayPts;
    const cls = 'card pb-plan ' + (p.side === 'long' ? 'up' : p.side === 'short' ? 'down' : p.side === 'both' ? 'both' : 'wait') + (p.preferred ? ' pref' : '');
    if (p.key === 'breakDown' || p.key === 'breakUp') {
      const up = p.dir > 0, risk = Math.abs(p.entry - p.stop);
      const status = p.triggered
        ? a + ' just ' + (up ? 'closed back above ' : 'closed below ') + px(p.trigger) + '. Wait for a ' + (up ? 'dip to hold' : 'bounce to fail') + ' there; if it never comes back, skip it.'
        : a + ' is ' + pts(s.spot - p.trigger) + ' points ' + (up ? 'below' : 'above') + ' the trigger.' + (s.levels.indexOf(p.trigger) >= 0 ? ' Your phone alert rings when it crosses.' : '');
      const tg = p.targets.map(function (t, i) {
        return '<li><b class="num">' + px(t.price) + '</b> <span class="muted">' + t.r.toFixed(1) + '× risk</span><br><span class="small">' +
          esc(cap(targetWhy(t, p.dir)) + (i === 0 && p.targets.length > 1 && t.kind !== 'strike' ? '. Take half here.' : '.')) + '</span></li>';
      }).join('');
      return '<section class="' + cls + '">' + head(up ? 'If ' + px(p.trigger) + ' is reclaimed' : 'If ' + px(p.trigger) + ' breaks', p) +
        '<p class="small pb-status">' + esc(status) + '</p>' +
        '<dl class="pb-dl">' +
          '<dt>Trigger</dt><dd>A 1-hour candle closes ' + (up ? 'above ' : 'below ') + px(p.trigger) + '</dd>' +
          '<dt>Entry</dt><dd>On the ' + (up ? 'retest that holds' : 'bounce that fails') + ' at ' + px(p.entry) + '. No chasing.</dd>' +
          '<dt>Stop</dt><dd><b class="num">' + px(p.stop) + '</b> <span class="muted">(' + pts(risk) + ' points, ' + day(risk, dp) + ' of a day\'s move)</span></dd>' +
          '<dt>Targets</dt><dd><ul class="pb-tg">' + tg + '</ul></dd>' +
          '<dt>Size</dt><dd data-size="' + p.size + '" data-stop="' + risk + '">' + sizeText(p.size, risk) + '</dd>' +
        '</dl>' +
        (p.targets.length > 1 ? '<p class="small muted">After the first target, move the stop to the entry.</p>' : '') +
      '</section>';
    }
    if (p.key === 'range') {
      const risk = Math.abs(p.stopHigh - p.high);
      return '<section class="' + cls + '">' + head('Fade ' + px(p.low) + ' and ' + px(p.high), p) +
        '<dl class="pb-dl">' +
          '<dt>Sell</dt><dd>Near ' + px(p.high) + ', stop <b class="num">' + px(p.stopHigh) + '</b></dd>' +
          '<dt>Buy</dt><dd>Near ' + px(p.low) + ', stop <b class="num">' + px(p.stopLow) + '</b></dd>' +
          '<dt>Target</dt><dd>The middle, ' + px(p.mid) + '. Take it early.</dd>' +
          '<dt>Size</dt><dd data-size="' + p.size + '" data-stop="' + risk + '">' + sizeText(p.size, risk) + '</dd>' +
        '</dl></section>';
    }
    if (p.key === 'wait') {
      return '<section class="' + cls + '">' + head('Between ' + px(p.low) + ' and ' + px(p.high), p) +
        '<p class="small">Moves here are noise: dealers are near neutral and nothing is forcing a move. Wait for one of the two plans below to trigger. ' +
        'If you must trade, fade only the edges with half size and target the middle (' + px(p.mid) + ').</p></section>';
    }
    // After a flush (down) or squeeze (up).
    const down = p.side === 'long';
    const z = px(p.zone[0]) + (p.zone[1] !== p.zone[0] ? '–' + Math.round(p.zone[1]).toLocaleString('en-US') : '');
    return '<section class="' + cls + '">' + head('After a ' + (down ? 'flush' : 'squeeze') + ' into ' + z, p) +
      '<p class="small">Don\'t ' + (down ? 'buy the first touch' : 'short the first spike') + '. Wait for the move to finish: ' + (down ? 'long' : 'short') + ' liquidations spike on Forced Flow, ' +
      'then a 1-hour candle closes back ' + (down ? 'above' : 'below') + ' the cluster. That\'s a ' + (down ? 'long' : 'short') + ' back toward ' + px(p.back) + ', stop ' + (down ? 'under the low' : 'over the high') + ' of the move.' +
      (s.funding === (down ? 'short' : 'long') ? ' Crowded ' + (down ? 'shorts' : 'longs') + ' make the snap-back more likely.' : '') + '</p></section>';
  }

  function sizeText(factor, stopPts) {
    if (!(acct.account > 0 && acct.riskPct > 0 && stopPts > 0)) return '<span class="muted">Fill in your account below.</span>';
    const dollars = acct.account * acct.riskPct / 100 * factor;
    const coins = dollars / stopPts;
    return '<b class="num">' + coins.toFixed(coins < 1 ? 3 : 2) + ' ' + esc(selected) + '</b> <span class="muted">(risking $' + Math.round(dollars).toLocaleString('en-US') + (factor === 0.5 ? ', half size' : '') + ')</span>';
  }

  function sizeHtml() {
    return '<section class="card"><h3>Your size</h3><div class="pb-calc">' +
      '<label for="pb-account">Account ($)<input id="pb-account" type="number" inputmode="decimal" min="0" value="' + acct.account + '"></label>' +
      '<label for="pb-risk">Risk per trade (%)<input id="pb-risk" type="number" inputmode="decimal" min="0" step="0.1" value="' + acct.riskPct + '"></label>' +
      '</div><p class="muted small">Size = dollars at risk ÷ stop distance. Saved on this phone only. Risk 0.5–1% a trade; two losing trades in a day, stop for the day.</p></section>';
  }

  function notesHtml(d) {
    return '<section class="card"><details><summary><b>How the mode is picked</b></summary>' +
      '<p class="small">Checked in this order, first match wins:</p><ul class="small">' +
      '<li><b>Cascade risk</b>: Fragility Primed, Market Maker "unstable", or a liquidation cluster within 2% that dealers would add to while leverage is building.</li>' +
      '<li><b>Squeeze</b>: one side crowded (paying funding) with its liquidations within 5%, and price not on the wrong side of the gamma flip.</li>' +
      '<li><b>Trend</b>: price more than ' + CFG.flipBandPct + '% below the gamma flip, or dealers losing on the moves.</li>' +
      '<li><b>Range</b>: price more than ' + CFG.flipBandPct + '% above the gamma flip.</li>' +
      '<li><b>No edge</b>: anything else, usually price sitting on the flip.</li></ul>' +
      '<p class="small">Triggers are your phone alert levels and round numbers, and never on the wrong side of the flip. A level crossed in the last few hourly closes shows as Triggered. ' +
      'Alert levels are picked automatically each day after the 08:00 UTC option expiry: the five big gamma strikes within 15% (most open calls + puts, leaving out options about to expire). Your phone rings when price breaks one, and again, louder, if it turns back through it within 48 hours' +
      (d.s.levels.length ? '. ' + esc(d.asset) + ' now: ' + d.s.levels.map(px).join(' / ') : '') + '. ' +
      'Stops are ½ of a day\'s implied move past the trigger: over the last 41 days that survived 79% of days that went the right way. ' +
      'Targets are liquidation clusters and dealers\' biggest long-gamma strikes within two days\' moves.</p>' +
      '<p class="small">Nothing here is backtested yet: the Fragility log only began in late October 2026. Paper-trade or use minimum size and note the mode on each trade.</p>' +
      '</details></section>';
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Loading…';
    const asset = selected;
    try {
      data[asset] = await collectPlay(asset, CFG);
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
  window.addEventListener('hashchange', onShow);
  document.addEventListener('visibilitychange', onShow);
  render();
  refresh();

  return function unmount() {
    clearInterval(timer);
    window.removeEventListener('hashchange', onShow);
    document.removeEventListener('visibilitychange', onShow);
  };
}
