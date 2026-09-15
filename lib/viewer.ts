/**
 * The viewer UI: toolbar, tree, raw view and search for a parsed document, and
 * deliberate error and empty states for everything else.
 */
import css from './viewer.css?inline';
import type { EmptyDoc, ErrorDoc, JsonDoc, ViewerDoc } from './document';
import { addStyleSheet, copyText, el, flashLabel } from './dom';
import { formatMatchCount, formatNumber, formatSize, utf8Length } from './format';
import { errorExcerpt } from './parser';
import { estimateLines, splitChunks } from './raw';
import { compileQuery, emptyResult, filterIncludes, pathOfMatch, searchSteps, type SearchResult } from './search';
import { stringifyJson } from './serialize';
import type { Theme } from './settings';
import { resolveShortcut } from './shortcuts';
import { expandByBudget, isContainerValue, TreeModel, type TNode } from './tree';
import { TreeView } from './view';

/** Rows opened on first render (breadth first). */
export const INITIAL_ROW_BUDGET = 1500;
/** Nodes "Expand all" may materialise before it stops. */
export const EXPAND_ALL_LIMIT = 2_000_000;
/** Longest a search may hold the main thread before yielding a frame. */
const SEARCH_SLICE_MS = 12;

export interface MountOptions {
  theme: Theme;
  /** The response's declared content type, for the error and empty states. */
  contentType?: string;
  /** Exact body size in bytes, when the caller knows it. */
  byteSize?: number;
}

function button(label: string, title?: string): HTMLButtonElement {
  const b = el('button', 'jvp-btn', label);
  b.type = 'button';
  if (title) b.title = title;
  return b;
}

function applyTheme(body: HTMLElement, theme: Theme): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const dark = theme === 'dark' || (theme === 'auto' && media.matches);
    body.classList.toggle('jvp-dark', dark);
    body.classList.toggle('jvp-light', !dark);
  };
  apply();
  if (theme === 'auto') media.addEventListener('change', apply);
}

/** Replace the page with the viewer for `doc`. */
export function mountViewer(doc: ViewerDoc, opts: MountOptions): void {
  addStyleSheet(css);
  const body = document.body ?? document.documentElement.appendChild(document.createElement('body'));
  applyTheme(body, opts.theme);
  const root = el('div', 'jvp-root');
  body.replaceChildren(root);
  if (doc.kind === 'json') mountJson(root, doc, opts);
  else if (doc.kind === 'error') mountError(root, doc, opts);
  else mountEmpty(root, doc, opts);
}

function sizeLabel(doc: ViewerDoc, opts: MountOptions): string {
  return formatSize(opts.byteSize ?? utf8Length(doc.raw));
}

function badge(text: string, title: string): HTMLElement {
  const b = el('span', 'jvp-badge', text);
  b.title = title;
  return b;
}

/** The untouched body, in chunks the browser lays out only while they are on screen. */
function renderRaw(raw: string): HTMLElement {
  const box = el('div', 'jvp-raw');
  box.id = 'jvp-raw';
  // Monospace 13px is ~7.8px per character; the estimate only sizes the
  // scrollbar until a chunk has been laid out once (`auto` then remembers).
  const columns = Math.max(20, Math.floor((window.innerWidth - 32) / 7.8));
  for (const chunk of splitChunks(raw)) {
    const pre = el('pre', 'jvp-raw-chunk', chunk);
    pre.style.setProperty('contain-intrinsic-size', `auto ${estimateLines(chunk, columns) * 20}px`);
    box.append(pre);
  }
  return box;
}

