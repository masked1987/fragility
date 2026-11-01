// Plain-English reading for the Tactics tab. Pure, runs in Node too.
function px(x) { return '~' + Math.round(x).toLocaleString('en-US'); }
export function money(v) {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  return a >= 1e6 ? s + '$' + (a / 1e6).toFixed(1) + 'M' : s + '$' + Math.round(a / 1e3) + 'k';
}

const NAMES = { level: 'Retest of the pivot', flow: 'Order flow', va: 'Value area', drift: 'Option premium', gamma: 'Dealer gamma' };

// One line per check, with a state: 'ok', 'no' or 'wait' (not known yet).
export function checkLines(d, cfg) {
  const s = d.setup, short = s.side === 'short', P = s.pivot;
  return s.checks.map(function (c) {
    let text;
    if (c.key === 'level') {
      text = c.ok ? 'Price came back to the ' + px(P) + ' pivot in the last ' + cfg.retestCandles * cfg.candleMinutes + ' minutes and is holding ' + (short ? 'below' : 'above') + ' it.'
        : 'Price is ' + Math.round(Math.abs(d.spot - P)).toLocaleString('en-US') + ' points ' + (short ? 'below' : 'above') + ' the ' + px(P) + ' pivot. No retest yet.';
    } else if (c.key === 'flow') {
      text = c.ok == null ? 'Checked once price reaches the pivot.'
        : c.ok ? [c.exhausted ? (short ? 'buyers ran out at the high (exhaustion)' : 'sellers ran out at the low (exhaustion)') : null,
            c.stepping ? (short ? 'sellers stepped in' : 'buyers stepped in') : null].filter(Boolean).join(' and ').replace(/^./, function (x) { return x.toUpperCase(); }) + '.'
        : 'No sign yet of ' + (short ? 'buyers running out or sellers stepping in' : 'sellers running out or buyers stepping in') + ' at the pivot.';
    } else if (c.key === 'va') {
      text = c.ok == null ? 'Session volume profile unavailable.'
        : 'The pivot ' + (c.ok ? 'lines up with' : 'is not at') + ' the session value area ' + (short ? 'high' : 'low') + ' (' + px(c.edge) + ').';
    } else if (c.key === 'drift') {
      const dr = d.drift;
      text = c.ok == null ? 'Option premium unavailable.'
        : 'Net premium: calls ' + money(dr.calls) + ', puts ' + money(dr.puts) + '. ' +
          (c.ok ? (short ? 'Put-heavy, so sentiment is bearish.' : 'Call-heavy, so sentiment is bullish.') : 'Not leaning ' + (short ? 'bearish' : 'bullish') + '.');
    } else {
      text = c.ok == null ? 'No gamma flip nearby.'
        : 'Price is ' + (d.spot < d.flip ? 'below' : 'above') + ' the gamma flip (' + px(d.flip) + '): dealers ' +
          (d.spot < d.flip ? 'add to moves.' : 'lean against moves.') + (c.ok ? '' : ' That works against this side.');
    }
    return { key: c.key, name: NAMES[c.key], state: c.ok === true ? 'ok' : c.ok === false ? 'no' : 'wait', text: text };
  });
}

export function readTac(d, cfg) {
  const s = d.setup;
  if (s.status === 'none') {
    return { tone: 'wait', headline: 'No big gamma node within ±' + cfg.pivotRangePct + '%: no pivot to trade',
      action: 'This tactic needs a clear dealer gamma level near the price. Without one, sit out.' };
  }
  const short = s.side === 'short', P = px(s.pivot);
  const ok = s.checks.filter(function (c) { return c.ok === true; }).length;
  if (s.status === 'ready') {
    return { tone: short ? 'short' : 'long', headline: (short ? 'Short' : 'Long') + ' setup ready at the ' + P + ' pivot: ' + ok + ' of 5 confirm',
      action: 'This is the setup from the video. ' + (short ? 'Sell' : 'Buy') + ' near ' + px(s.entry) + ' with the stop just ' + (short ? 'above' : 'below') +
        ' the retest at ' + px(s.stop) + '. If price closes back ' + (short ? 'above' : 'below') + ' the pivot, the idea is wrong: get out.' };
  }
  if (s.status === 'building') {
    return { tone: 'build', headline: 'Retesting the ' + P + ' pivot: ' + ok + ' of 5 confirm, not ready',
      action: 'Price is at the level, but the order flow or the other confirmations are missing. Wait for ' +
        (short ? 'sellers to step in or buyers to run out' : 'buyers to step in or sellers to run out') + ' on the next 15-minute candle.' };
  }
  return { tone: 'wait', headline: 'Watching the ' + P + ' pivot: ' + (short ? 'short on a rejected retest' : 'long on a held retest'),
    action: 'No trade until price comes back to ' + P + '. Then check the order flow: ' +
      (short ? 'sellers stepping in or buyers running out' : 'buyers stepping in or sellers running out') + ' is the trigger.' };
}
