// Shows another of my GitHub Pages tools inside a tab. The tool stays its own
// repo, so updates there appear here automatically.
export function mount(el, ctx) {
  // GitHub Pages lets phones cache a page for 10 minutes; a fresh query string
  // makes the frame load the latest version each time the site is opened.
  const src = ctx.url + (ctx.url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now();
  el.innerHTML =
    '<iframe class="embed-frame" title="' + ctx.title + '" src="' + src + '" loading="eager"></iframe>' +
    '<div class="embed-bar"><a class="embed-open" href="' + ctx.url + '" target="_blank" rel="noopener">Open full page ↗</a></div>';
}
