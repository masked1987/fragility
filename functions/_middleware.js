// Cloudflare Pages only (GitHub Pages ignores this folder). Two jobs:
// 1. Locks the whole site behind one password. After the right password the
//    phone keeps a cookie for a year, so it is asked once per phone/browser.
// 2. Serves the files that live in the private GitHub repos (the job's data
//    and the Gamma Detrite page), which a browser can no longer read directly.
// Settings in Cloudflare (Pages project → Settings → Variables and secrets):
//   SITE_PASSWORD  the password (changing it logs every phone out)
//   GH_TOKEN       a read-only GitHub token for masked1987/fragility and /gamma-detrite

const COOKIE = 'fx_auth';
const YEAR = 60 * 60 * 24 * 365;
const OWNER = 'masked1987';

// Path on this site → private repo file. Only these are served.
const ROUTES = [
  { prefix: '/gh/fragility/data/', repo: 'fragility', ref: 'data', only: ['log.csv', 'state.json', 'vanna-log.csv'] },
  { prefix: '/gamma-detrite/', repo: 'gamma-detrite', ref: 'main' },
];

const TYPES = {
  html: 'text/html; charset=utf-8', json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8', js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon',
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function cookieOf(request, name) {
  const all = request.headers.get('Cookie') || '';
  for (const part of all.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; });
}

function loginPage(next, wrong) {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">' +
    '<title>Locked</title><style>' +
    ':root{color-scheme:dark light;--bg:#0b0f12;--card:#131a1f;--line:#24313a;--text:#e8f0f2;--dim:#93a4ad;--accent:#2dd4bf;--bad:#f87171}' +
    '@media (prefers-color-scheme:light){:root{--bg:#f3f6f7;--card:#fff;--line:#d5dee2;--text:#10181c;--dim:#56656d;--accent:#0f9488;--bad:#c0392b}}' +
    '*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);' +
    'font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}' +
    'form{width:100%;max-width:360px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:24px}' +
    'h1{margin:0 0 4px;font-size:22px}p{margin:0 0 18px;color:var(--dim);font-size:14px}' +
    'input{width:100%;font:inherit;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--text)}' +
    'input:focus{outline:2px solid var(--accent);outline-offset:1px}' +
    'button{margin-top:12px;width:100%;font:inherit;font-weight:600;padding:12px;border:0;border-radius:12px;background:var(--accent);color:#04120f}' +
    '.bad{color:var(--bad);margin:10px 0 0;font-size:14px}</style></head><body>' +
    '<form method="post" action="/login"><h1>Private site</h1><p>Enter the password to open it. This phone will remember it.</p>' +
    '<input type="hidden" name="next" value="' + esc(next) + '">' +
    '<input type="password" name="password" autocomplete="current-password" placeholder="Password" required autofocus>' +
    '<button type="submit">Open</button>' + (wrong ? '<p class="bad">Wrong password.</p>' : '') + '</form>' +
    // The #tab part of the address never reaches the server; keep it so the same tab opens.
    '<script>var n=document.querySelector("[name=next]");if(location.hash&&n.value.indexOf("#")<0)n.value+=location.hash;</script>' +
    '</body></html>';
  return new Response(html, {
    status: 401,
    headers: { 'Content-Type': TYPES.html, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

function safeNext(v) {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/';
}

async function fromGitHub(route, rest, env) {
  if (!env.GH_TOKEN) return new Response('GH_TOKEN is not set in Cloudflare', { status: 503 });
  let path = decodeURIComponent(rest);
  if (path === '' || path.endsWith('/')) path += 'index.html';
  if (path.split('/').some(function (p) { return p === '..' || p.startsWith('.'); })) return new Response('Not found', { status: 404 });
  if (route.only && !route.only.includes(path)) return new Response('Not found', { status: 404 });
  const api = 'https://api.github.com/repos/' + OWNER + '/' + route.repo + '/contents/' +
    path.split('/').map(encodeURIComponent).join('/') + '?ref=' + route.ref;
  const r = await fetch(api, {
    headers: {
      Authorization: 'Bearer ' + env.GH_TOKEN,
      Accept: 'application/vnd.github.raw',
      'User-Agent': 'fragility-site',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!r.ok) return new Response('Not found', { status: r.status === 404 ? 404 : 502 });
  const ext = (path.split('.').pop() || '').toLowerCase();
  return new Response(r.body, {
    status: 200,
    headers: {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  if (!env.SITE_PASSWORD) {
    return new Response('Locked: SITE_PASSWORD is not set in Cloudflare yet.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const token = await sha256('fragility|' + env.SITE_PASSWORD);
  const secure = 'Path=/; HttpOnly; Secure; SameSite=Lax';

  if (url.pathname === '/login' && request.method === 'POST') {
    const form = await request.formData();
    const pw = String(form.get('password') || '');
    const to = safeNext(String(form.get('next') || '/'));
    if (same(await sha256('fragility|' + pw), token)) {
      return new Response(null, {
        status: 303,
        headers: { Location: to, 'Set-Cookie': COOKIE + '=' + token + '; Max-Age=' + YEAR + '; ' + secure, 'Cache-Control': 'no-store' },
      });
    }
    await new Promise(function (r) { setTimeout(r, 1500); }); // slows down guessing
    return loginPage(to, true);
  }

  if (url.pathname === '/logout') {
    return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': COOKIE + '=; Max-Age=0; ' + secure } });
  }

  if (!same(cookieOf(request, COOKIE), token)) {
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
    return loginPage(url.pathname + url.search, false);
  }

  for (const route of ROUTES) {
    if (url.pathname === route.prefix.slice(0, -1)) return Response.redirect(url.origin + route.prefix, 301);
    if (url.pathname.startsWith(route.prefix)) return fromGitHub(route, url.pathname.slice(route.prefix.length), env);
  }

  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set('X-Robots-Tag', 'noindex');
  return out;
}
