#!/usr/bin/env node
/**
 * Local end-to-end performance check — NOT run in CI (CI has no browser).
 *
 *   npm run build
 *   PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs \
 *   CHROME="/path/to/Google Chrome for Testing" \
 *   node tests/e2e/perf.mjs [label=unpacked-dir ...]
 *
 * With no arguments it measures `.output/chrome-mv3`. Pass several
 * `label=dir` pairs (e.g. `main=/tmp/old-build new=.output/chrome-mv3`) to
 * compare builds. Chrome-branded builds ignore --load-extension, so CHROME must
 * be Chrome for Testing (`npx playwright install chromium` fetches one).
 *
 * It writes its own fixtures to a temp directory, serves them with real
 * content types, and prints markdown tables: first render, long tasks, JS heap
 * and DOM size per fixture; interaction timings on a 16.7 MB document; and the
 * extension's cost on an ordinary HTML page.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { PLAYWRIGHT, CHROME } = process.env;
if (!PLAYWRIGHT || !CHROME) {
  console.error('Set PLAYWRIGHT (path to playwright/index.mjs) and CHROME (Chrome for Testing binary). See the header of this file.');
  process.exit(2);
}
const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);
const builds = (process.argv.slice(2).length ? process.argv.slice(2) : ['build=.output/chrome-mv3']).map((a) => {
  const [label, dir] = a.includes('=') ? a.split('=') : ['build', a];
  return { label, dir: path.resolve(dir) };
});

// ---------- fixtures ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jvp-perf-'));
const write = (name, text) => fs.writeFileSync(path.join(tmp, name), text);
const users = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name: `User ${i + 1}`, email: `user${i + 1}@example.com`, active: i % 3 !== 0, score: (i * 37) % 1000 / 10, tags: ['a', 'b', 'c'].slice(0, i % 4), profile: { url: `https://example.com/u/${i + 1}`, created: new Date(1700000000000 + i * 86400000).toISOString() }, manager: i % 5 === 0 ? null : { id: (i % 5) + 1 } }));
write('api.json', JSON.stringify({ page: 1, per_page: 40, total: 40, data: users }).replace('"total":40', '"total":40,"snowflake":149883901923910003'));
write('large.json', JSON.stringify(Array.from({ length: 60000 }, (_, i) => ({ id: i, uuid: `${i.toString(16).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`, title: `Item number ${i} with some descriptive text to pad it out`, price: i * 1.37, inStock: i % 2 === 0, categories: ['alpha', 'beta', 'gamma'], dims: { w: i % 100, h: i % 50, d: i % 25 }, link: `https://shop.example.com/items/${i}` }))));
let deep = { leaf: 'bottom' };
for (let i = 0; i < 200; i++) deep = { level: 200 - i, child: deep };
write('deep.json', JSON.stringify(deep));
write('invalid.json', '{\n  "ok": true,\n  "items": [1, 2, 3,],\n  bad: "unquoted key"\n}\n');
write('plain.txt', JSON.stringify({ served_as: 'text/plain' }));
write('page.html', '<!doctype html><title>Plain page</title>' + Array.from({ length: 200 }, (_, i) => `<h2>Section ${i}</h2><p>Lorem ipsum <a href="#s${i}">link</a></p>`).join(''));

const TYPES = { '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8' };
const server = http.createServer((req, res) => {
  const file = path.join(tmp, path.basename(req.url ?? ''));
  if (!fs.existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (promise, ms, fallback) => Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), ms))]);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function launch(dir) {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(tmp, 'profile-')), {
    headless: true, executablePath: CHROME, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  await new Promise((r) => setTimeout(r, 1500));
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__lt = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });
  });
  return { ctx, page };
}
const takeLongTasks = (page) => page.evaluate(() => { const x = window.__lt; window.__lt = []; return x; });
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const heapMB = async (ctx, page) => Math.round((await (await ctx.newCDPSession(page)).send('Runtime.getHeapUsage')).usedSize / 1e6);

async function firstRender(dir, fixture) {
  const { ctx, page } = await launch(dir);
  const t0 = Date.now();
  await page.goto(`${base}/${fixture}`, { waitUntil: 'commit' });
  let ms = -1;
  while (Date.now() - t0 < 60000) {
    // A hung renderer never answers, so every probe is bounded.
    if (await within(page.evaluate(() => document.querySelector('.jvp-row, .jvp-state, .jvp-node') !== null).catch(() => false), 2000, false)) { ms = Date.now() - t0; break; }
    await sleep(25); // Node-side: page.waitForTimeout would queue behind a hung renderer
  }
  if (ms < 0) {
    await within(ctx.close(), 10000);
    return { ms, longest: '-', heap: '-', dom: '-' };
  }
  try {
    await sleep(1000);
    const lt = await within(takeLongTasks(page), 5000, null);
    if (!lt) return { ms, longest: 'unresponsive after render', heap: '-', dom: '-' };
    return { ms, longest: `${Math.max(0, ...lt)} ms`, heap: `${await heapMB(ctx, page)} MB`, dom: await page.evaluate(() => document.getElementsByTagName('*').length) };
  } catch (e) {
    // e.g. an older build whose renderer dies after first paint
    return { ms, longest: `page crashed after render (${String(e.message).split('\n')[0].slice(0, 60)})`, heap: '-', dom: '-' };
  } finally {
    await within(ctx.close().catch(() => {}), 10000);
  }
}

async function interactions(dir) {
  const { ctx, page } = await launch(dir);
  try {
    return await interactionsIn(ctx, page);
  } finally {
    await within(ctx.close(), 10000);
  }
}

async function interactionsIn(ctx, page) {
  await page.goto(`${base}/large.json`);
  await page.waitForSelector('.jvp-row', { timeout: 60000 }); // the current engine's rows; older builds are reported as unable to run
  await page.waitForTimeout(800);
  await takeLongTasks(page);
  const rows = [];
  const step = async (label, act, settle = () => frames(page)) => {
    const t = Date.now();
    await act();
    await settle();
    rows.push([label, Date.now() - t, Math.max(0, ...(await takeLongTasks(page)))]);
  };
  const searchDone = async () => {
    await page.waitForTimeout(350); // debounce
    await page.waitForFunction(() => { const t = document.querySelector('.jvp-match-count')?.textContent ?? ''; return t && !t.includes('…'); });
  };
  await step('scroll to the bottom', () => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)));
  await step('search "number 4567" (incl. 250 ms debounce)', () => page.fill('#jvp-search', 'number 4567'), searchDone);
  await step('Enter: next match', () => page.press('#jvp-search', 'Enter'));
  await step('filter on', () => page.click('text=Filter'));
  await step('filter off', () => page.click('text=Filter'));
  await step('search "e" (~370k matches)', () => page.fill('#jvp-search', 'e'), searchDone);
  await step('Escape', () => page.press('#jvp-search', 'Escape'));
  await step('expand all (~900k nodes)', () => page.click('button[title^="Expand every node"]'));
  const heap = await heapMB(ctx, page);
  await step('scroll to the bottom, all expanded', () => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)));
  await step('collapse all', () => page.click('button[title^="Collapse everything"]'));
  await step('Raw view', () => page.click('text=Raw'));
  await step('back to Tree', () => page.click('text=Tree'));
  return { rows, heap };
}

async function pageCost(dir) {
  const { ctx, page } = await launch(dir);
  const url = `${base}/page.html`;
  await page.goto(url);
  const loads = [];
  for (let i = 0; i < 20; i++) {
    await page.goto(url, { waitUntil: 'load' });
    loads.push(await page.evaluate(() => performance.getEntriesByType('navigation')[0].loadEventEnd));
  }
  const cdp = await ctx.newCDPSession(page);
  const evals = [];
  for (let i = 0; i < 5; i++) {
    const events = [];
    const onData = (d) => events.push(...d.value);
    cdp.on('Tracing.dataCollected', onData);
    const complete = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
    await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
    await page.goto(url, { waitUntil: 'load' });
    await cdp.send('Tracing.end');
    await complete;
    cdp.off('Tracing.dataCollected', onData);
    evals.push(events.filter((e) => e.name === 'EvaluateScript' && e.dur && JSON.stringify(e.args ?? {}).includes('content-scripts/content.js')).reduce((s, e) => s + e.dur / 1000, 0));
  }
  await ctx.close();
  return { load: median(loads), evaluate: median(evals) };
}

// ---------- run ----------
const fixtures = ['api.json', 'large.json', 'deep.json', 'invalid.json', 'plain.txt'];
console.log(`Chrome for Testing: ${CHROME}\n\n### First render (fresh profile per fixture)\n`);
console.log('| build | fixture | first render | longest task after | JS heap | DOM elements |\n|---|---|---|---|---|---|');
for (const b of builds) {
  for (const f of fixtures) {
    const r = await firstRender(b.dir, f);
    console.log(`| ${b.label} | ${f} | ${r.ms < 0 ? 'never (60 s cap)' : `${r.ms} ms`} | ${r.longest} | ${r.heap} | ${r.dom} |`);
  }
}
for (const b of builds) {
  try {
    const { rows, heap } = await interactions(b.dir);
    console.log(`\n### Interactions on large.json — ${b.label} (heap after expand all: ${heap} MB)\n\n| action | wall time | longest task |\n|---|---|---|`);
    for (const [label, ms, longest] of rows) console.log(`| ${label} | ${ms} ms | ${longest} ms |`);
  } catch (e) {
    console.log(`\n### Interactions on large.json — ${b.label}: could not run (${String(e.message).split('\n')[0]})`);
  }
}
console.log('\n### Ordinary HTML page\n\n| build | median load | content script evaluation |\n|---|---|---|');
for (const b of builds) {
  const r = await pageCost(b.dir);
  console.log(`| ${b.label} | ${r.load.toFixed(1)} ms | ${r.evaluate.toFixed(2)} ms |`);
}
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
