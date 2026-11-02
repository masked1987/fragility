// Tab shell. Each tool is a module exporting mount(el, ctx) -> optional cleanup fn.
// Add a tool by adding a line here; routing is by URL hash (#fragility).
// Tools are mounted on first visit and then kept alive, so switching is instant.
// Bump V (and the ?v= in index.html) on each update so phones skip stale copies.
const V = '?v=46';
const TOOLS = [
  { id: 'gamma', title: 'Gamma Detrite', short: 'Gamma', full: true, url: 'https://masked1987.github.io/gamma-detrite/', load: function () { return import('../tools/embed.js' + V); } },
  { id: 'fragility', title: 'Fragility', short: 'Score', load: function () { return import('../tools/fragility/view.js' + V); } },
  { id: 'flow', title: 'Forced Flow', short: 'Flow', load: function () { return import('../tools/forced-flow/view.js' + V); } },
  { id: 'mm', title: 'Market Maker', short: 'Dealers', load: function () { return import('../tools/market-maker/view.js' + V); } },
  { id: 'play', title: 'Playbook', short: 'Plan', load: function () { return import('../tools/playbook/view.js' + V); } },
  { id: 'tactics', title: 'Tactics', short: 'Tactics', load: function () { return import('../tools/tactics/view.js' + V); } },
  { id: 'alt', title: 'Alt Tactics', short: 'Alt', load: function () { return import('../tools/alt-tactics/view.js' + V); } },
];

const tabsEl = document.getElementById('tabs');
const viewEl = document.getElementById('view');
const panes = {};

tabsEl.innerHTML = TOOLS.map(function (t) {
  // Phones show the short name (all six fit at 390px), wider screens the full one.
  return '<a href="#' + t.id + '" data-id="' + t.id + '" title="' + t.title + '">' +
    '<span class="t-full">' + t.title + '</span><span class="t-short">' + t.short + '</span></a>';
}).join('');

// Soft fade at an edge only when there are more tabs that way (very narrow phones).
function edgeFade() {
  const more = tabsEl.scrollWidth - tabsEl.clientWidth;
  tabsEl.classList.toggle('more-right', tabsEl.scrollLeft < more - 2);
  tabsEl.classList.toggle('more-left', tabsEl.scrollLeft > 2);
}
tabsEl.addEventListener('scroll', edgeFade, { passive: true });

// Motion (asked Nov 2026): the tab underline glides to the new tab and the page
// slides in from the side you move toward. Short and quick; off when the phone
// asks for reduced motion.
const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const ink = document.createElement('span');
ink.className = 'tab-ink';
tabsEl.appendChild(ink);
let currentId = null;

function moveInk(animate) {
  const a = tabsEl.querySelector('a.active');
  if (!a) return;
  const cs = getComputedStyle(a);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  ink.style.transition = animate && !reduceMotion.matches ? '' : 'none';
  ink.style.width = (a.offsetWidth - padL - padR) + 'px';
  ink.style.transform = 'translateX(' + (a.offsetLeft + padL) + 'px)';
  ink.style.top = (a.offsetTop + a.offsetHeight - 2) + 'px';
  ink.style.opacity = '1';
}

