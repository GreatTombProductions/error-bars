'use strict';
/* test_stats.js — receiver-effect cases for the shared stats math.
 * Run: node tests/test_stats.js */
const assert = require('assert');
const S = require('../frontend/stats.js');

const dollars = { key: 'med_hh_income', kind: 'median', unit: 'dollars' };
const years = { key: 'median_age', kind: 'median', unit: 'years' };
const persons = { key: 'total_pop', kind: 'count', unit: 'persons' };

// ---- parseNum ----
assert.strictEqual(S.parseNum('$63,700'), 63700);
assert.strictEqual(S.parseNum(' 1,234 '), 1234);
assert.strictEqual(S.parseNum('38.6'), 38.6);
assert.strictEqual(S.parseNum('62%'), 62);
assert.strictEqual(S.parseNum('abc'), null);
assert.strictEqual(S.parseNum(''), null);
assert.strictEqual(S.parseNum('$'), null);

// ---- fmtValue ----
assert.strictEqual(S.fmtValue(1284, persons), '1,284');
assert.strictEqual(S.fmtValue(63700, dollars), '$63,700');
assert.strictEqual(S.fmtValue(38.6, years), '38.6');
assert.strictEqual(S.fmtValue(null, persons), '\u2014');

// ---- cvPct ----
assert.ok(Math.abs(S.cvPct(1000, 100) - 100 / 1.645 / 10) < 1e-9);
assert.strictEqual(S.cvPct(0, 10), null);
assert.strictEqual(S.cvPct(null, 10), null);

// ---- reliability: counts (Census CV guidance) ----
assert.strictEqual(S.reliability(1000, 100, persons).code, 'reliable');   // CV 6.1%
assert.strictEqual(S.reliability(1000, 200, persons).code, 'reliable');   // CV 12.2%
assert.strictEqual(S.reliability(100, 30, persons).code, 'caution');      // CV 18.2%
assert.strictEqual(S.reliability(100, 60, persons).code, 'unreliable');   // CV 36.5%
assert.strictEqual(S.reliability(0, 10, persons).code, 'zero');
assert.strictEqual(S.reliability(null, null, persons).code, 'na');
assert.strictEqual(S.reliability(null, 10, persons).code, 'na');
// margin absent but estimate present -> distinct "no margin published" state
assert.strictEqual(S.reliability(100, null, persons).code, 'nomargin');
assert.strictEqual(S.reliability(100, null, dollars).code, 'nomargin');

// ---- reliability: medians (display heuristic) ----
assert.strictEqual(S.reliability(100, 10, dollars).code, 'tight');
assert.strictEqual(S.reliability(100, 25, dollars).code, 'moderate');
assert.strictEqual(S.reliability(100, 40, dollars).code, 'wide');
assert.ok(/heuristic/.test(S.reliability(100, 40, dollars).detail));

// ---- rangeFor ----
let r = S.rangeFor(1000, 200, persons);
assert.strictEqual(r.lo, 800);
assert.strictEqual(r.hi, 1200);
assert.strictEqual(r.text, '800 to 1,200');
r = S.rangeFor(50, 120, persons);
assert.strictEqual(r.lo, 0);          // counts clamp at zero
assert.strictEqual(r.hi, 170);
r = S.rangeFor(63700, 4200, dollars);
assert.strictEqual(r.text, '$59,500 to $67,900');
assert.strictEqual(S.rangeFor(null, 1, persons), null);

// ---- verdict: number vs estimate ----
let v = S.verdict(700, 823, 312, persons);
assert.strictEqual(v.inside, true);
assert.ok(/consistent/.test(v.text));
v = S.verdict(1300, 823, 312, persons);
assert.strictEqual(v.inside, false);
assert.ok(/Outside/.test(v.text));
assert.strictEqual(S.verdict(700, null, 312, persons), null);
// boundary is inclusive
assert.strictEqual(S.verdict(823 + 312, 823, 312, persons).inside, true);
assert.strictEqual(S.verdict(823 + 312.5, 823, 312, persons).inside, false);
// dollars formatting inside verdict
v = S.verdict(70000, 63700, 4200, dollars);
assert.ok(/\$4,200/.test(v.text));

// ---- zeroVerdict ----
assert.strictEqual(S.zeroVerdict(823, 312).nonzero, true);
assert.strictEqual(S.zeroVerdict(200, 312).nonzero, false);
assert.strictEqual(S.zeroVerdict(null, 312), null);

console.log('[test_stats] all cases passed');
