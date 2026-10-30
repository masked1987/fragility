// Options gamma exposure. Shared so the Gamma Detrite tab can reuse it.
//
// Dealer convention ("naive GEX"): dealers are assumed long the calls and
// short the puts that customers trade. Positive net = dealers long gamma
// (their hedging dampens moves); negative = short gamma (hedging amplifies).

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const YEAR_MS = 365 * 864e5;

export function bsGamma(S, K, T, iv) {
  if (T <= 0 || iv <= 0) return 0;
  const v = iv * Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * iv * iv * T) / v;
  return Math.exp(-0.5 * d1 * d1) / SQRT_2PI / (S * v);
}

// USD of delta dealers must trade per 1% move, if spot were `spot`.
export function gex(options, spot, now) {
  let calls = 0, puts = 0;
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    const T = (o.expiry - now) / YEAR_MS;
    if (T <= 0) continue;
    const g = bsGamma(spot, o.strike, T, o.iv) * o.oi * spot * spot * 0.01;
    if (o.type === 'C') calls += g; else puts += g;
  }
  return { net: calls - puts, gross: calls + puts, calls: calls, puts: puts };
}

// Price nearest to spot where net GEX changes sign, or null within +/- range.
export function gammaFlip(options, spot, now, range, steps) {
  range = range || 0.15;
  steps = steps || 60;
  let best = null, prev = null;
  for (let i = 0; i <= steps; i++) {
    const price = spot * (1 - range + 2 * range * i / steps);
    const net = gex(options, price, now).net;
    if (prev && (prev.net < 0) !== (net < 0)) {
      const cross = prev.price + (price - prev.price) * (prev.net / (prev.net - net));
      if (best === null || Math.abs(cross - spot) < Math.abs(best - spot)) best = cross;
    }
    prev = { price: price, net: net };
  }
  return best;
}
