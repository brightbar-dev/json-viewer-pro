#!/usr/bin/env node
/**
 * Chrome Web Store listing assets, captured from the real built extension in
 * Chrome for Testing.
 *
 *   npx wxt build
 *   PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs \
 *   CHROME="/path/to/Google Chrome for Testing" \
 *   node store/capture/capture.mjs [unpacked-extension-dir]
 *
 * Writes store/screenshots/0N-*.png (1280x800) and store/promo/*.png
 * (440x280 and 1400x560): RGB PNGs with no alpha channel, as the store asks.
 * The data is fictional: store/capture/fixtures/*.json plus a generated
 * 60,000-product catalog. Nothing here is copied from any other extension.
 *
 * How the assets stay true: they are pictures of the shipped UI, so re-run this
 * after any visible change to the viewer and commit what it writes.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { PLAYWRIGHT, CHROME } = process.env;
if (!PLAYWRIGHT || !CHROME) {
  console.error('Set PLAYWRIGHT (path to playwright/index.mjs) and CHROME (Chrome for Testing binary). See the header of this file.');
  process.exit(2);
}
const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const ext = path.resolve(process.argv[2] ?? path.join(repo, '.output/chrome-mv3'));
const shotsDir = path.join(repo, 'store/screenshots');
const promoDir = path.join(repo, 'store/promo');
fs.mkdirSync(shotsDir, { recursive: true });
fs.mkdirSync(promoDir, { recursive: true });

// Brand colours, from public/icon-jvp.svg.
const BRAND = { from: '#1e40af', to: '#3b82f6', ink: '#ffffff' };
const UI_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";

// ---------- data ----------
const names = ['Aurora', 'Basalt', 'Cedar', 'Delta', 'Ember', 'Fjord', 'Granite', 'Harbor', 'Indigo', 'Juniper'];
const kinds = ['desk lamp', 'backpack', 'water bottle', 'notebook', 'headphones', 'keyboard', 'mug', 'jacket', 'tent', 'watch'];
const catalog = JSON.stringify(
  Array.from({ length: 60000 }, (_, i) => ({
    id: 100000 + i,
    sku: `SKU-${String((i * 7919) % 1000000).padStart(6, '0')}`,
    title: `${names[i % 10]} ${kinds[(i * 3) % 10]}, ${['small', 'medium', 'large'][i % 3]}`,
    price: (((i * 37) % 50000) + 499) / 100,
    in_stock: i % 4 !== 0,
    rating: ((i * 13) % 50) / 10,
    tags: [['outdoor', 'office', 'travel', 'kitchen', 'audio'][i % 5], ['new', 'sale', 'bestseller'][i % 3]],
    dimensions: { w: 10 + (i % 40), h: 5 + (i % 25), d: 2 + (i % 15) },
    url: `https://shop.example.com/p/${100000 + i}`,
  })),
);
const files = {
  '/orders.json': fs.readFileSync(path.join(here, 'fixtures/orders.json'), 'utf8'),
  '/ids.json': fs.readFileSync(path.join(here, 'fixtures/ids.json'), 'utf8'),
  '/catalog.json': catalog,
};
const server = http.createServer((req, res) => {
  const body = files[req.url ?? ''];
  if (body === undefined) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------- helpers ----------
async function withExtension(fn, { dark = false, width = 1280, height = 704 } = {}) {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'jvp-store-')), {
    headless: true,
    executablePath: CHROME,
    viewport: { width, height },
    colorScheme: dark ? 'dark' : 'light',
    deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await new Promise((r) => setTimeout(r, 1500));
  for (const p of ctx.pages()) if (p.url().includes('welcome.html')) await p.close();
  try {
    const page = await ctx.newPage();
    await page.mouse.move(0, height - 1);
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

const open = async (page, url) => {
  await page.goto(`${base}${url}`);
  await page.waitForSelector('.jvp-row', { timeout: 60000 });
  await page.waitForTimeout(400);
};

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const stage = await chromium.launch({ headless: true, executablePath: CHROME });

/** Lay out captured PNGs under a caption band and save a 1280x800 RGB PNG. */
async function compose(file, caption, parts) {
  const page = await stage.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const imgs = parts
    .map((p) => `<img src="data:image/png;base64,${p.png.toString('base64')}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px">`)
    .join('');
  await page.setContent(`<!doctype html><html><head><style>
    html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; background: #ffffff; }
    .band { position: absolute; inset: 0 0 auto 0; height: 96px; box-sizing: border-box; padding: 0 44px;
      display: flex; flex-direction: column; justify-content: center;
      background: linear-gradient(100deg, ${BRAND.from}, ${BRAND.to}); color: ${BRAND.ink}; font-family: ${UI_FONT}; }
    .t { font-size: 34px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.15; }
    .s { margin-top: 5px; font-size: 20px; opacity: 0.92; }
    img { position: absolute; display: block; }
    .divider { position: absolute; top: 96px; bottom: 0; width: 2px; background: ${BRAND.to}; }
  </style></head><body>
    <div class="band"><div class="t">${escapeHtml(caption.title)}</div><div class="s">${escapeHtml(caption.sub)}</div></div>
    ${imgs}${parts.length > 1 ? '<div class="divider" style="left:639px"></div>' : ''}
  </body></html>`);
  await page.screenshot({ path: file, type: 'png' });
  await page.close();
  console.log('wrote', path.relative(repo, file));
}

