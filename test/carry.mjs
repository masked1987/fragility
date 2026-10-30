// Run: node test/carry.mjs  — offline checks of the theta vs gamma dollars (no network).
import assert from 'node:assert/strict';
import { carry, expiryGroup } from '../tools/market-maker/model.js';

const now = Date.UTC(2026, 9, 30, 12);
const day = 864e5;
const S = 2000;
const opt = function (type, strike, days, iv, oi) { return { type: type, strike: strike, expiry: now + days * day, iv: iv, oi: oi }; };
const near = function (a, b, tol) { assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), a + ' vs ' + b); };

// Black-Scholes call price, zero rates, to check theta against a real one-day decay.
function N(x) { // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
function call(S, K, T, v) {
  const d1 = (Math.log(S / K) + v * v * T / 2) / (v * Math.sqrt(T));
  return S * N(d1) - K * N(d1 - v * Math.sqrt(T));
}

// 1. Dealers short a put (customers bought it): implied 60 > realized 40 -> they earn.
let c = carry([opt('P', 2000, 30, 0.6, 1000)], S, now, 40);
assert.ok(c.total.theta > 0 && c.total.hedge < 0 && c.total.net > 0, 'short gamma, implied > realized: net must be positive');
// Net is exactly ½·Γ$·(σi² − σr²)/365, so the ratio theta : hedge is 0.36 : 0.16.
near(c.total.theta / -c.total.hedge, 0.36 / 0.16, 1e-9);

// 2. Same put, realized 80 > implied 60 -> they lose.
c = carry([opt('P', 2000, 30, 0.6, 1000)], S, now, 80);
assert.ok(c.total.net < 0, 'short gamma, realized > implied: net must be negative');

// 3. Implied equals realized -> break-even.
c = carry([opt('P', 2000, 30, 0.6, 1000)], S, now, 60);
near(c.total.net, 0, 1e-9);

// 4. Dealers long a call: pay decay, earn re-hedging; flips the sign of case 1.
c = carry([opt('C', 2000, 30, 0.6, 1000)], S, now, 40);
assert.ok(c.total.theta < 0 && c.total.hedge > 0 && c.total.net < 0, 'long gamma, implied > realized: net must be negative');

// 5. A call and a put at the same strike cancel under the dealer convention.
c = carry([opt('C', 2000, 30, 0.6, 1000), opt('P', 2000, 30, 0.6, 1000)], S, now, 40);
near(c.total.net, 0, 1e-9);
near(c.total.gamma, 0, 1e-9);

// 6. Theta matches how much a real 30-day call loses in one day (price unchanged).
const decay = (call(S, 2000, 30 / 365, 0.6) - call(S, 2000, 29 / 365, 0.6)) * 1000;
c = carry([opt('C', 2000, 30, 0.6, 1000)], S, now, 0);
near(-c.total.theta, decay, 0.01); // within 1%

// 7. An option expiring in 2 hours counts for 2 hours, not a whole day.
const a = carry([opt('P', 2000, 1, 0.6, 1000)], S, now, 40).total.theta;
const b = carry([opt('P', 2000, 2 / 24, 0.6, 1000)], S, now, 40).total.theta;
assert.ok(b < a, 'a 2-hour option should collect less than a 1-day one');
// Already expired options are ignored.
assert.equal(carry([opt('P', 2000, -1, 0.6, 1000)], S, now, 40).total.net, 0);

// 8. Expiry groups, using Deribit's 08:00 UTC settlement.
const e = function (y, m, d) { return Date.UTC(y, m, d, 8); };
assert.equal(expiryGroup(e(2026, 9, 31)), 'daily');      // Sat 31 Oct
assert.equal(expiryGroup(e(2026, 10, 6)), 'weekly');     // Fri 6 Nov
assert.equal(expiryGroup(e(2026, 10, 27)), 'monthly');   // last Fri of Nov
assert.equal(expiryGroup(e(2026, 11, 25)), 'quarterly'); // last Fri of Dec
assert.equal(expiryGroup(e(2027, 0, 29)), 'monthly');    // last Fri of Jan
assert.equal(expiryGroup(e(2027, 2, 26)), 'quarterly');  // last Fri of Mar
assert.equal(expiryGroup(e(2027, 2, 19)), 'weekly');     // Fri 19 Mar

// 9. Vega: dealers short a put lose when implied vol rises, long a call gain.
const v = carry([opt('C', 2000, 30, 0.6, 1000)], S, now, 40).total;
const bump = (call(S, 2000, 30 / 365, 0.61) - call(S, 2000, 30 / 365, 0.6)) * 1000;
near(v.vega, bump, 0.01); // matches repricing the call 1 point higher, within 1%
assert.ok(carry([opt('P', 2000, 30, 0.6, 1000)], S, now, 40).total.vega < 0, 'short put: negative vega');
near(carry([opt('C', 2000, 30, 0.6, 1000), opt('P', 2000, 30, 0.6, 1000)], S, now, 40).total.vega, 0, 1e-9);
// A 30-day option moves 1:1 with 30-day vol; a 7.5-day one twice as much; a 120-day one half.
near(v.vegaW, v.vega, 1e-9);
let w = carry([opt('C', 2000, 7.5, 0.6, 1000)], S, now, 40).total;
near(w.vegaW, 2 * w.vega, 1e-9);
w = carry([opt('C', 2000, 120, 0.6, 1000)], S, now, 40).total;
near(w.vegaW, 0.5 * w.vega, 1e-9);

// 10. Groups add up to the total.
c = carry([opt('P', 2000, 1, 0.6, 500), opt('C', 2100, 7, 0.55, 800), opt('P', 1800, 28, 0.65, 900)], S, now, 50);
near(c.groups.reduce(function (s, g) { return s + g.net; }, 0), c.total.net, 1e-9);
near(c.groups.reduce(function (s, g) { return s + g.vegaW; }, 0), c.total.vegaW, 1e-9);

console.log('carry: all checks passed');
