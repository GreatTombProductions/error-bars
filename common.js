'use strict';
/* common.js — data loading + small helpers for Error Bars. */
window.WS = (function () {
  const DATA_BASE = 'data/';
  const cache = {};

  async function fetchJSON(path) {
    if (cache[path]) return cache[path];
    const resp = await fetch(DATA_BASE + path);
    if (!resp.ok) throw new Error('fetch failed: ' + path + ' (' + resp.status + ')');
    const data = await resp.json();
    cache[path] = data;
    return data;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  let meta = null;
  async function loadMeta() { if (!meta) meta = await fetchJSON('meta.json'); return meta; }
  function loadStates() { return fetchJSON('states.json'); }
  function loadCounties() { return fetchJSON('counties.json'); }
  function loadZipMap() { return fetchJSON('zips.json'); }
  function loadShard(geoid) { return fetchJSON('c/' + geoid + '.json'); }
  function loadLetter(ch) {
    const key = /^[a-z]$/i.test(ch) ? ch.toLowerCase() : 'other';
    return fetchJSON('i/' + key + '.json').catch(() => []);
  }
  function loadReceipts() { return fetchJSON('receipts.json'); }

  /* tract display code: geoid[5:11] = 4-digit tract + 2-digit suffix */
  function tractCode(geoid) {
    const t = geoid.slice(5, 11);
    const base = String(parseInt(t.slice(0, 4), 10));
    return t.slice(4) === '00' ? base : base + '.' + t.slice(4);
  }
  function bgLabel(geoid) { return 'Block Group ' + parseInt(geoid.slice(11, 12), 10); }

  return {
    DATA_BASE: DATA_BASE,
    fetchJSON: fetchJSON,
    esc: esc,
    loadMeta: loadMeta,
    loadStates: loadStates,
    loadCounties: loadCounties,
    loadZipMap: loadZipMap,
    loadShard: loadShard,
    loadLetter: loadLetter,
    loadReceipts: loadReceipts,
    tractCode: tractCode,
    bgLabel: bgLabel
  };
})();