// ---------- screenshots ----------
const shot1 = await withExtension(async (page) => {
  await open(page, '/orders.json');
  return page.screenshot({ type: 'png' });
});
await compose(path.join(shotsDir, '01-tree-view.png'), { title: 'A fast, clean tree for any JSON response', sub: 'Syntax colours, item counts, clickable links and readable dates, with nothing to set up' }, [
  { png: shot1, x: 0, y: 96, w: 1280, h: 704 },
]);

const shot2 = await withExtension(
  async (page) => {
    await open(page, '/orders.json');
    const row = page.locator('.jvp-row', { hasText: 'RM482913377GB' }).first();
    await row.locator('.jvp-value').click();
    await row.locator('.jvp-actions-btn').click();
    await page.waitForTimeout(200);
    return page.screenshot({ type: 'png' });
  },
  { dark: true },
);
await compose(path.join(shotsDir, '02-dark-path-copy.png'), { title: 'Dark mode, keyboard navigation, a path for every value', sub: 'Copy any value as valid JSON, or its path as JSONPath, a JS accessor or a JSON Pointer' }, [
  { png: shot2, x: 0, y: 96, w: 1280, h: 704 },
]);

const shot3 = await withExtension(async (page) => {
  await open(page, '/catalog.json');
  const dismiss = page.locator('.jvp-notice button[aria-label="Dismiss"]');
  if (await dismiss.count()) await dismiss.click();
  await page.fill('#jvp-search', '$[?(@.price > 499 && @.in_stock == true)].title');
  await page.waitForTimeout(600);
  await page.waitForFunction(() => /of/.test(document.querySelector('.jvp-match-count')?.textContent ?? ''));
  await page.mouse.move(0, 703);
  return page.screenshot({ type: 'png' });
});
await compose(path.join(shotsDir, '03-query-large-file.png'), { title: 'Query a 12 MB document in a blink', sub: 'JSONPath filters and plain search over 60,000 objects, with every match counted and one keypress away' }, [
  { png: shot3, x: 0, y: 96, w: 1280, h: 704 },
]);

const shot4 = await withExtension(async (page) => {
  await open(page, '/catalog.json');
  const dismiss = page.locator('.jvp-notice button[aria-label="Dismiss"]');
  if (await dismiss.count()) await dismiss.click();
  await page.click('button[title^="Show $ as a table"]');
  await page.waitForSelector('.jvp-table-body .jvp-tr');
  await page.click('.jvp-th:has-text("rating")');
  await page.click('.jvp-th:has-text("rating")');
  await page.waitForTimeout(200);
  await page.click('.jvp-table-body .jvp-tr >> nth=1 >> .jvp-td-nested >> nth=1');
  await page.waitForTimeout(200);
  return page.screenshot({ type: 'png' });
});
await compose(path.join(shotsDir, '04-table-view.png'), { title: 'Turn arrays into sortable tables', sub: '60,000 rows sorted instantly, with nested values one click away' }, [
  { png: shot4, x: 0, y: 96, w: 1280, h: 704 },
]);

