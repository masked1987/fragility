// Run by the workflow when test_alerts = 'check' (asked 2 Nov 2026 after "I didn't
// receive anything"): is the phone-alert topic clean, what does ntfy hold on it, and
// does one plain message arrive? Never prints the topic itself (it is a secret).
const raw = process.env.NTFY_TOPIC || '';
if (!raw) { console.log('NTFY_TOPIC is empty: the repo secret is missing.'); process.exit(0); }
const topic = raw.trim();
console.log(`Topic: ${raw.length} characters` + (raw !== topic ? ` -- has ${raw.length - topic.length} space / line-break character(s) at the start or end!` : ', no spaces or line breaks at the ends'));
if (/\s/.test(topic)) console.log('Topic has a space or line break in the middle: the app would subscribe to a different name.');
if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) console.log('Topic has characters ntfy topics normally do not use (only letters, digits, - and _ are allowed).');

const url = 'https://ntfy.sh/' + encodeURIComponent(raw); // exactly what jobs/monitor.mjs posts to
const uk = t => new Date(t * 1000).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
async function held(label) {
  const r = await fetch(url + '/json?poll=1&since=24h&sched=1');
  const lines = (await r.text()).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(m => m.event === 'message');
  console.log(`\n${label}: ntfy holds ${lines.length} message(s) from the last 24 h on this topic (HTTP ${r.status})`);
  lines.slice(-25).forEach(m => console.log(`  ${uk(m.time)} UK  prio ${m.priority || 3}  ${m.title || '(no title)'}`));
  return lines.length;
}
await held('Before');
const res = await fetch(url, { method: 'POST', body: 'If you can read this, phone alerts reach you. Sent ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC.',
  headers: { Title: 'ntfy check', Priority: '4', Tags: 'white_check_mark' } });
console.log(`\nSent one plain message "ntfy check": HTTP ${res.status}`);
await new Promise(r => setTimeout(r, 2000));
await held('After');
