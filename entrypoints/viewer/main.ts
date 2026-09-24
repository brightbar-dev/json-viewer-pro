import '../../lib/viewer.css';
import { analyze, type ContentClass, type JsonDoc, type ViewerDoc } from '../../lib/document';
import { formatNumber, formatSize, utf8Length } from '../../lib/format';
import { stringifyJson } from '../../lib/serialize';
import { normalizeSettings, type Settings } from '../../lib/settings';
import { createAppearance, mountViewer, type ViewerController } from '../../lib/viewer';
import { recordDocumentViewed } from '../../lib/review-nudge';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = byId<HTMLTextAreaElement>('input');
const gutter = byId<HTMLPreElement>('gutter');
const errorLine = byId<HTMLElement>('error-line');
const status = byId<HTMLElement>('status');
const statusText = byId<HTMLElement>('status-text');
const gotoBtn = byId<HTMLButtonElement>('goto');
const fileInput = byId<HTMLInputElement>('file');
const editorScreen = byId<HTMLElement>('editor-screen');
const editorActions = byId<HTMLElement>('editor-actions');
const viewerActions = byId<HTMLElement>('viewer-actions');
const host = byId<HTMLElement>('viewer-host');
const fileNameEl = byId<HTMLElement>('file-name');
const drop = byId<HTMLElement>('drop');

/** Line height of the editor, in px (style.css). */
const LINE = 20;
/** Files longer than this skip the editor and open straight in the viewer. */
const EDITOR_LIMIT = 2_000_000;
/** More lines than this and the gutter is not drawn. */
const GUTTER_LIMIT = 100_000;

const EXAMPLE = `{
  "id": 149883901923910003,
  "name": "Brightbar JSON Viewer",
  "released": "2026-09-15T08:00:00Z",
  "updatedAt": 1757923200,
  // Comments are fine in this box: it accepts JSONC.
  "theme": { "accent": "#0969da", "background": "#ffffff" },
  "tags": ["viewer", "formatter", "jsonpath"],
  "stats": { "users": 22, "rating": null, "fast": true },
  "releases": [
    { "version": "0.5.0", "date": "2026-09-14", "notes": "Search, filter and keyboard shortcuts" },
    { "version": "0.6.0", "date": "2026-09-15", "notes": "Big files, exact numbers, table view" },
  ]
}
`;

let settings: Settings = normalizeSettings(undefined);
const appearance = createAppearance(document.body);
appearance(settings);
let viewer: ViewerController | null = null;
let fileName = '';
let fileClass: ContentClass = 'json';
/** A file too large for the editor, kept here instead. */
let bigText: string | null = null;

void browser.storage.sync.get('settings').then((data) => {
  settings = normalizeSettings(data.settings);
  appearance(settings);
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.settings) return;
  settings = normalizeSettings(changes.settings.newValue);
  appearance(settings);
  viewer?.applySettings(settings);
});

const text = () => bigText ?? input.value;

// ---------- validation ----------

interface Check {
  doc: ViewerDoc | null;
  tone: 'idle' | 'ok' | 'warn' | 'error';
  message: string;
  errorOffset: number | null;
  errorLine: number | null;
}

function check(source: string): Check {
  if (!source.trim()) return { doc: null, tone: 'idle', message: 'Paste JSON, open a file, or drop one here.', errorOffset: null, errorLine: null };
  const size = formatSize(utf8Length(source));
  const strict = analyze(source, fileClass);
  if (strict?.kind === 'json') {
    const what = strict.format === 'ndjson' ? `Valid NDJSON · ${formatNumber((strict.value as unknown[]).length)} lines` : 'Valid JSON';
    const big = strict.preserved ? ` · ${formatNumber(strict.preserved)} exact big number${strict.preserved === 1 ? '' : 's'}` : '';
    return { doc: strict, tone: 'ok', message: `✓ ${what} · ${size}${big}`, errorOffset: null, errorLine: null };
  }
  const lenient = fileClass === 'json' ? analyze(source, 'json', { jsonc: true }) : null;
  if (lenient?.kind === 'json') {
    return { doc: lenient, tone: 'warn', message: `Valid JSONC, not strict JSON (it has comments or trailing commas) · ${size}. Format and Minify turn it into JSON.`, errorOffset: null, errorLine: null };
  }
  const failed = lenient?.kind === 'error' ? lenient : strict?.kind === 'error' ? strict : null;
  if (failed) {
    const e = failed.error;
    return { doc: failed, tone: 'error', message: `✗ ${e.message} — line ${formatNumber(e.line)}, column ${formatNumber(e.column)}`, errorOffset: e.offset, errorLine: e.line };
  }
  return { doc: null, tone: 'error', message: 'This is not JSON.', errorOffset: null, errorLine: null };
}

let last: Check = check('');

function showStatus(c: Check): void {
  last = c;
  status.className = `status ${c.tone}`;
  statusText.textContent = c.message;
  gotoBtn.hidden = c.errorOffset === null || bigText !== null;
  placeErrorLine();
}

function placeErrorLine(): void {
  if (last.errorLine === null || bigText !== null) {
    errorLine.hidden = true;
    return;
  }
  errorLine.hidden = false;
  errorLine.style.top = `${8 + (last.errorLine - 1) * LINE - input.scrollTop}px`;
}

