import { analyze, classifyContentType, mightBeJson, type ContentClass } from '../lib/document';
import { addStyleSheet } from '../lib/dom';
import { normalizeSettings, type Settings } from '../lib/settings';
import { mountViewer } from '../lib/viewer';

export default defineContentScript({
  matches: ['<all_urls>'],
  // document_start, so a JSON response's raw text can be hidden before the
  // browser lays it out: for a 16 MB body that layout alone is ~0.8 s.
  runAt: 'document_start',

  main() {
    // Ordinary pages leave here after one string comparison: no storage read,
    // no DOM access, no allocation.
    if (window !== window.top) return;
    const cls = classifyContentType(document.contentType);
    if (cls === null) return;
    start(cls);
  },
});

const HIDE_RAW_BODY = 'html > body > pre, html > body > .json-formatter-container { display: none !important; }';

async function readSettings(): Promise<Settings> {
  try {
    const data = await browser.storage.sync.get('settings');
    return normalizeSettings(data.settings);
  } catch {
    return normalizeSettings(undefined);
  }
}

/**
 * The body text, if the page has the shape a browser gives a raw response:
 * a lone <pre> (plus Chrome's JSON pretty-print container), or nothing at all.
 * `head` is the first kilobyte, available without reading the whole body.
 */
function bodySource(): { head: string; full: () => string } | null {
  const body = document.body;
  if (!body) return null;
  const els = body.children;
  if (els.length === 0) {
    const text = body.textContent ?? '';
    return { head: text.slice(0, 1024), full: () => text };
  }
  const pre = els[0]!;
  if (pre.tagName !== 'PRE' || els.length > 2) return null;
  if (els.length === 2 && !els[1]!.classList.contains('json-formatter-container')) return null;
  const first = pre.firstChild;
  const head = first instanceof Text ? first.data.slice(0, 1024) : (pre.textContent ?? '').slice(0, 1024);
  return { head, full: () => pre.textContent ?? '' };
}

function bodyBytes(): number | undefined {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return nav && nav.decodedBodySize > 0 ? nav.decodedBodySize : undefined;
}

function start(cls: ContentClass): void {
  // Declared JSON is always rendered (as a tree or as an error), so its raw
  // text can be hidden right away. Plain text is only taken over if it parses.
  const declared = cls !== 'text';
  const reveal = declared ? addStyleSheet(HIDE_RAW_BODY) : null;
  const settings = declared ? readSettings() : null;

  const run = async () => {
    try {
      const source = bodySource();
      if (!source) return;
      if (cls === 'text' && !mightBeJson(source.head)) return;
      const { enabled, theme } = await (settings ?? readSettings());
      if (!enabled) return;
      const doc = analyze(source.full(), cls);
      if (!doc) return;
      mountViewer(doc, { theme, contentType: document.contentType, byteSize: bodyBytes() });
    } finally {
      reveal?.();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void run(), { once: true });
  else void run();
}
