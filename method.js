'use strict';
/* method.js — fills the method page from meta.json + receipts.json. */
(function () {
  const C = window.WS;
  const $ = (sel) => document.querySelector(sel);

  function bytes(n) {
    if (n == null) return '\u2014';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + ' KB';
    return n + ' B';
  }

  let meta = null, receipts = null;

  async function boot() {
    meta = await C.loadMeta();
    const c = meta.counts;
    const retrieved = meta.retrieved_at || '';
    const dateShort = retrieved.slice(0, 10);
    $('#vintageLine').textContent = meta.vintage + ' · ' + c.counties.toLocaleString('en-US') +
      ' counties · ' + c.tracts.toLocaleString('en-US') + ' tracts · ' +
      c.blockgroups.toLocaleString('en-US') + ' block groups · retrieved ' + dateShort + '.';
    $('#receiptDate').textContent = dateShort;
    $('#attribDate').textContent = dateShort;

    // variable table from the contract
    $('#varTableBody').innerHTML = meta.variables.map(function (v) {
      const grain = v.bg ? 'tract + block group' : 'tract and larger only';
      return '<tr><td>' + C.esc(v.label) + '</td><td class="mono">' + C.esc(v.id) +
        '</td><td class="small">' + grain + '</td></tr>';
    }).join('');

    try { receipts = await C.loadReceipts(); } catch (e) { receipts = null; }
    if (!receipts || !receipts.requests) {
      $('#receiptsBody').innerHTML = '<tr><td colspan="5" class="muted small">Receipts unavailable in this deployment.</td></tr>';
      return;
    }
    const levels = {};
    receipts.requests.forEach(function (r) {
      const g = levels[r.level] = levels[r.level] || { n: 0, rows: 0, bytes: 0, first: r.fetched_at, last: r.fetched_at };
      g.n += 1; g.rows += r.rows; g.bytes += r.bytes;
      if (r.fetched_at < g.first) g.first = r.fetched_at;
      if (r.fetched_at > g.last) g.last = r.fetched_at;
    });
    const order = ['state', 'county', 'tract', 'blockgroup'];
    $('#receiptsBody').innerHTML = order.filter(k => levels[k]).map(function (k) {
      const g = levels[k];
      return '<tr><td>' + k + '</td><td>' + g.n + '</td><td>' + g.rows.toLocaleString('en-US') +
        '</td><td>' + bytes(g.bytes) + '</td><td class="small">' + g.first.slice(0, 16).replace('T', ' ') +
        ' → ' + g.last.slice(0, 16).replace('T', ' ') + '</td></tr>';
    }).join('');
    $('#ledgerCount').textContent = receipts.requests.length;
    $('#ledgerBody').innerHTML = receipts.requests.slice().sort(function (a, b) {
      return (a.level + a.path).localeCompare(b.level + b.path);
    }).map(function (r) {
      return '<tr><td>' + r.level + '</td><td class="mono">' + C.esc(r.path) + '</td><td>' +
        r.rows.toLocaleString('en-US') + '</td><td>' + bytes(r.bytes) + '</td><td class="mono">' +
        C.esc((r.sha256 || '').slice(0, 12)) + '…</td><td class="small">' + r.fetched_at.slice(0, 19).replace('T', ' ') + '</td></tr>';
    }).join('');
  }

  document.addEventListener('DOMContentLoaded', function () {
    boot().catch(function (err) {
      const box = document.querySelector('main');
      if (box) box.insertAdjacentHTML('afterbegin', '<div class="card">Method page failed to load: ' + C.esc(err.message) + '</div>');
    });
  });
})();