function updateGutter(): void {
  if (bigText !== null) {
    gutter.hidden = true;
    return;
  }
  const v = input.value;
  let lines = 1;
  for (let i = v.indexOf('\n'); i !== -1 && lines <= GUTTER_LIMIT; i = v.indexOf('\n', i + 1)) lines++;
  gutter.hidden = lines > GUTTER_LIMIT;
  if (gutter.hidden) return;
  if (gutter.dataset.lines === String(lines)) return;
  gutter.dataset.lines = String(lines);
  const numbers = new Array<string>(lines);
  for (let i = 0; i < lines; i++) numbers[i] = String(i + 1);
  gutter.textContent = numbers.join('\n');
  gutter.scrollTop = input.scrollTop;
}

let pending: ReturnType<typeof setTimeout> | undefined;
input.addEventListener('input', () => {
  if (bigText !== null) {
    bigText = null;
    input.placeholder = '{ "paste": "your JSON here" }';
  }
  updateGutter();
  clearTimeout(pending);
  pending = setTimeout(() => showStatus(check(input.value)), input.value.length > 200_000 ? 600 : 200);
});
input.addEventListener('scroll', () => {
  gutter.scrollTop = input.scrollTop;
  placeErrorLine();
});
// Ctrl/Cmd+Enter views the document from anywhere on the editor screen.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !editorScreen.hidden) {
    e.preventDefault();
    view();
  }
});

gotoBtn.addEventListener('click', () => {
  if (last.errorOffset === null || last.errorLine === null) return;
  input.focus();
  input.setSelectionRange(last.errorOffset, last.errorOffset + 1);
  input.scrollTop = Math.max(0, (last.errorLine - 4) * LINE);
  placeErrorLine();
});

function setText(value: string): void {
  input.value = value;
  updateGutter();
  showStatus(check(value));
}

// ---------- actions ----------

function reformat(indent: number): void {
  clearTimeout(pending);
  const c = check(text());
  if (c.doc?.kind !== 'json') {
    showStatus(c);
    if (c.errorOffset !== null) gotoBtn.click();
    return;
  }
  const doc = c.doc;
  const lossless = doc.preserved > 0;
  if (doc.format === 'ndjson') {
    if (indent > 0) {
      showStatus({ ...c, tone: 'warn', message: 'NDJSON is one record per line, so it can be minified but not formatted.' });
      return;
    }
    setText((doc.value as unknown[]).map((v) => stringifyJson(v, 0, lossless)).join('\n') + '\n');
    return;
  }
  bigText = null;
  setText(stringifyJson(doc.value, indent, lossless) + (indent ? '\n' : ''));
}

function view(): void {
  clearTimeout(pending);
  const source = text();
  const c = check(source);
  if (c.doc?.kind !== 'json') {
    showStatus(c);
    if (c.errorOffset !== null) gotoBtn.click();
    return;
  }
  showViewer(c.doc, source);
}

function showViewer(doc: JsonDoc, source: string): void {
  viewer?.destroy();
  editorScreen.hidden = true;
  editorActions.hidden = true;
  viewerActions.hidden = false;
  host.hidden = false;
  fileNameEl.textContent = fileName || 'Pasted JSON';
  viewer = mountViewer(doc, {
    settings,
    host,
    appearance: false,
    byteSize: utf8Length(source),
    url: fileName ? `file:///${encodeURIComponent(fileName)}` : undefined,
  });
  window.scrollTo(0, 0);
  void recordDocumentViewed();
}

function showEditor(): void {
  viewer?.destroy();
  viewer = null;
  host.hidden = true;
  host.replaceChildren();
  viewerActions.hidden = true;
  editorActions.hidden = false;
  editorScreen.hidden = false;
  if (bigText !== null) {
    input.value = '';
    input.placeholder = `${fileName} (${formatSize(utf8Length(bigText))}) is too large for the editor. "View as tree" shows it again; typing here replaces it.`;
    gutter.hidden = true;
    showStatus(check(bigText));
  }
  input.focus();
}

async function openFile(file: File): Promise<void> {
  const content = await file.text();
  fileName = file.name;
  fileClass = /\.(?:ndjson|jsonl)$/i.test(file.name) ? 'ndjson' : 'json';
  if (content.length > EDITOR_LIMIT) {
    bigText = content;
    input.value = '';
  } else {
    bigText = null;
    setText(content);
  }
  view();
}

byId('format').addEventListener('click', () => reformat(2));
byId('minify').addEventListener('click', () => reformat(0));
byId('view').addEventListener('click', view);
byId('edit').addEventListener('click', showEditor);
byId('sample').addEventListener('click', () => {
  bigText = null;
  fileName = '';
  fileClass = 'json';
  setText(EXAMPLE);
  input.focus();
});
byId('clear').addEventListener('click', () => {
  bigText = null;
  fileName = '';
  fileClass = 'json';
  input.placeholder = '{ "paste": "your JSON here" }';
  setText('');
  input.focus();
});
byId('open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) void openFile(file);
});

// ---------- drag and drop ----------

const carriesFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!carriesFiles(e)) return;
  dragDepth++;
  drop.hidden = false;
});
window.addEventListener('dragleave', (e) => {
  if (!carriesFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) drop.hidden = true;
});
window.addEventListener('dragover', (e) => {
  if (carriesFiles(e)) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  drop.hidden = true;
  const file = e.dataTransfer?.files[0];
  if (file) void openFile(file);
});

showStatus(last);
updateGutter();
input.focus();