function mountJson(root: HTMLElement, doc: JsonDoc, opts: MountOptions): void {
  const model = new TreeModel(doc.value);
  expandByBudget(model.root, INITIAL_ROW_BUDGET);
  model.rebuild();
  const lossless = doc.preserved > 0;

  // ----- search state -----
  let re: RegExp | null = null;
  let result: SearchResult | null = null;
  let current = -1;
  let searchedFor = '';
  let filterMode = false;
  let job = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const isCurrent = (node: TNode): boolean => {
    if (!result || current < 0) return false;
    const container = result.containers[current];
    if (container === null) return node.parent === null;
    return node.parent !== null && node.parent.value === container && node.key === result.keys[current];
  };

  // ----- toolbar -----
  const toolbar = el('div', 'jvp-toolbar');
  const input = el('input', 'jvp-search');
  input.type = 'search';
  input.id = 'jvp-search';
  input.placeholder = 'Search keys and values… (/)';
  input.setAttribute('aria-label', 'Search keys and values');
  input.spellcheck = false;
  input.autocomplete = 'off';
  const prevBtn = button('↑', 'Previous match (Shift+Enter)');
  const nextBtn = button('↓', 'Next match (Enter)');
  prevBtn.classList.add('jvp-btn-icon');
  nextBtn.classList.add('jvp-btn-icon');
  prevBtn.setAttribute('aria-label', 'Previous match');
  nextBtn.setAttribute('aria-label', 'Next match');
  const count = el('span', 'jvp-match-count');
  count.setAttribute('role', 'status');
  count.setAttribute('aria-live', 'polite');
  const filterBtn = button('Filter', 'Show only the rows that match the search');
  filterBtn.setAttribute('aria-pressed', 'false');
  const rawBtn = button('Raw', 'Show the response exactly as it was received');
  rawBtn.setAttribute('aria-pressed', 'false');
  const copyBtn = button('Copy', 'Copy the formatted JSON (in Raw view, the raw body)');
  const expandBtn = button('Expand all', 'Expand every node (e)');
  const collapseBtn = button('Collapse all', 'Collapse every node (c)');
  const info = el('span', 'jvp-info');
  if (doc.format === 'ndjson') {
    const n = (doc.value as unknown[]).length;
    info.append(badge(`NDJSON · ${formatNumber(n)} line${n === 1 ? '' : 's'}`, 'Newline-delimited JSON, shown as an array of its lines'));
  }
  if (doc.format === 'jsonc') info.append(badge('JSONC', 'Comments and trailing commas were accepted'));
  if (doc.jsonp) info.append(badge(`JSONP · ${doc.jsonp}()`, `The JSON was wrapped in a call to ${doc.jsonp}(…)`));
  if (doc.prefix) info.append(badge(`${doc.prefix} guard`, 'An anti-XSSI prefix was removed before parsing; Raw shows it'));
  if (lossless) {
    info.append(
      badge(
        `${formatNumber(doc.preserved)} exact big number${doc.preserved === 1 ? '' : 's'}`,
        'These numbers have more digits than a JavaScript number holds. They are shown and copied exactly as sent, not rounded.',
      ),
    );
  }
  info.append(el('span', 'jvp-size', sizeLabel(doc, opts)));
  toolbar.append(input, prevBtn, nextBtn, count, filterBtn, rawBtn, copyBtn, expandBtn, collapseBtn, info);

  const main = el('main', 'jvp-main');
  const view = new TreeView(model, {
    highlight: () => re,
    isCurrent,
    topInset: () => toolbar.offsetHeight,
  });
  main.append(view.el);
  let rawEl: HTMLElement | null = null;
  root.append(toolbar, main);
  view.refresh();

  // ----- search -----
  const updateCount = () => {
    count.textContent = re && result ? formatMatchCount(result.count, current, result.done) : '';
    const any = !!result && result.count > 0;
    prevBtn.disabled = !any;
    nextBtn.disabled = !any;
  };

  const goTo = (i: number) => {
    if (!result || result.count === 0) return;
    const n = result.count;
    current = ((i % n) + n) % n;
    const index = model.reveal(pathOfMatch(result, current));
    view.refresh();
    if (index >= 0) view.scrollToRow(index, 'center');
    updateCount();
  };

  const applyFilter = () => {
    if (filterMode && re && result && result.done) {
      const res = result;
      model.expandWhere((n) => isContainerValue(n.value) && res.parents.has(n.value), false);
      model.setFilter(filterIncludes(res, re));
      view.refresh();
      window.scrollTo(window.scrollX, 0);
    } else if (!filterMode && model.filtered) {
      model.setFilter(null);
      view.refresh();
      if (current >= 0) goTo(current);
    }
  };

  const runSearch = (): boolean => {
    clearTimeout(debounce);
    debounce = undefined;
    const q = input.value.trim();
    if (q === searchedFor) return false;
    searchedFor = q;
    const my = ++job;
    re = compileQuery(q);
    current = -1;
    if (!re) {
      result = null;
      if (model.filtered) model.setFilter(null);
      view.refresh();
      updateCount();
      return true;
    }
    const rx = re;
    const res = (result = emptyResult());
    const steps = searchSteps(doc.value, rx, res);
    const pump = () => {
      if (my !== job) return;
      const t0 = performance.now();
      let finished = false;
      while (performance.now() - t0 < SEARCH_SLICE_MS) {
        if (steps.next().done) {
          finished = true;
          break;
        }
      }
      if (finished) {
        if (filterMode) applyFilter();
        else if (current < 0 && res.count > 0) goTo(0);
        else view.refresh();
      } else {
        if (!filterMode && current < 0 && res.count > 0) goTo(0);
        setTimeout(pump, 0);
      }
      updateCount();
    };
    pump();
    return true;
  };

  const step = (dir: 1 | -1) => {
    if (runSearch()) {
      if (current < 0) goTo(dir > 0 ? 0 : -1);
      return;
    }
    if (!result || result.count === 0) return;
    goTo(current < 0 ? (dir > 0 ? 0 : -1) : current + dir);
  };

  const debounceMs = doc.raw.length > 1_000_000 ? 250 : 90;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(runSearch, debounceMs);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  });
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  updateCount();

  filterBtn.addEventListener('click', () => {
    filterMode = !filterMode;
    filterBtn.setAttribute('aria-pressed', String(filterMode));
    if (filterMode && input.value.trim() !== searchedFor) runSearch();
    else applyFilter();
  });

  // ----- views and actions -----
  const showingRaw = () => !!rawEl && !rawEl.classList.contains('jvp-hidden');

  rawBtn.addEventListener('click', () => {
    const toRaw = !showingRaw();
    if (toRaw && !rawEl) {
      rawEl = renderRaw(doc.raw);
      main.append(rawEl);
    }
    rawEl?.classList.toggle('jvp-hidden', !toRaw);
    view.el.classList.toggle('jvp-hidden', toRaw);
    rawBtn.textContent = toRaw ? 'Tree' : 'Raw';
    rawBtn.setAttribute('aria-pressed', String(toRaw));
    if (!toRaw) view.refresh();
  });

  copyBtn.addEventListener('click', () => {
    flashLabel(copyBtn, copyText(showingRaw() ? doc.raw : stringifyJson(doc.value, 2, lossless)), 'Copied!');
  });

  const expandAll = () => {
    const built = model.expandAll(EXPAND_ALL_LIMIT);
    view.refresh();
    if (built >= EXPAND_ALL_LIMIT) {
      expandBtn.title = `Expanded the first ${formatNumber(EXPAND_ALL_LIMIT)} nodes`;
    }
  };
  const collapseAll = () => {
    model.collapseAll();
    view.refresh();
  };
  expandBtn.addEventListener('click', expandAll);
  collapseBtn.addEventListener('click', collapseAll);

  // Keyboard shortcuts: plain in-page listeners, so no `commands` permission.
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    const inInput = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const action = resolveShortcut(e, inInput);
    if (!action) return;
    if (action === 'focus-search') {
      e.preventDefault();
      input.focus();
      input.select();
    } else if (action === 'clear-search') {
      if (!input.value && document.activeElement !== input) return;
      e.preventDefault();
      input.value = '';
      runSearch();
      input.blur();
    } else if (action === 'next-match' || action === 'prev-match') {
      e.preventDefault();
      step(action === 'next-match' ? 1 : -1);
    } else if (action === 'expand-all') {
      e.preventDefault();
      expandAll();
    } else if (action === 'collapse-all') {
      e.preventDefault();
      collapseAll();
    }
  });
}

