// Tab shell. Each tool is a module exporting mount(el, ctx) -> optional cleanup fn.
// Add a tool by adding a line here; routing is by URL hash (#fragility).
// Tools are mounted on first visit and then kept alive, so switching is instant.
// Bump V (and the ?v= in index.html) on each update so phones skip stale copies.
const V = '?v=29';
const TOOLS = [
  { id: 'gamma', title: 'Gamma Detrite', short: 'Gamma', full: true, url: 'https://masked1987.github.io/gamma-detrite/', load: function () { return import('../tools/embed.js' + V); } },
  { id: 'fragility', title: 'Fragility', short: 'Score', load: function () { return import('../tools/fragility/view.js' + V); } },
  { id: 'flow', title: 'Forced Flow', short: 'Flow', load: function () { return import('../tools/forced-flow/view.js' + V); } },
  { id: 'mm', title: 'Market Maker', short: 'Dealers', load: function () { return import('../tools/market-maker/view.js' + V); } },
  { id: 'play', title: 'Playbook', short: 'Plan', load: function () { return import('../tools/playbook/view.js' + V); } },
  { id: 'tactics', title: 'Tactics', short: 'Tactics', load: function () { return import('../tools/tactics/view.js' + V); } },
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

async function route() {
  const id = location.hash.slice(1);
  const tool = TOOLS.find(function (t) { return t.id === id; }) || TOOLS[0];
  Array.prototype.forEach.call(tabsEl.children, function (a) {
    a.classList.toggle('active', a.getAttribute('data-id') === tool.id);
  });
  const on = tabsEl.querySelector('a.active');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  edgeFade();
  Object.keys(panes).forEach(function (k) { panes[k].hidden = k !== tool.id; });
  if (panes[tool.id]) return;
  const pane = document.createElement('div');
  pane.className = tool.full ? 'pane full' : 'pane wrap';
  viewEl.appendChild(pane);
  panes[tool.id] = pane;
  const mod = await tool.load();
  mod.mount(pane, { title: tool.title, url: tool.url });
}

// Lets full-height tools size themselves to the space below the tab bar.
function setTopHeight() {
  const h = document.querySelector('.top').offsetHeight;
  document.documentElement.style.setProperty('--avail-h', (window.innerHeight - h) + 'px');
}

window.addEventListener('resize', function () { setTopHeight(); edgeFade(); });
window.addEventListener('hashchange', route);
setTopHeight();
route();
