// Shows another of my GitHub Pages tools inside a tab. The tool stays its own
// repo, so updates there appear here automatically.
export function mount(el, ctx) {
  el.innerHTML =
    '<iframe class="embed-frame" title="' + ctx.title + '" src="' + ctx.url + '" loading="eager"></iframe>' +
    '<div class="embed-bar"><a class="embed-open" href="' + ctx.url + '" target="_blank" rel="noopener">Open full page ↗</a></div>';
}
