#!/usr/bin/env node
/**
 * CI guard for Brightbar JSON Viewer's privacy promise: fail if the built extension
 * could send data anywhere or run code it did not ship, or if its manifest asks
 * for more than the storage permission.
 *
 *   node scripts/check-privacy.mjs .output/chrome-mv3 [.output/firefox-mv2 …]
 *
 * The rules live in scripts/privacy-scan.mjs (unit-tested in
 * tests/privacy.test.ts). Every exception is listed in ALLOW below with the
 * reason it is safe; the script prints each one it used, so a reviewer sees
 * exactly what was let through. Adding an entry is a reviewed code change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { checkManifest, scanText, SCANNED } from './privacy-scan.mjs';

/** @type {import('./privacy-scan.mjs').Allow[]} */
const ALLOW = [
  // The SVG namespace string used to create inline icons (document.createElementNS).
  // It is an identifier; nothing is ever requested from it.
  {
    file: /\.js$/,
    rule: 'remote-url',
    match: /^http:\/\/www\.w3\.org\/2000\/svg$/,
    reason: 'SVG namespace identifier for inline icons; never fetched',
  },
  // The welcome page links to the project on GitHub, and its sample document
  // contains the same URL as a value shown in the tree. Both are clickable links only.
  {
    file: /^(welcome\.html|chunks\/welcome-[\w-]+\.js)$/,
    rule: 'remote-url',
    match: /^https:\/\/github\.com\/brightbar-dev\/json-viewer-pro(#[\w-]+)?$/,
    reason: 'project link on the welcome page (and in its sample document); never fetched',
  },
  // The popup's "More from Brightbar" list: plain <a href> links to the Chrome
  // Web Store that open in a new tab when clicked. Nothing is loaded from them.
  {
    file: /^(chunks\/)?popup[-\w]*\.(html|js)$/,
    rule: 'remote-url',
    match: /^https:\/\/chromewebstore\.google\.com\/detail\/[\w-]+\/[a-p]{32}$/,
    reason: 'store link the user can click in the popup; never fetched',
  },
];

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: node scripts/check-privacy.mjs <built extension directory> [...]');
  process.exit(2);
}

let failures = 0;
for (const dir of dirs) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`${dir}: no manifest.json — build the extension first`);
    process.exit(2);
  }
  const files = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (SCANNED.test(entry.name)) files.push(p);
    }
  };
  walk(dir);

  console.log(`\n${dir}: scanning ${files.length} files`);
  for (const problem of checkManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))) {
    console.log(`  FAIL manifest.json: ${problem}`);
    failures++;
  }
  for (const file of files) {
    const rel = path.relative(dir, file).split(path.sep).join('/');
    // Locale files are store copy (the extension name and description), not code.
    if (rel.startsWith('_locales/')) continue;
    const { findings, allowed } = scanText(rel, fs.readFileSync(file, 'utf8'), ALLOW);
    for (const a of allowed) console.log(`  allowed ${rel}:${a.line} ${a.rule} ${a.match} — ${a.reason}`);
    for (const f of findings) {
      console.log(`  FAIL ${rel}:${f.line} ${f.rule}: ${f.match} (${f.why})`);
      failures++;
    }
  }
}

if (failures) {
  console.log(`\n${failures} privacy problem(s). If one is genuinely safe, add it to ALLOW in scripts/check-privacy.mjs with the reason.`);
  process.exit(1);
}
console.log('\nPrivacy check passed: no network APIs, no remote addresses, no code from strings, storage permission only.');
