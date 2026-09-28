'use strict';
/* stats.js — pure display + verdict math for Error Bars.
 *
 * Contract (mirrored in pipeline/variables.py + pipeline/build.py):
 *   record = [geoid, E0, M0, E1, M1, ..., E10, M10]
 * with (Ei, Mi) the estimate + 90%-confidence margin of error for VARS[i].
 *
 * All functions are pure and tested by tests/test_stats.js under node.
 * ACS margins of error are published at 90% confidence, so the standard
 * error is MOE / 1.645.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.WS_Stats = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const Z90 = 1.645;

  function parseNum(raw) {
    if (raw == null) return null;
    const cleaned = String(raw).replace(/[$,\s%]/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    if (!isFinite(n)) return null;
    return n;
  }

  function fmtValue(value, v) {
    if (value == null) return '\u2014';
    const unit = v ? v.unit : null;
    if (unit === 'dollars') return '$' + Math.round(value).toLocaleString('en-US');
    if (unit === 'years') return Number(value).toFixed(1);
    return Math.round(value).toLocaleString('en-US');
  }

  function cvPct(est, moe) {
    if (est == null || moe == null || est <= 0) return null;
    return (moe / Z90) / est * 100;
  }

  /* Reliability flag.
   * Counts: Census guidance on coefficients of variation (CV < 15 reliable,
   * 15-30 use caution, > 30 unreliable).
   * Medians: no official CV rule exists for medians; this is an explicitly
   * labeled display heuristic based on MOE/estimate. */
  function reliability(est, moe, v) {
    if (est == null) {
      return { code: 'na', label: 'No estimate', cls: 'muted', detail: 'The ACS publishes no estimate for this geography.' };
    }
    if (moe == null) {
      return { code: 'nomargin', label: 'No margin published', cls: 'muted',
               detail: 'The ACS publishes no margin of error for this cell \u2014 it marks the margin \u201Cnot applicable.\u201D Without a margin, ranges and the checker are unavailable.' };
    }
    if (v && v.kind === 'count') {
      if (est === 0 && moe > 0) {
        return { code: 'zero', label: 'Not distinguishable from zero', cls: 'warn', cv: null,
                 detail: 'A published zero with a positive margin \u2014 the true value may not be zero.' };
      }
      const cv = cvPct(est, moe);
      if (cv == null) return { code: 'na', label: 'No estimate', cls: 'muted', cv: null, detail: '' };
      const pct = cv.toFixed(0) + '%';
      if (cv < 15) return { code: 'reliable', label: 'Reliable', cls: 'ok', cv,
                            detail: 'Coefficient of variation ' + pct + ' (under 15%) \u2014 counts in this range meet the Census reliability guidance.' };
      if (cv <= 30) return { code: 'caution', label: 'Use caution', cls: 'warn', cv,
                             detail: 'Coefficient of variation ' + pct + ' (15\u201330%) \u2014 use with caution per Census guidance.' };
      return { code: 'unreliable', label: 'Unreliable', cls: 'bad', cv,
               detail: 'Coefficient of variation ' + pct + ' (above 30%) \u2014 the Census treats estimates in this range as unreliable.' };
    }
    const ratio = Math.abs(est) > 0 ? moe / Math.abs(est) : null;
    if (ratio == null) return { code: 'na', label: 'No estimate', cls: 'muted', ratio: null, detail: '' };
    const pct = (ratio * 100).toFixed(0) + '%';
    if (ratio < 0.15) return { code: 'tight', label: 'Tight range', cls: 'ok', ratio,
                               detail: 'Margin is ' + pct + ' of the estimate (display heuristic \u2014 medians have no official CV rule).' };
    if (ratio <= 0.35) return { code: 'moderate', label: 'Moderate range', cls: 'warn', ratio,
                                detail: 'Margin is ' + pct + ' of the estimate (display heuristic \u2014 medians have no official CV rule).' };
    return { code: 'wide', label: 'Wide range', cls: 'bad', ratio,
             detail: 'Margin is ' + pct + ' of the estimate \u2014 read this median as a range (display heuristic; medians have no official CV rule).' };
  }

  function rangeFor(est, moe, v) {
    if (est == null || moe == null) return null;
    let lo = est - moe;
    const hi = est + moe;
    if ((v && v.kind === 'count') || (v && v.unit === 'dollars')) {
      if (lo < 0) lo = 0;
    }
    return { lo: lo, hi: hi, text: fmtValue(lo, v) + ' to ' + fmtValue(hi, v) };
  }

  /* Single-number test: is a published number distinguishable from the
   * Census estimate? Uses the estimate's own margin as the threshold.
   * If the published number has its own sampling error, the two-estimate
   * formula (sqrt(M1^2 + M2^2)) is the right test \u2014 see the method page. */
  function verdict(x, est, moe, v) {
    if (x == null || est == null || moe == null) return null;
    const inside = Math.abs(x - est) <= moe;
    const m = fmtValue(moe, v);
    return {
      inside: inside,
      status: inside ? 'consistent' : 'outside',
      text: inside
        ? 'Within the \u00b1' + m + ' margin \u2014 consistent with this Census estimate.'
        : 'Outside the \u00b1' + m + ' margin \u2014 the gap is larger than this estimate\u2019s sampling error.'
    };
  }

  function zeroVerdict(est, moe) {
    if (est == null || moe == null) return null;
    const nonzero = Math.abs(est) > moe;
    return {
      nonzero: nonzero,
      text: nonzero
        ? 'Statistically different from zero.'
        : 'Not distinguishable from zero at 90% confidence.'
    };
  }

  return {
    Z90: Z90,
    parseNum: parseNum,
    fmtValue: fmtValue,
    cvPct: cvPct,
    reliability: reliability,
    rangeFor: rangeFor,
    verdict: verdict,
    zeroVerdict: zeroVerdict
  };
}));
