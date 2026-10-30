// Small fetch helper with a timeout. Works in browsers and Node 18+.
export async function getJson(url, timeoutMs) {
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
