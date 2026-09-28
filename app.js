'use strict';
/* app.js — Error Bars application: search, county/tract/block-group views,
 * per-stat published-number checker. */
(function () {
  const C = window.WS, S = window.WS_Stats;
  const $ = (sel, el) => (el || document).querySelector(sel);

  let VARS = [];         // meta.variables (field-order contract)
  let meta = null;
  let debounceTimer = null;

  // ---------- small helpers ----------

  function esc(s) { return C.esc(s); }

  function valAt(record, offset, key) {
    const i = VARS.findIndex(v => v.key === key);
    if (i < 0) return [null, null];
    return [record[offset + 2 * i], record[offset + 2 * i + 1]];
  }

  function fmtPair(record, offset, key) {
    const v = VARS.find(x => x.key === key);
    const [E, M] = valAt(record, offset, key);
    if (E == null) return null;
    return S.fmtValue(E, v) + (M == null ? '' : ' \u00b1 ' + S.fmtValue(M, v));
  }

  function summaryLine(record, offset) {
    const bits = [];
    const pop = fmtPair(record, offset, 'total_pop');
    if (pop) bits.push('pop ' + pop);
    const inc = fmtPair(record, offset, 'med_hh_income');
    if (inc) bits.push('income ' + inc);
    const rent = fmtPair(record, offset, 'med_rent');
    if (rent) bits.push('rent ' + rent);
    return bits.length ? '<span class="geo-sum small muted">' + bits.join(' \u00b7 ') + '</span>' : '';
  }

  // ---------- stat cards ----------

  function statCard(v, E, M) {
    const el = document.createElement('div');
    el.className = 'stat';
    const rel = S.reliability(E, M, v);
    const head = '<div class="stat-top"><span class="stat-label">' + esc(v.label) + '</span>' +
      '<span class="badge ' + rel.cls + '" title="' + esc(rel.detail) + '">' + esc(rel.label) + '</span></div>';
    if (E == null) {
      el.innerHTML = head + '<div class="stat-value muted">\u2014 <span class="small muted">no estimate published for this geography</span></div>' +
        '<div class="small muted stat-id">' + esc(v.id) + '</div>';
      return el;
    }
    if (M == null) {
      el.innerHTML = head +
        '<div class="stat-value">' + S.fmtValue(E, v) + ' <span class="muted small">no published margin</span></div>' +
        '<div class="stat-sub small muted">The ACS marks this margin \u201Cnot applicable\u201D \u2014 no range or checker is fabricated.</div>' +
        '<div class="small muted stat-id">' + esc(v.id) + '</div>';
      return el;
    }
    const moeText = M == null ? '' : ' <span class="moe">\u00b1 ' + S.fmtValue(M, v) + '</span>';
    const rng = S.rangeFor(E, M, v);
    const zv = S.zeroVerdict(E, M);
    el.innerHTML = head +
      '<div class="stat-value">' + S.fmtValue(E, v) + moeText + '</div>' +
      (rng ? '<div class="stat-sub small muted">90% confidence range: ' + rng.text +
        (zv ? ' \u00b7 ' + zv.text : '') + '</div>' : '') +
      '<div class="checker"><input type="text" inputmode="decimal" placeholder="Check a published number\u2026" aria-label="Check a published number against this estimate"><span class="verdict small"></span></div>' +
      '<div class="small muted stat-id">' + esc(v.id) + '</div>';
    const input = el.querySelector('input');
    input.addEventListener('input', function () {
      const out = el.querySelector('.verdict');
      const x = S.parseNum(input.value);
      if (x == null) { out.textContent = ''; out.className = 'verdict small'; return; }
      const r = S.verdict(x, E, M, v);
      out.textContent = r.text;
      out.className = 'verdict small ' + (r.inside ? 'v-ok' : 'v-out');
    });
    return el;
  }

  function unsupportedBlock(v) {
    const el = document.createElement('div');
    el.className = 'stat unsupported';
    el.innerHTML = '<div class="stat-top"><span class="stat-label">' + esc(v.label) + '</span>' +
      '<span class="badge muted">Not at this grain</span></div>' +
      '<div class="small muted">ACS does not publish this table (<span class="mono">' + esc(v.id) + '</span>) at block-group level \u2014 only tracts and larger.</div>';
    return el;
  }

  function statGrid(record, offset, grain) {
    const grid = document.createElement('div');
    grid.className = 'statgrid';
    VARS.forEach(function (v) {
      if (grain === 'bg' && !v.bg) { grid.appendChild(unsupportedBlock(v)); return; }
      grid.appendChild(statCard(v, record[offset + 2 * VARS.indexOf(v)], record[offset + 2 * VARS.indexOf(v) + 1]));
    });
    return grid;
  }

  // ---------- geography tree ----------

  function detailSection(title, record, offset, grain, children) {
    const det = document.createElement('details');
    det.className = 'geo ' + grain;
    det.id = record[0];
    const sum = document.createElement('summary');
    sum.innerHTML = '<span class="geo-name">' + esc(title) + '</span>' + summaryLine(record, offset);
    det.appendChild(sum);
    let rendered = false;
    det._ensure = function () {
      if (rendered) return;
      rendered = true;
      const body = document.createElement('div');
      body.className = 'geo-body';
      body.appendChild(statGrid(record, offset, grain));
      if (children) body.appendChild(children);
      det.appendChild(body);
    };
    det.addEventListener('toggle', function () { if (det.open) det._ensure(); });
    return det;
  }

  // ---------- views ----------

  function showHome() {
    $('#home').hidden = false;
    $('#view').hidden = true;
    $('#view').innerHTML = '';
    document.title = 'Error Bars \u2014 small-area statistics with their margins';
  }

  function showView() {
    $('#home').hidden = true;
    $('#view').hidden = false;
    window.scrollTo(0, 0);
  }

  async function renderCounty(geoid) {
    const [countiesData, shard] = await Promise.all([C.loadCounties(), C.loadShard(geoid)]);
    const crow = countiesData.find(r => r[0] === geoid);
    showView();
    const view = $('#view');
    view.innerHTML = '';
    if (!crow) {
      view.innerHTML = '<div class="card">County <span class="mono">' + esc(geoid) + '</span> not found.</div>';
      return;
    }
    const name = crow[1] + ', ' + crow[3];
    document.title = name + ' \u2014 Error Bars';

    const back = document.createElement('a');
    back.href = '#';
    back.className = 'back small';
    back.textContent = '\u2190 Check another place';

    const h = document.createElement('h1');
    h.textContent = name;

    const sub = document.createElement('p');
    sub.className = 'muted small';
    sub.innerHTML = '2024 ACS 5-year estimates, with the Census\u2019s published margins of error. ' +
      'Every estimate below is really a range; the badge reflects how wide.';

    const card = document.createElement('div');
    card.className = 'card';
    card.appendChild(statGrid(crow, 4, 'county'));

    const tracts = (shard.t || []).slice().sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const bgsByTract = {};
    (shard.b || []).forEach(function (b) {
      const tk = b[0].slice(0, 11);
      (bgsByTract[tk] = bgsByTract[tk] || []).push(b);
    });
    const list = document.createElement('div');
    list.className = 'geolist';
    const h2 = document.createElement('h2');
    h2.textContent = 'Census tracts and block groups';
    if (!tracts.length) {
      list.innerHTML = '<div class="muted small">No tract records for this county.</div>';
    }
    tracts.forEach(function (t) {
      const kids = document.createElement('div');
      (bgsByTract[t[0]] || []).sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(function (b) {
        kids.appendChild(detailSection(C.bgLabel(b[0]), b, 1, 'bg'));
      });
      list.appendChild(detailSection('Census Tract ' + C.tractCode(t[0]), t, 1, 'tract', kids.children.length ? kids : null));
    });

    view.append(back, h, sub, card, h2, list);

    const g = (location.hash.match(/[?&]g=(\d+)/) || [])[1];
    if (g) {
      let el = document.getElementById(g);
      if (!el && g.length === 12) {
        // block groups live lazily inside their (closed) tract — open the
        // parent tract first so the BG element exists
        const tractEl = document.getElementById(g.slice(0, 11));
        if (tractEl) { tractEl._ensure(); tractEl.open = true; el = document.getElementById(g); }
      }
      if (el) {
        el._ensure();
        el.open = true;
        setTimeout(function () { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
      }
    }
  }

  // ---------- search ----------

  async function doSearch(v) {
    const box = $('#results');
    if (!v) { box.innerHTML = ''; return; }
    if (/^\d{5}$/.test(v)) { await zipSearch(v, box); return; }
    if (v.length < 2) { box.innerHTML = '<div class="muted small">Type at least two characters (or a 5-digit ZIP).</div>'; return; }
    box.innerHTML = '<div class="muted small">Searching\u2026</div>';
    const rows = await C.loadLetter(v[0]);
    const q = v.toLowerCase();
    const hits = rows.filter(r => r[1].toLowerCase().includes(q)).slice(0, 40);
    if (!hits.length) {
      box.innerHTML = '<div class="muted small">No county matches \u201c' + esc(v) + '\u201d.</div>';
      return;
    }
    box.innerHTML = '<div class="reslist">' + hits.map(r =>
      '<a class="row" href="#county=' + r[0] + '">' + esc(r[1]) + ', ' + esc(r[2]) +
      ' <span class="muted small">\u2192</span></a>').join('') + '</div>';
  }

  async function zipSearch(zip, box) {
    box.innerHTML = '<div class="muted small">Looking up ZIP\u2026</div>';
    const zmap = await C.loadZipMap();
    const list = zmap[zip];
    if (!list) {
      box.innerHTML = '<div class="muted small">ZIP ' + esc(zip) + ' not found in the ZCTA\u2013county crosswalk (ZIPs are matched to counties by land-area overlap).</div>';
      return;
    }
    const countiesData = await C.loadCounties();
    const rows = list.map(function (gid) {
      const r = countiesData.find(x => x[0] === gid);
      return r ? '<a class="row" href="#county=' + r[0] + '">' + esc(r[1]) + ', ' + esc(r[3]) + '</a>' : '';
    }).join('');
    box.innerHTML = '<div class="small muted">ZIP ' + esc(zip) + ' overlaps ' + list.length +
      ' county' + (list.length > 1 ? 'ies' : '') + ' (by land area, primary first):</div><div class="reslist">' + rows + '</div>';
  }

  // ---------- state browse ----------

  async function initStateSelect() {
    const [states, countiesData] = await Promise.all([C.loadStates(), C.loadCounties()]);
    const sel = $('#stateSel');
    sel.innerHTML = '<option value="">Browse by state\u2026</option>' +
      states.map(s => '<option value="' + s[0] + '">' + esc(s[1]) + '</option>').join('');
    sel.addEventListener('change', function () {
      const listBox = $('#stateList');
      if (!sel.value) { listBox.innerHTML = ''; return; }
      const rows = countiesData.filter(r => r[2] === sel.value);
      listBox.innerHTML = rows.map(r =>
        '<a class="row" href="#county=' + r[0] + '">' + esc(r[1]) + '</a>').join('');
    });
  }

  // ---------- routing / boot ----------

  async function route() {
    const m = location.hash.match(/county=(\d{5})/);
    if (m) { await renderCounty(m[1]); }
    else { showHome(); }
  }

  async function boot() {
    meta = await C.loadMeta();
    VARS = meta.variables;
    const c = meta.counts;
    $('#metaLine').innerHTML = esc(meta.vintage) + ' \u00b7 ' + c.counties.toLocaleString('en-US') +
      ' counties \u00b7 ' + c.tracts.toLocaleString('en-US') + ' tracts \u00b7 ' +
      c.blockgroups.toLocaleString('en-US') + ' block groups \u00b7 retrieved ' +
      (meta.retrieved_at || '').slice(0, 10);
    $('#q').addEventListener('input', function () {
      clearTimeout(debounceTimer);
      const v = $('#q').value.trim();
      debounceTimer = setTimeout(function () { doSearch(v); }, 130);
    });
    window.addEventListener('hashchange', route);
    await initStateSelect();
    await route();
  }

  document.addEventListener('DOMContentLoaded', function () {
    boot().catch(function (err) {
      const box = $('#results') || document.body;
      box.innerHTML = '<div class="card">Failed to load: ' + esc(err.message) + '</div>';
    });
  });
})();
