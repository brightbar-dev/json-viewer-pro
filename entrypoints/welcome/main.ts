import '../../lib/viewer.css';
import { analyze } from '../../lib/document';
import { copyText } from '../../lib/dom';
import { normalizeSettings } from '../../lib/settings';
import { createAppearance, mountViewer, type ViewerController } from '../../lib/viewer';

const SAMPLE = `{
  "status": "ok",
  "request_id": 149883901923910003,
  "generated_at": "2026-09-15T08:00:00Z",
  "account": { "name": "Ada Lovelace", "plan": "pro", "brand_color": "#8250df", "created": 1700000000 },
  "releases": [
    { "version": "0.5.0", "date": "2026-09-14", "downloads": 1204, "notes": "Search, filter, keyboard shortcuts" },
    { "version": "0.6.0", "date": "2026-09-15", "downloads": 3811, "notes": "Big files, exact numbers, JSONPath, table view" }
  ],
  "links": { "docs": "https://github.com/brightbar-dev/json-viewer-pro" }
}`;

const appearance = createAppearance(document.body);
let settings = normalizeSettings(undefined);
appearance(settings);
let demo: ViewerController | null = null;

const doc = analyze(SAMPLE, 'json');
if (doc?.kind === 'json') {
  demo = mountViewer(doc, { settings, host: document.getElementById('demo')!, appearance: false, url: 'file:///sample.json' });
}

void browser.storage.sync.get('settings').then((data) => {
  settings = normalizeSettings(data.settings);
  appearance(settings);
  demo?.applySettings(settings);
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.settings) return;
  settings = normalizeSettings(changes.settings.newValue);
  appearance(settings);
  demo?.applySettings(settings);
});

// The exact extensions-page address for this install.
const url = `chrome://extensions/?id=${browser.runtime.id}`;
const urlEl = document.getElementById('ext-url')!;
urlEl.textContent = url;
const copyBtn = document.getElementById('copy-url') as HTMLButtonElement;
copyBtn.addEventListener('click', () => {
  void copyText(url).then((ok) => {
    copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
  });
});
