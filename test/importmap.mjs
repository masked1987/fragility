// Offline check: every browser module in tools/ and shared/ (except the view.js
// files, which app.js already loads with ?v=) is in the cache-busting list in
// index.html, and nothing in the list is missing. Run: node test/importmap.mjs
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function walk(dir) {
  return readdirSync(dir).flatMap(function (n) {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.js') ? [p] : []);
  });
}
const onDisk = walk('tools').concat(walk('shared')).filter(function (p) { return !p.endsWith('/view.js'); }).sort();
const html = readFileSync('index.html', 'utf8');
const listed = [...html.matchAll(/^\s+'((?:tools|shared)\/[^']+\.js)',$/gm)].map(function (m) { return m[1]; }).sort();
const missing = onDisk.filter(function (p) { return !listed.includes(p); });
const extra = listed.filter(function (p) { return !onDisk.includes(p); });
const v1 = /assets\/style\.css\?v=(\d+)/.exec(html)[1], v2 = /assets\/app\.js\?v=(\d+)/.exec(html)[1];
const v3 = /const V = '\?v=(\d+)'/.exec(readFileSync('assets/app.js', 'utf8'))[1];
let ok = true;
if (missing.length) { console.log('Not in the index.html list:', missing.join(', ')); ok = false; }
if (extra.length) { console.log('Listed but not on disk:', extra.join(', ')); ok = false; }
if (!(v1 === v2 && v2 === v3)) { console.log('Versions differ: style.css', v1, 'index app.js', v2, 'app.js V', v3); ok = false; }
console.log(ok ? 'importmap ok (' + listed.length + ' modules, v=' + v1 + ')' : 'importmap FAILED');
process.exit(ok ? 0 : 1);