function slideIn(pane, dir) {
  if (!pane.animate || !dir) return;
  const ease = 'cubic-bezier(.16, 1, .3, 1)';
  // Phones set to reduce motion still get a soft fade, just no movement.
  if (reduceMotion.matches) { pane.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' }); return; }
  pane.animate([
    { opacity: 0, transform: 'translateX(' + (dir * 64) + 'px) scale(.985)' },
    { opacity: 1, transform: 'none' },
  ], { duration: 460, easing: ease });
  // Cards rise in one after another (first few only, so it stays quick).
  Array.prototype.slice.call(pane.querySelectorAll('.card'), 0, 5).forEach(function (card, i) {
    card.animate([
      { opacity: 0, transform: 'translateY(18px)' },
      { opacity: 1, transform: 'none' },
    ], { duration: 460, delay: 70 + i * 70, easing: ease, fill: 'backwards' });
  });
}

async function route() {
  const id = location.hash.slice(1);
  const tool = TOOLS.find(function (t) { return t.id === id; }) || TOOLS[0];
  const from = TOOLS.findIndex(function (t) { return t.id === currentId; });
  const to = TOOLS.indexOf(tool);
  const dir = from < 0 || from === to ? 0 : (to > from ? 1 : -1);
  currentId = tool.id;
  Array.prototype.forEach.call(tabsEl.querySelectorAll('a'), function (a) {
    a.classList.toggle('active', a.getAttribute('data-id') === tool.id);
  });
  const on = tabsEl.querySelector('a.active');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  edgeFade();
  moveInk(from >= 0);
  Object.keys(panes).forEach(function (k) { panes[k].hidden = k !== tool.id; });
  if (panes[tool.id]) { slideIn(panes[tool.id], dir); return; }
  const pane = document.createElement('div');
  pane.className = tool.full ? 'pane full' : 'pane wrap';
  viewEl.appendChild(pane);
  panes[tool.id] = pane;
  slideIn(pane, dir);
  const mod = await tool.load();
  mod.mount(pane, { title: tool.title, url: tool.url });
}

// Lets full-height tools size themselves to the space below the tab bar.
function setTopHeight() {
  const h = document.querySelector('.top').offsetHeight;
  document.documentElement.style.setProperty('--avail-h', (window.innerHeight - h) + 'px');
}

// Colour style switcher (top-right corner). Saved per phone in localStorage under
// 'look'; Gamma Detrite reads the same key and follows along (same site address).
const LOOKS = [
  { id: 'teal', name: 'Teal & lime', bg: '#070b0c' },
  { id: 'fire', name: 'Fire', bg: '#0b0706' },
  { id: 'moon', name: 'Blue moonlight', bg: '#05070e' },
];
const lookBtn = document.getElementById('look-btn');
const lookMenu = document.getElementById('look-menu');

function currentLook() {
  return document.documentElement.getAttribute('data-look') || 'teal';
}
function applyLook(id) {
  if (id === 'teal') document.documentElement.removeAttribute('data-look');
  else document.documentElement.setAttribute('data-look', id);
  const look = LOOKS.find(function (l) { return l.id === id; }) || LOOKS[0];
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', look.bg);
  Array.prototype.forEach.call(lookMenu.querySelectorAll('button'), function (b) {
    b.setAttribute('aria-checked', String(b.getAttribute('data-look') === id));
  });
}
function openMenu(open) {
  lookMenu.hidden = !open;
  lookBtn.setAttribute('aria-expanded', String(open));
}
lookMenu.innerHTML = '<div class="look-title">Style</div>' + LOOKS.map(function (l) {
  return '<button type="button" role="menuitemradio" data-look="' + l.id + '">' +
    '<i class="look-sw" data-look="' + l.id + '"></i>' + l.name + '</button>';
}).join('');
// New colours spread out in a circle from the corner dot (View Transitions).
function revealLook(id) {
  if (!document.startViewTransition || reduceMotion.matches) { applyLook(id); return; }
  const r = lookBtn.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const t = document.startViewTransition(function () { applyLook(id); });
  t.ready.then(function () {
    document.documentElement.animate(
      { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + end + 'px at ' + x + 'px ' + y + 'px)'] },
      { duration: 650, easing: 'cubic-bezier(.65, 0, .35, 1)', pseudoElement: '::view-transition-new(root)' });
  }).catch(function () {});
}
lookBtn.addEventListener('click', function (e) { e.stopPropagation(); openMenu(lookMenu.hidden); });
lookMenu.addEventListener('click', function (e) {
  const b = e.target.closest('button[data-look]');
  if (!b) return;
  const id = b.getAttribute('data-look');
  try { if (id === 'teal') localStorage.removeItem('look'); else localStorage.setItem('look', id); } catch (err) {}
  openMenu(false);
  revealLook(id);
});
document.addEventListener('click', function (e) { if (!lookMenu.hidden && !lookMenu.contains(e.target)) openMenu(false); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') openMenu(false); });
applyLook(currentLook());

window.addEventListener('resize', function () { setTopHeight(); edgeFade(); moveInk(false); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { moveInk(false); });
// Reading-card "Details" (shared/head.js): remember open or closed on this phone.
document.addEventListener('toggle', function (e) {
  const d = e.target;
  if (!d.classList || !d.classList.contains('more')) return;
  try { localStorage.setItem('readingOpen', d.open ? '1' : '0'); } catch (err) {}
}, true);
window.addEventListener('hashchange', route);
setTopHeight();
route();