function stateToolbar(title: string, doc: ViewerDoc, opts: MountOptions): HTMLElement {
  const toolbar = el('div', 'jvp-toolbar');
  toolbar.append(el('span', 'jvp-title', title));
  if (doc.raw) {
    const copy = button('Copy raw', 'Copy the response body exactly as received');
    copy.addEventListener('click', () => flashLabel(copy, copyText(doc.raw), 'Copied!'));
    toolbar.append(copy);
  }
  const info = el('span', 'jvp-info');
  info.append(el('span', 'jvp-size', sizeLabel(doc, opts)));
  toolbar.append(info);
  return toolbar;
}

function mountError(root: HTMLElement, doc: ErrorDoc, opts: MountOptions): void {
  const what = doc.format === 'ndjson' ? 'NDJSON' : 'JSON';
  const panel = el('section', 'jvp-state jvp-error');
  panel.setAttribute('role', 'alert');
  panel.append(el('h1', '', `This response is not valid ${what}`));

  const message = el('p', 'jvp-error-message');
  message.append(el('strong', '', doc.error.message), ` — line ${formatNumber(doc.error.line)}, column ${formatNumber(doc.error.column)}`);
  panel.append(message);
  if (opts.contentType) {
    panel.append(el('p', 'jvp-muted', `The server declared it as ${opts.contentType}. The body is shown below exactly as received.`));
  }

  const excerpt = el('div', 'jvp-excerpt');
  for (const line of errorExcerpt(doc.raw, doc.error.offset)) {
    const row = el('div', line.isErrorLine ? 'jvp-excerpt-line jvp-excerpt-error' : 'jvp-excerpt-line');
    row.append(el('span', 'jvp-ln', String(line.number)));
    const code = el('span', 'jvp-code');
    code.append(line.before);
    if (line.isErrorLine) {
      const mark = el('mark', 'jvp-error-char', line.mark || ' ');
      if (!line.mark) mark.title = 'End of line';
      code.append(mark);
    }
    code.append(line.after);
    row.append(code);
    excerpt.append(row);
  }
  panel.append(excerpt);

  const body = el('section', 'jvp-state jvp-raw-section');
  body.append(el('h2', 'jvp-raw-heading', 'Response body'), renderRaw(doc.raw));
  root.append(stateToolbar(`Invalid ${what}`, doc, opts), panel, body);
}

function mountEmpty(root: HTMLElement, doc: EmptyDoc, opts: MountOptions): void {
  const panel = el('section', 'jvp-state jvp-empty');
  panel.append(el('h1', '', 'Empty response'));
  panel.append(
    el(
      'p',
      'jvp-muted',
      opts.contentType
        ? `The server declared ${opts.contentType} but sent no content (or only whitespace).`
        : 'There is no content to show.',
    ),
  );
  root.append(stateToolbar('Empty response', doc, opts), panel);
}
