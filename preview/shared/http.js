// Small fetch helper with a timeout. Works in browsers and Node 18+.
// Identical requests within CACHE_MS share one response, so tabs that need
// the same data (e.g. Deribit options) don't download it twice.
const CACHE_MS = 60e3;
const cache = {};

export function getJson(url, timeoutMs) {
  const hit = cache[url];
  if (hit && Date.now() - hit.t < CACHE_MS) return hit.p;
  const p = fetchJson(url, timeoutMs);
  cache[url] = { t: Date.now(), p: p };
  p.catch(function () { delete cache[url]; });
  return p;
}

async function fetchJson(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('timeout');
    // Browsers report region blocks and missing CORS headers as a bare TypeError.
    if (e instanceof TypeError) throw new Error('unreachable (region block or CORS)');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
