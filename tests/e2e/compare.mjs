#!/usr/bin/env node
/**
 * Local end-to-end check of the Compare view — NOT run in CI (CI has no browser).
 *
 *   pnpm exec wxt build
 *   PLAYWRIGHT=/path/to/playwright/index.mjs CHROME=/path/to/chrome \
 *   node tests/e2e/compare.mjs [unpacked-dir] [screenshot-dir]
 *
 * Opens the extension's viewer page, compares two pasted documents (keyboard
 * navigation, "changes only", JSON Patch copy, both themes), then a ~10 MB pair
 * loaded from files, checking time, long tasks and the number of DOM rows.
 * Exits non-zero on the first failed expectation.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { PLAYWRIGHT, CHROME } = process.env;
if (!PLAYWRIGHT || !CHROME) {
  console.error('Set PLAYWRIGHT (path to playwright/index.mjs) and CHROME (a Chromium that loads extensions). See the header of this file.');
  process.exit(2);
}
const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);
const dir = path.resolve(process.argv[2] ?? '.output/chrome-mv3');
const shots = process.argv[3] ? path.resolve(process.argv[3]) : null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jvp-cmp-'));

let failed = 0;
function expect(cond, what, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}${detail ? `  (${detail})` : ''}`);
  if (!cond) failed++;
}

const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  headless: true, executablePath: CHROME, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
});
let [worker] = ctx.serviceWorkers();
worker ??= await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const id = new URL(worker.url()).host;
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__copied = null;
  navigator.clipboard.writeText = async (t) => { window.__copied = t; };
  window.__lt = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });
});
await page.goto(`chrome-extension://${id}/viewer.html`);

const left = { name: 'api', users: [{ id: 1, name: 'Ada', role: 'admin' }, { id: 2, name: 'Bob' }], settings: { theme: 'light', beta: false }, tags: ['a', 'b'], removed: true, id: 12345678901234567890 };
const right = { users: [{ id: 1, name: 'Ada', role: 'owner' }, { id: 2, name: 'Bob' }, { id: 3, name: 'Cy' }], name: 'api', settings: { theme: 'dark', beta: false }, tags: ['b', 'a'], added: [1, 2], id: 12345678901234567891 };

// ---------- the main path ----------
await page.click('#compare');
expect(await page.isVisible('#compare-screen') && !(await page.isVisible('#editor-screen')), 'Compare opens from the editor');
await page.fill('#cmp-pane-left textarea', JSON.stringify(left, null, 2).replace('"id": 12345678901234567000', '"id": 12345678901234567890'));
await page.fill('#cmp-pane-right textarea', JSON.stringify(right, null, 2).replace('"id": 12345678901234567000', '"id": 12345678901234567891'));
await page.waitForFunction(() => document.querySelectorAll('#cmp-pane-right .cmp-pane-status.ok').length === 1);
expect(/Valid JSON/.test(await page.textContent('#cmp-pane-left .cmp-pane-status')), 'live validation on the left side');
await page.keyboard.press('Control+Enter');
await page.waitForSelector('.cmp-row');
const summary = await page.textContent('#cmp-summary');
expect(/8 differences/.test(summary) && /2 added/.test(summary) && /1 removed/.test(summary) && /5 changed/.test(summary), 'summary counts the differences', summary);
expect(await page.locator('.cmp-k-added').count() > 0 && await page.locator('.cmp-k-removed').count() > 0 && await page.locator('.cmp-k-changed').count() > 0, 'added, removed and changed rows are classed');
expect(await page.locator('.cmp-k-added .cmp-mark').first().textContent() === '+', 'a marker glyph accompanies the colour');

// keyboard: n walks the differences, p goes back, wrap announces
const seen = [];
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('n');
  seen.push(await page.getAttribute('.cmp-selected', 'aria-label'));
}
expect(seen.every(Boolean) && new Set(seen).size === 3, 'N moves to a different difference each time', seen.join(' | '));
expect(await page.evaluate(() => document.activeElement.id) === 'cmp-tree', 'focus stays on the tree');
expect(await page.evaluate(() => document.querySelector('#cmp-tree').getAttribute('aria-activedescendant') === document.querySelector('.cmp-selected').id), 'aria-activedescendant follows the selection');
await page.keyboard.press('p');
expect(await page.getAttribute('.cmp-selected', 'aria-label') === seen[1], 'P goes back one');
await page.keyboard.press('F3');
expect(await page.getAttribute('.cmp-selected', 'aria-label') === seen[2], 'F3 is next');
expect(/Difference 3 of 8/.test(await page.textContent('#cmp-position')), 'the position is shown', await page.textContent('#cmp-position'));
for (let i = 0; i < 5; i++) await page.keyboard.press('n');
expect(/Difference 8 of 8/.test(await page.textContent('#cmp-position')), 'N reaches the last difference');
await page.keyboard.press('n');
expect(/Difference 1 of 8/.test(await page.textContent('#cmp-position')), 'next wraps from the last difference to the first');

// the big number differs in its last digit
expect((await page.locator('.cmp-k-changed .jvp-number', { hasText: '12345678901234567890' }).count()) === 1, 'exact big numbers are compared and shown exactly');

// options
const before = await page.locator('.cmp-row').count();
await page.check('#cmp-changes-only');
const after = await page.locator('.cmp-row').count();
expect(after < before && (await page.locator('.cmp-k-equal').count()) === 0, '"Changes only" hides unchanged rows', `${before} -> ${after}`);
await page.uncheck('#cmp-changes-only');
await page.check('#cmp-unordered');
await page.waitForFunction(() => /\b6 differences/.test(document.querySelector('#cmp-summary').textContent));
expect(true, 'unordered arrays: ["a","b"] equals ["b","a"]', await page.textContent('#cmp-summary'));
await page.uncheck('#cmp-unordered');
await page.waitForFunction(() => /8 differences/.test(document.querySelector('#cmp-summary').textContent));

// JSON Patch
await page.click('#cmp-patch');
const patch = JSON.parse(await page.evaluate(() => window.__copied).then((t) => t.replace(/12345678901234567891/, '"BIG"')));
expect(Array.isArray(patch) && patch.length === 8 && patch.every((o) => ['add', 'remove', 'replace'].includes(o.op) && typeof o.path === 'string'), 'copies an RFC 6902 patch', patch.map((o) => `${o.op} ${o.path}`).join(', '));
expect((await page.evaluate(() => window.__copied)).includes('12345678901234567891'), 'the patch keeps the exact big number');

// both themes
for (const scheme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(150);
  expect(await page.evaluate((s) => document.body.classList.contains(`jvp-${s}`), scheme), `${scheme} theme applies`);
  if (shots) await page.screenshot({ path: path.join(shots, `compare-${scheme}.png`) });
}
await page.emulateMedia({ colorScheme: 'light' });

// back to the editor
await page.click('#cmp-edit');
expect(await page.isVisible('#cmp-inputs'), '"Edit the inputs" returns to the two boxes');
await page.click('#compare-back');
expect(await page.isVisible('#editor-screen'), 'Close compare returns to the editor');

// from the viewer
await page.click('#sample');
await page.click('#view');
await page.click('#compare-with');
expect((await page.inputValue('#cmp-pane-left textarea')).includes('Brightbar JSON Viewer'), 'Compare with… starts from the document being viewed');
await page.click('#compare-back');
expect(await page.isVisible('.jvp-root'), 'Close compare returns to the viewer');

// ---------- a large pair ----------
const rec = (i, flip) => ({ id: i, uuid: `${i.toString(16).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`, title: `Item number ${i} with some descriptive text to pad it out`, price: i * 1.37, inStock: i % 2 === 0, categories: ['alpha', 'beta', 'gamma'], dims: { w: i % 100, h: i % 50, d: i % 25 }, link: `https://shop.example.com/items/${i}`, rev: flip && i % 9973 === 0 ? 2 : 1 });
const N = 40000;
fs.writeFileSync(path.join(tmp, 'a.json'), JSON.stringify(Array.from({ length: N }, (_, i) => rec(i, false))));
fs.writeFileSync(path.join(tmp, 'b.json'), JSON.stringify([...Array.from({ length: N }, (_, i) => rec(i, true)), rec(N, false)]));
const mb = (fs.statSync(path.join(tmp, 'a.json')).size / 1e6).toFixed(1);
await page.click('#edit');
await page.click('#compare');
await page.setInputFiles('#cmp-pane-left input[type=file]', path.join(tmp, 'a.json'));
await page.setInputFiles('#cmp-pane-right input[type=file]', path.join(tmp, 'b.json'));
await page.waitForFunction(() => document.querySelectorAll('.cmp-pane-status.ok').length === 2, null, { timeout: 30000 });
await page.evaluate(() => (window.__lt = []));
const t0 = Date.now();
await page.click('#cmp-run');
await page.waitForFunction(() => /difference/.test(document.querySelector('#cmp-summary').textContent) && document.querySelector('.cmp-row'), null, { timeout: 60000 });
const ms = Date.now() - t0;
const bigSummary = await page.textContent('#cmp-summary');
expect(/6 differences/.test(bigSummary), `${mb} MB pair compared`, `${ms} ms, ${bigSummary}`);
expect(ms < 10000, 'first result within 10 s', `${ms} ms`);
const rows = await page.locator('.cmp-row').count();
const modelRows = await page.evaluate(() => document.querySelector('#cmp-spacer').offsetHeight / 20);
expect(rows < 150, 'only the visible rows are in the DOM', `${rows} elements for ~${Math.round(modelRows)} rows`);
await page.check('#cmp-changes-only');
const t1 = Date.now();
await page.keyboard.press('Escape');
await page.focus('#cmp-tree');
await page.keyboard.press('n');
await page.keyboard.press('n');
await page.waitForTimeout(100);
expect(Date.now() - t1 < 2000 && (await page.getAttribute('.cmp-selected', 'aria-label')) !== null, 'next difference is immediate on the large pair', `${Date.now() - t1} ms`);
await page.uncheck('#cmp-changes-only');
const t2 = Date.now();
for (let i = 0; i < 20; i++) await page.keyboard.press('PageDown');
expect(Date.now() - t2 < 3000, '20 page-downs through the large list', `${Date.now() - t2} ms`);
const lt = await page.evaluate(() => window.__lt);
console.log(`INFO  long tasks after the click: ${JSON.stringify(lt)}`);
expect(Math.max(0, ...lt) < 1500, 'no single block longer than 1.5 s', `${Math.max(0, ...lt)} ms`);

await ctx.close();
console.log(failed ? `\n${failed} expectation(s) failed` : '\nAll expectations passed');
process.exit(failed ? 1 : 0);
