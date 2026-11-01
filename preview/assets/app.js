// Tab shell. Each tool is a module exporting mount(el, ctx) -> optional cleanup fn.
// Add a tool by adding a line here; routing is by URL hash (#fragility).
// Tools are mounted on first visit and then kept alive, so switching is instant.
// Bump V (and the ?v= in index.html) on each update so phones skip stale copies.
const V = '?v=28';
const TOOLS = [
  { id: 'gamma', title: 'Gamma Detrite', full: true, url: 'https://masked1987.github.io/gamma-detrite/preview/', load: function () { return import('../tools/embed.js' + V); } },
  { id: 'fragility', title: 'Fragility', load: function () { return import('../tools/fragility/view.js' + V); } },
  { id: 'flow', title: 'Forced Flow', load: function () { return import('../tools/forced-flow/view.js' + V); } },
  { id: 'mm', title: 'Market Maker', load: function () { return import('../tools/market-maker/view.js' + V); } },
  { id: 'play', title: 'Playbook', load: function () { return import('../tools/playbook/view.js' + V); } },
  { id: 'tactics', title: 'Tactics', load: function () { return import('../tools/tactics/view.js' + V); } },
];

const tabsEl = document.getElementById('tabs');
const viewEl = document.getElementById('view');
const panes = {};

tabsEl.innerHTML = TOOLS.map(function (t) {
  return '<a href="#' + t.id + '" data-id="' + t.id + '">' + t.title + '</a>';
}).join('');

async function route() {
  const id = location.hash.slice(1);
  const tool = TOOLS.find(function (t) { return t.id === id; }) || TOOLS[0];
  Array.prototype.forEach.call(tabsEl.children, function (a) {
    a.classList.toggle('active', a.getAttribute('data-id') === tool.id);
  });
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

window.addEventListener('resize', setTopHeight);
window.addEventListener('hashchange', route);
setTopHeight();
route();