const exactTree = await withExtension(
  async (page) => {
    await open(page, '/ids.json');
    return page.screenshot({ type: 'png' });
  },
  { width: 638, height: 704 },
);
const exactRaw = await withExtension(
  async (page) => {
    await open(page, '/ids.json');
    await page.click('button[title^="Switch between"]');
    await page.waitForTimeout(300);
    return page.screenshot({ type: 'png' });
  },
  { width: 640, height: 704 },
);
await compose(path.join(shotsDir, '05-exact-big-numbers.png'), { title: 'Big numbers stay exact', sub: 'IDs past 2^53 are shown, searched and copied as sent (tree on the left, the raw response on the right)' }, [
  { png: exactTree, x: 0, y: 96, w: 638, h: 704 },
  { png: exactRaw, x: 640, y: 96, w: 640, h: 704 },
]);

// ---------- promo tiles ----------
const iconData = fs.readFileSync(path.join(repo, 'public/icon-128.png')).toString('base64');
const darkTree = await withExtension(
  async (page) => {
    await open(page, '/orders.json');
    await page.locator('.jvp-row', { hasText: '"customer"' }).first().locator('.jvp-key').click();
    await page.locator('.jvp-row', { hasText: '"customer"' }).first().locator('.jvp-key').click();
    await page.mouse.move(0, 559);
    return page.screenshot({ type: 'png' });
  },
  { dark: true, width: 900, height: 560 },
);

async function promo(file, width, height, html) {
  const page = await stage.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>
    html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; font-family: ${UI_FONT}; color: ${BRAND.ink};
      background: radial-gradient(120% 140% at 0% 0%, ${BRAND.to} 0%, ${BRAND.from} 70%); }
    img.icon { display: block; border-radius: 22%; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25); }
  </style></head><body>${html}</body></html>`);
  await page.screenshot({ path: file, type: 'png' });
  await page.close();
  console.log('wrote', path.relative(repo, file));
}

await promo(path.join(promoDir, 'small-440x280.png'), 440, 280, `
  <div style="position:absolute;left:36px;top:40px;display:flex;align-items:center;gap:18px">
    <img class="icon" src="data:image/png;base64,${iconData}" width="76" height="76">
    <div style="font-size:31px;font-weight:800;line-height:1.05;letter-spacing:-0.02em">JSON<br>Viewer Pro</div>
  </div>
  <div style="position:absolute;left:36px;top:158px;font-size:21px;font-weight:600">Fast. Exact. Private.</div>
  <div style="position:absolute;left:36px;top:192px;right:30px;font-size:15px;line-height:1.45;opacity:0.9">Huge files, exact big numbers, JSONPath and tables. No tracking, ever.</div>`);

await promo(path.join(promoDir, 'marquee-1400x560.png'), 1400, 560, `
  <div style="position:absolute;left:72px;top:82px;width:470px">
    <div style="display:flex;align-items:center;gap:22px">
      <img class="icon" src="data:image/png;base64,${iconData}" width="96" height="96">
      <div style="font-size:50px;font-weight:800;line-height:1.02;letter-spacing:-0.02em">JSON<br>Viewer Pro</div>
    </div>
    <div style="margin-top:30px;font-size:27px;font-weight:600;line-height:1.25">The fast, exact, private JSON viewer</div>
    <ul style="margin:22px 0 0;padding:0;list-style:none;font-size:20px;line-height:1.75;opacity:0.95">
      <li>✓ Opens 16 MB files in a blink</li>
      <li>✓ Big numbers never rounded</li>
      <li>✓ JSONPath queries and table view</li>
      <li>✓ No tracking, checked on every build</li>
    </ul>
  </div>
  <img src="data:image/png;base64,${darkTree.toString('base64')}" width="760" height="473"
    style="position:absolute;right:56px;top:44px;border-radius:14px;box-shadow:0 22px 60px rgba(0,0,0,0.45);outline:1px solid rgba(255,255,255,0.18)">`);

await stage.close();
server.close();
console.log('done');
