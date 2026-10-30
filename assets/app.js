// Tab shell. Each tool is a module exporting mount(el) -> optional cleanup fn.
// Add a tool by adding a line here; routing is by URL hash (#fragility).
const TOOLS = [
  { id: 'fragility', title: 'Fragility', load: function () { return import('../tools/fragility/view.js'); } },
  { id: 'gamma', title: 'Gamma Detrite', load: function () { return import('../tools/placeholder.js'); } },
  { id: 'flow', title: 'Forced Flow', load: function () { return import('../tools/placeholder.js'); } },
  { id: 'mm', title: 'Market Maker', load: function () { return import('../tools/placeholder.js'); } },
];

const tabsEl = document.getElementById('tabs');
const viewEl = document.getElementById('view');
let cleanup = null;

tabsEl.innerHTML = TOOLS.map(function (t) {
  return '<a href="#' + t.id + '" data-id="' + t.id + '">' + t.title + '</a>';
}).join('');

async function route() {
  const id = location.hash.slice(1);
  const tool = TOOLS.find(function (t) { return t.id === id; }) || TOOLS[0];
  Array.prototype.forEach.call(tabsEl.children, function (a) {
    a.classList.toggle('active', a.getAttribute('data-id') === tool.id);
  });
  if (cleanup) { cleanup(); cleanup = null; }
  viewEl.innerHTML = '';
  const mod = await tool.load();
  cleanup = mod.mount(viewEl, { title: tool.title }) || null;
}

window.addEventListener('hashchange', route);
route();
