// Plain-English reading of a Forced Flow estimate: one headline, a few lines,
// and what it means in practice. Pure (no DOM), so it runs in Node too.
//
// Each side is judged by its nearest big cluster:
//   loaded     within closePct and dealers would amplify -> a move there can cascade
//   open       within farPct and dealers would amplify   -> could run, not imminent
//   cushioned  within farPct and dealers would absorb     -> a move there likely stalls
//   far        beyond farPct, or nothing estimated
// Fragility sets the urgency; funding and the gamma flip add context.

const URGENCY = {
  Calm: { level: 'low', text: 'Low urgency: overall leverage is not stretched' },
  Building: { level: 'medium', text: 'Medium urgency: leverage is building up' },
  Primed: { level: 'high', text: 'High urgency: leverage is stretched, cascades are more likely' },
};

// Levels are estimates: round to ~3 significant figures (75,800 / 2,170) so they read as zones.
function px(x) {
  const step = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.abs(x))) - 2));
  return (Math.round(x / step) * step).toLocaleString('en-US');
}
function usd(x) { return x >= 1e9 ? '$' + (x / 1e9).toFixed(1) + 'B' : '$' + Math.round(x / 1e6) + 'M'; }
function pct(x) { return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1) + '%'; }

function judge(list, cfg) {
  if (!list || !list.length) return { state: 'far' };
  const nearest = list.reduce(function (a, b) { return Math.abs(b.pct) < Math.abs(a.pct) ? b : a; });
  const largest = list.find(function (c) { return c.largest; }) || nearest;
  const dist = Math.abs(nearest.pct);
  const amplify = nearest.gammaThere == null ? null : nearest.gammaThere < 0;
  let state;
  if (dist > cfg.farPct) state = 'far';
  else if (amplify === false) state = 'cushioned';
  else if (dist <= cfg.closePct) state = 'loaded';
  else state = 'open';
  return { state: state, nearest: nearest, largest: largest, amplify: amplify };
}

// "forced selling at ~75,700 (−1.2%, ~$64M)"
function where(c, kind) { return kind + ' at ~' + px(c.price) + ' (' + pct(c.pct) + ', ~' + usd(c.usd) + ')'; }

function sideLine(s, dir) {
  const kind = dir === 'down' ? 'Forced selling' : 'Forced buying';
  const move = dir === 'down' ? 'a drop' : 'a rally';
  if (s.state === 'far' && !s.nearest) return (dir === 'down' ? 'Below: ' : 'Above: ') + 'no forced flow estimated nearby.';
  const head = (dir === 'down' ? 'Below: ' : 'Above: ') + where(s.nearest, kind.toLowerCase());
  const next = s.largest !== s.nearest ? ', then a bigger one at ~' + px(s.largest.price) : '';
  if (s.state === 'far') return head + '. Far away, not a factor yet.';
  if (s.state === 'cushioned') return head + '. Dealers would absorb it, so ' + move + ' there likely slows.';
  if (s.amplify === null) return head + next + '. Dealer effect unknown (no options data).';
  return head + '. Dealers would add to it, so ' + move + ' there could speed up' + next + '.';
}

export function readFlow(d, cfg) {
  const down = judge(d.clusters.longs, cfg);
  const up = judge(d.clusters.shorts, cfg);
  const dn = down.nearest, un = up.nearest;
  let tone, headline, action;

  if (down.state === 'loaded' && up.state === 'loaded') {
    tone = 'both';
    headline = 'Two-way risk: a break either way could run fast';
    action = 'Price is boxed between ~' + px(dn.price) + ' and ~' + px(un.price) + '. Avoid chasing the middle; whichever level breaks first is likely to move fast.';
  } else if (down.state === 'loaded') {
    tone = 'down';
    headline = 'Downside is the risk: a drop to ~' + px(dn.price) + ' could cascade';
    action = 'Avoid buying dips into ~' + px(dn.price) + '; if it is hit, let the flush finish first. Keep long stops clear of that level, not right at it.';
  } else if (up.state === 'loaded') {
    tone = 'up';
    headline = 'Squeeze risk: a rise to ~' + px(un.price) + ' could run';
    action = 'Avoid shorting into ~' + px(un.price) + '; if it is hit, let the squeeze finish first. Keep short stops clear of that level, not right at it.';
  } else if (down.state === 'open' && up.state === 'open') {
    tone = 'both';
    headline = 'Two-way, not imminent: both sides could run once reached';
    action = 'Nothing is close enough to trigger soon. A move to ~' + px(dn.price) + ' or ~' + px(un.price) + ' would be the point where it could speed up.';
  } else if (down.state === 'open') {
    tone = 'down';
    headline = 'Leaning down: a drop to ~' + px(dn.price) + ' could run, but it is not close';
    action = 'No immediate trigger. If price heads toward ~' + px(dn.price) + ', expect the move to speed up there.';
  } else if (up.state === 'open') {
    tone = 'up';
    headline = 'Leaning up: a rise to ~' + px(un.price) + ' could squeeze, but it is not close';
    action = 'No immediate trigger. If price heads toward ~' + px(un.price) + ', expect the move to speed up there.';
  } else if (down.state === 'cushioned' || up.state === 'cushioned') {
    tone = 'calm';
    const lv = [down.state === 'cushioned' ? '~' + px(dn.price) : null, up.state === 'cushioned' ? '~' + px(un.price) : null].filter(Boolean);
    headline = 'Cushioned: moves into nearby clusters would likely stall';
    action = 'Dealers would absorb forced orders at ' + lv.join(' and ') + '. Expect slowing or a bounce there rather than a cascade.';
  } else {
    tone = 'quiet';
    headline = 'Quiet: no forced flow within ' + cfg.farPct + '%';
    action = 'Little fuel nearby, so breakouts are less likely to follow through. Range-bound trading is more likely.';
  }

  const lines = [sideLine(down, 'down'), sideLine(up, 'up')];
  if (d.flip) {
    lines.push(d.spot > d.flip
      ? 'Price is above the gamma flip (' + px(d.flip) + '): dealers tend to calm moves.'
      : 'Price is below the gamma flip (' + px(d.flip) + '): dealers tend to make moves bigger.');
  }
  const fr = d.fragility;
  if (fr && fr.funding && /crowded long/.test(fr.funding)) lines.push('Funding: longs are crowded, which adds fuel to a drop.');
  if (fr && fr.funding && /crowded short/.test(fr.funding)) lines.push('Funding: shorts are crowded, which adds fuel to a squeeze.');

  const urgency = fr && URGENCY[fr.zone] ? Object.assign({ zone: fr.zone, score: fr.score }, URGENCY[fr.zone]) : null;
  return { tone: tone, headline: headline, action: action, lines: lines, urgency: urgency, down: down.state, up: up.state };
}
