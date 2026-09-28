'use strict';
/* browser_smoke.js — receiver smoke for Error Bars.
 * Run via tests/run_browser_smoke.py (stages the site + serves locally),
 * or against the deployed URL with SMOKE_BASE set. */

const assert = require('assert');
const { chromium } = require('playwright');

(async () => {
  const base = process.env.SMOKE_BASE || 'http://127.0.0.1:8765/';
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));

    // ---- index + county search ----
    let response = await page.goto(base, { waitUntil: 'networkidle' });
    assert(response.ok(), `index returned ${response.status()}`);
    await page.waitForFunction(() => /2024 ACS/.test(document.getElementById('metaLine').textContent));

    await page.fill('#q', 'Cook');
    await page.waitForSelector('#results .row', { timeout: 30000 });
    const cookRow = await page.evaluateHandle(() =>
      [...document.querySelectorAll('#results .row')].find((el) => el.textContent.includes('Cook County, IL')));
    assert(cookRow.asElement(), 'expected a "Cook County, IL" result row');
    await cookRow.asElement().click();
    await page.waitForFunction(() => {
      const h = document.querySelector('#view h1');
      return !!h && /Cook County, IL/.test(h.textContent);
    }, null, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll('#view .stat').length === 11);
    const badges = await page.$$eval('#view .stat .badge', (els) => els.map((e) => e.textContent));
    assert(badges.some((b) => /Reliable|Use caution|Unreliable|Tight|Moderate|Wide/.test(b)),
      `expected reliability badges, saw: ${badges.join(',')}`);
    // most county population margins are "not applicable" in the ACS — the
    // card must say "no published margin" rather than invent one
    const popCard = await page.evaluateHandle(() =>
      [...document.querySelectorAll('#view .stat')].find(
        (el) => el.querySelector('.stat-label').textContent.includes('Total population')));
    const popText = await popCard.asElement().textContent();
    assert(/no published margin/.test(popText), `population card should flag the missing margin: "${popText}"`);

    // ---- checker: consistent vs outside ----
    const card = await page.evaluateHandle(() => {
      return [...document.querySelectorAll('#view .stat')].find(
        (el) => el.querySelector('.stat-label').textContent.includes('Median household income'));
    });
    const valueText = await (await card.asElement().$('.stat-value')).textContent();
    const est = Number((valueText.match(/([\d,]+)/) || [])[1].replace(/,/g, ''));
    assert(est > 1000, `unexpected income estimate "${valueText}"`);
    const input = await card.asElement().$('.checker input');
    await input.fill(String(Math.round(est + 1)));
    await page.waitForFunction(() =>
      !!document.querySelector('#view .stat .verdict.v-ok'), null, { timeout: 15000 });
    await input.fill(String(Math.round(est * 5)));
    await page.waitForFunction(() =>
      !!document.querySelector('#view .stat .verdict.v-out'), null, { timeout: 15000 });

    // ---- tract drilldown ----
    await page.click('#view details.tract > summary');
    await page.waitForFunction(() => {
      const t = document.querySelector('#view details.tract[open]');
      return !!t && t.querySelectorAll('.stat').length > 0;
    }, null, { timeout: 30000 });

    // ---- ZIP route ----
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.fill('#q', '90001');
    await page.waitForSelector('#results .row', { timeout: 30000 });
    const zipRowText = await page.$eval('#results .row', (el) => el.textContent);
    assert(/Los Angeles County/.test(zipRowText), `expected LA row from ZIP: "${zipRowText}"`);

    // ---- state browse ----
    await page.selectOption('#stateSel', { label: 'Vermont' });
    await page.waitForSelector('#stateList .row', { timeout: 15000 });
    const stateRowCount = await page.$$eval('#stateList .row', (els) => els.length);
    assert(stateRowCount >= 14, `expected VT counties, saw ${stateRowCount}`);

    // ---- block-group deep link (lazy children must open via the parent tract) ----
    await page.goto(base + '#county=06075&g=060750133004', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => {
      const el = document.getElementById('060750133004');
      return !!el && el.open && el.querySelectorAll('.stat').length > 0;
    }, null, { timeout: 60000 });
    const bgText = await page.evaluate(() => document.getElementById('060750133004').textContent);
    assert(/844/.test(bgText) && /419/.test(bgText),
      'deep-linked SF block group should show its 844 ± 419 population');

    // ---- method page ----
    response = await page.goto(base + 'method.html', { waitUntil: 'networkidle' });
    assert(response.ok(), `method page returned ${response.status()}`);
    await page.waitForFunction(() => document.querySelectorAll('#varTableBody tr').length === 11);
    await page.waitForFunction(() => document.querySelectorAll('#receiptsBody tr').length >= 4);
    const methodText = await page.$eval('main', (el) => el.textContent);
    assert(/American Community Survey/.test(methodText), 'attribution missing');
    assert(/90%/.test(methodText), 'confidence level missing');

    assert(errors.length === 0, `console errors: ${errors.join(' | ')}`);
    console.log('[smoke] all checks passed');
  } finally {
    await browser.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
