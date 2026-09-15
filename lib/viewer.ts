/**
 * The viewer UI: a sticky header (toolbar, path bar, notices), the tree, the
 * raw view and search for a parsed document, and deliberate error and empty
 * states for everything else. Settings apply live through the controller that
 * `mountViewer` returns.
 */
import css from './viewer.css?inline';
import { analyze, type EmptyDoc, type ErrorDoc, type JsonDoc, type ViewerDoc } from './document';
import { addStyleSheet, copyText, el, flashLabel } from './dom';
import { downloadName, formatMatchCount, formatNumber, formatSize, utf8Length } from './format';
import { openMenu, type MenuEntry } from './menu';
import { errorExcerpt } from './parser';
import { RawView } from './rawview';
import { compileQuery, emptyResult, filterIncludes, pathOfMatch, searchSteps, type SearchResult } from './search';
import { stringifyJson } from './serialize';
import { fontStack, rowHeightFor, type Settings, type Theme } from './settings';
import { resolveShortcut } from './shortcuts';
import { expandByBudget, formatJsonPointer, formatJsPath, formatPath, isContainerValue, pathOf, TreeModel, type TNode } from './tree';
import { EXPAND_LIMIT, TreeView } from './view';

/** Longest a search may hold the main thread before yielding a frame. */
const SEARCH_SLICE_MS = 12;

export interface MountOptions {
  settings: Settings;
  /** The response's declared content type, for the error and empty states. */
  contentType?: string;
  /** Exact body size in bytes, when the caller knows it. */
  byteSize?: number;
  /** The document's URL, for download file names. */
  url?: string;
}

export interface ViewerController {
  /** Apply changed settings to the open viewer, without a reload. */
  applySettings(settings: Settings): void;
}

interface Context {
  opts: MountOptions;
  settings(): Settings;
  onSettings(listener: (settings: Settings) => void): void;
}

function button(label: string, title?: string): HTMLButtonElement {
  const b = el('button', 'jvp-btn', label);
  b.type = 'button';
  if (title) b.title = title;
  return b;
}

function badge(text: string, title: string): HTMLElement {
  const b = el('span', 'jvp-badge', text);
  b.title = title;
  return b;
}

/** Theme (following the system live when `auto`), font, size and indent, as CSS state on <body>. */
function createAppearance(body: HTMLElement): (settings: Settings) => void {
  let theme: Theme = 'auto';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => {
    const dark = theme === 'dark' || (theme === 'auto' && media.matches);
    body.classList.toggle('jvp-dark', dark);
    body.classList.toggle('jvp-light', !dark);
  };
  media.addEventListener('change', applyTheme);
  return (s) => {
    theme = s.theme;
    applyTheme();
    body.style.setProperty('--jvp-font', fontStack(s.fontFamily));
    body.style.setProperty('--jvp-font-size', `${s.fontSize}px`);
    body.style.setProperty('--jvp-row-h', `${rowHeightFor(s.fontSize)}px`);
    body.style.setProperty('--jvp-indent', `${s.indent}px`);
  };
}

/** Replace the page with the viewer for `doc`. */
export function mountViewer(doc: ViewerDoc, opts: MountOptions): ViewerController {
  addStyleSheet(css);
  const body = document.body ?? document.documentElement.appendChild(document.createElement('body'));
  const appearance = createAppearance(body);
  let settings = opts.settings;
  appearance(settings);
  const listeners: ((s: Settings) => void)[] = [];
  const ctx: Context = { opts, settings: () => settings, onSettings: (l) => listeners.push(l) };
  const root = el('div', 'jvp-root');
  body.replaceChildren(root);
  if (doc.kind === 'json') mountJson(root, doc, ctx);
  else if (doc.kind === 'error') mountError(root, doc, ctx);
  else mountEmpty(root, doc, ctx);
  return {
    applySettings(next) {
      settings = next;
      appearance(next);
      for (const l of listeners) l(next);
    },
  };
}

function sizeLabel(doc: ViewerDoc, opts: MountOptions): string {
  return formatSize(opts.byteSize ?? utf8Length(doc.raw));
}

function download(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function mountJson(root: HTMLElement, doc: JsonDoc, ctx: Context): void {
  const { opts } = ctx;
  const model = new TreeModel(doc.value);
  expandByBudget(model.root, ctx.settings().expandBudget);
  model.rebuild();
  const lossless = doc.preserved > 0;
  const url = opts.url ?? '';

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

  // ----- header: toolbar -----
  const header = el('header', 'jvp-header');
  const toolbar = el('div', 'jvp-toolbar');

  const searchGroup = el('div', 'jvp-search-group jvp-tree-only');
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
  searchGroup.append(input, prevBtn, nextBtn, count);

  const filterBtn = button('Filter', 'Show only the rows that match the search');
  filterBtn.classList.add('jvp-tree-only');
  filterBtn.setAttribute('aria-pressed', 'false');
  const rawBtn = button('Raw', 'Switch between the tree and the response exactly as received');

  const copyGroup = el('div', 'jvp-group');
  const copyBtn = button('Copy', 'Copy the formatted JSON (in Raw view, the raw body)');
  const copyMenuBtn = button('▾', 'More copy and download options');
  copyMenuBtn.classList.add('jvp-btn-icon');
  copyMenuBtn.setAttribute('aria-label', 'More copy and download options');
  copyMenuBtn.setAttribute('aria-haspopup', 'menu');
  copyMenuBtn.setAttribute('aria-expanded', 'false');
  copyGroup.append(copyBtn, copyMenuBtn);

  const levels = el('div', 'jvp-group jvp-tree-only');
  levels.setAttribute('role', 'group');
  levels.setAttribute('aria-label', 'Expand and collapse');
  const collapseBtn = button('Collapse all', 'Collapse everything below the top level (c)');
  const levelBtns = [1, 2, 3].map((n) => {
    const b = button(String(n), `Show ${n} level${n === 1 ? '' : 's'} (${n})`);
    b.setAttribute('aria-label', `Show ${n} level${n === 1 ? '' : 's'}`);
    b.classList.add('jvp-btn-level');
    return b;
  });
  const expandBtn = button('Expand all', 'Expand every node (e)');
  levels.append(collapseBtn, ...levelBtns, expandBtn);

  const sortBtn = button('Sort keys', 'Show object keys in alphabetical order. View only: copies keep the original order.');
  sortBtn.classList.add('jvp-tree-only');
  sortBtn.setAttribute('aria-pressed', 'false');

  const wrapBtn = button('Wrap', 'Wrap long lines');
  wrapBtn.classList.add('jvp-raw-only');
  wrapBtn.setAttribute('aria-pressed', 'true');
  const linesBtn = button('Line numbers', 'Show line numbers');
  linesBtn.classList.add('jvp-raw-only');
  linesBtn.setAttribute('aria-pressed', 'true');

  const info = el('span', 'jvp-info');
  // Copy confirmations float over the page, so they never reflow the header.
  const status = el('div', 'jvp-toast');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  if (doc.format === 'ndjson') {
    const n = (doc.value as unknown[]).length;
    info.append(badge(`NDJSON · ${formatNumber(n)} line${n === 1 ? '' : 's'}`, 'Newline-delimited JSON, shown as an array of its lines'));
  }
  if (doc.format === 'jsonc') info.append(badge('JSONC', 'Parsed leniently: comments and trailing commas were accepted'));
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
  toolbar.append(searchGroup, filterBtn, rawBtn, copyGroup, levels, sortBtn, wrapBtn, linesBtn, info);

  // ----- header: path bar -----
  const pathbar = el('div', 'jvp-pathbar jvp-tree-only');
  const crumbs = el('nav', 'jvp-crumbs');
  crumbs.setAttribute('aria-label', 'Path of the selected value');
  const copyPathBtn = button('Copy path', 'Copy the JSONPath of the selected value (Ctrl/Cmd+Shift+C in the tree)');
  copyPathBtn.classList.add('jvp-btn-small');
  const pathMenuBtn = button('⋯', 'More ways to copy the selected value');
  pathMenuBtn.classList.add('jvp-btn-small', 'jvp-btn-icon');
  pathMenuBtn.setAttribute('aria-label', 'More ways to copy the selected value');
  pathMenuBtn.setAttribute('aria-haspopup', 'menu');
  pathbar.append(crumbs, copyPathBtn, pathMenuBtn);

  // ----- header: notices -----
  // Whatever the viewer holds back to stay responsive is announced here, with a way past it.
  const notice = el('div', 'jvp-notice jvp-hidden');
  notice.setAttribute('role', 'status');
  const hideNotice = () => notice.classList.add('jvp-hidden');
  const showNotice = (text: string, actionLabel: string, action: () => void) => {
    const go = button(actionLabel);
    go.addEventListener('click', () => {
      hideNotice();
      action();
    });
    const dismiss = button('×', 'Dismiss');
    dismiss.classList.add('jvp-btn-icon');
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.addEventListener('click', hideNotice);
    notice.replaceChildren(el('span', 'jvp-notice-text', text), go, dismiss);
    notice.classList.remove('jvp-hidden');
  };
  const limitText = `Stopped expanding at ${formatNumber(EXPAND_LIMIT)} nodes to keep the page responsive.`;
  header.append(toolbar, pathbar, notice);

  // ----- copying -----
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  const announce = (text: string) => {
    status.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (status.textContent = ''), 3000);
  };
  const copy = (text: string, what: string) => {
    void copyText(text).then((ok) => announce(ok ? `Copied ${what} · ${formatSize(utf8Length(text))}` : 'Copy failed'));
  };
  const copyValue = (node: TNode) => copy(stringifyJson(node.value, 2, lossless), 'value');
  const copyPath = (node: TNode) => copy(formatPath(pathOf(node)), 'JSONPath');

  const main = el('main', 'jvp-main');
  let view: TreeView;

  const rowMenu = (node: TNode, anchor: HTMLElement) => {
    const path = pathOf(node);
    const short = (s: string) => (s.length > 42 ? `${s.slice(0, 41)}…` : s);
    const at = () => model.indexOfNode(node);
    const entries: MenuEntry[] = [
      { label: 'Copy value', hint: node.isContainer ? 'formatted JSON' : 'as JSON', action: () => copyValue(node) },
      node.kind === 'string' ? { label: 'Copy text', hint: 'without quotes', action: () => copy(node.value as string, 'text') } : null,
      node.isContainer ? { label: 'Copy minified', hint: 'one line', action: () => copy(stringifyJson(node.value, 0, lossless), 'minified value') } : null,
      'separator',
      { label: 'Copy JSONPath', hint: short(formatPath(path)), action: () => copyPath(node) },
      { label: 'Copy JS path', hint: path.length ? short(formatJsPath(path)) : 'n/a for the root', disabled: !path.length, action: () => copy(formatJsPath(path), 'JS path') },
      { label: 'Copy JSON Pointer', hint: path.length ? short(formatJsonPointer(path)) : 'n/a for the root', disabled: !path.length, action: () => copy(formatJsonPointer(path), 'JSON Pointer') },
      node.expandable ? 'separator' : null,
      node.expandable ? { label: 'Expand all below', hint: '*', action: () => at() >= 0 && view.expandSubtreeAt(at()) } : null,
      node.expandable ? { label: 'Collapse all below', hint: 'Alt+click', action: () => at() >= 0 && view.collapseSubtreeAt(at()) } : null,
    ];
    openMenu(anchor, entries, { host: root, returnFocus: anchor.closest('.jvp-row') ? view.el : anchor });
  };

  const updatePath = (node: TNode | null) => {
    copyPathBtn.disabled = !node;
    pathMenuBtn.disabled = !node;
    if (!node) {
      crumbs.replaceChildren(el('span', 'jvp-muted', 'Select a row to see its path — in the tree, arrow keys move and Enter opens'));
      return;
    }
    const chain: TNode[] = [];
    for (let n: TNode | null = node; n; n = n.parent) chain.unshift(n);
    const list = el('ol', 'jvp-crumb-list');
    chain.forEach((n, i) => {
      const label = n.parent === null ? '$' : typeof n.key === 'number' ? `[${n.key}]` : String(n.key);
      const b = el('button', 'jvp-crumb', label);
      b.type = 'button';
      b.title = formatPath(pathOf(n));
      if (i === chain.length - 1) b.setAttribute('aria-current', 'location');
      b.addEventListener('click', () => {
        view.selectNode(n);
        view.el.focus({ preventScroll: true });
      });
      const li = el('li');
      li.append(b);
      list.append(li);
    });
    crumbs.replaceChildren(list);
    crumbs.scrollLeft = crumbs.scrollWidth;
  };

  view = new TreeView(model, {
    highlight: () => re,
    isCurrent,
    topInset: () => header.offsetHeight,
    onLimit: (expandFully) => showNotice(limitText, 'Expand everything', expandFully),
    onSelect: updatePath,
    onMenu: rowMenu,
    onCopy: (node, what) => (what === 'value' ? copyValue(node) : copyPath(node)),
    imagePreview: () => ctx.settings().imagePreview,
  });
  view.setRowHeight(rowHeightFor(ctx.settings().fontSize));
  main.append(view.el);
  let raw: RawView | null = null;
  root.classList.add('jvp-mode-tree');
  root.append(header, main, status);
  updatePath(null);
  view.refresh();

  copyPathBtn.addEventListener('click', () => view.selectedNode && copyPath(view.selectedNode));
  pathMenuBtn.addEventListener('click', () => view.selectedNode && rowMenu(view.selectedNode, pathMenuBtn));

  ctx.onSettings((s) => {
    view.setRowHeight(rowHeightFor(s.fontSize));
    raw?.setMetrics(s.fontSize, rowHeightFor(s.fontSize));
  });

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
    if (index >= 0) {
      view.select(index, false);
      view.scrollToRow(index, 'center');
    }
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
    const steps = searchSteps(doc.value, rx, res, 4000, model.sortKeys);
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
    } else if (e.key === 'ArrowDown' && !input.value) {
      e.preventDefault();
      view.el.focus();
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
  const showingRaw = () => root.classList.contains('jvp-mode-raw');

  rawBtn.addEventListener('click', () => {
    const toRaw = !showingRaw();
    if (toRaw && !raw) {
      raw = new RawView(doc.raw);
      raw.el.id = 'jvp-raw';
      raw.setMetrics(ctx.settings().fontSize, rowHeightFor(ctx.settings().fontSize));
      main.append(raw.el);
    }
    root.classList.toggle('jvp-mode-raw', toRaw);
    root.classList.toggle('jvp-mode-tree', !toRaw);
    raw?.el.classList.toggle('jvp-hidden', !toRaw);
    view.el.classList.toggle('jvp-hidden', toRaw);
    rawBtn.textContent = toRaw ? 'Tree' : 'Raw';
    if (!toRaw) view.refresh();
  });
  wrapBtn.addEventListener('click', () => {
    if (!raw) return;
    raw.setWrap(!raw.wrapping);
    wrapBtn.setAttribute('aria-pressed', String(raw.wrapping));
  });
  linesBtn.addEventListener('click', () => {
    if (!raw) return;
    raw.setLineNumbers(!raw.numbered);
    linesBtn.setAttribute('aria-pressed', String(raw.numbered));
  });

  copyBtn.addEventListener('click', () => {
    flashLabel(copyBtn, copyText(showingRaw() ? doc.raw : stringifyJson(doc.value, 2, lossless)), 'Copied!');
  });
  const rawExt = doc.jsonp ? 'js' : doc.format === 'ndjson' ? 'ndjson' : 'json';
  const rawType = doc.jsonp ? 'text/javascript' : doc.format === 'ndjson' ? 'application/x-ndjson' : 'application/json';
  copyMenuBtn.addEventListener('click', () =>
    openMenu(
      copyMenuBtn,
      [
        { label: 'Copy formatted JSON', action: () => copy(stringifyJson(doc.value, 2, lossless), 'formatted JSON') },
        { label: 'Copy minified JSON', action: () => copy(stringifyJson(doc.value, 0, lossless), 'minified JSON') },
        { label: 'Copy raw response', hint: 'exactly as received', action: () => copy(doc.raw, 'raw response') },
        'separator',
        { label: 'Download formatted JSON', hint: downloadName(url), action: () => download(stringifyJson(doc.value, 2, lossless), downloadName(url), 'application/json') },
        { label: 'Download raw response', hint: downloadName(url, rawExt), action: () => download(doc.raw, downloadName(url, rawExt), rawType) },
      ],
      { host: root },
    ),
  );

  const afterBulk = (complete: boolean, retryLabel: string, retry: () => void) => {
    view.refresh();
    if (complete) hideNotice();
    else showNotice(limitText, retryLabel, () => {
      retry();
      view.refresh();
    });
  };
  const expandAll = () => afterBulk(model.expandAll(EXPAND_LIMIT), 'Expand everything', () => model.expandAll());
  const collapseAll = () => {
    model.collapseAll();
    view.refresh();
    hideNotice();
  };
  const showLevel = (n: number) => afterBulk(model.expandToLevel(n, EXPAND_LIMIT), `Show all ${n} levels`, () => model.expandToLevel(n));
  expandBtn.addEventListener('click', expandAll);
  collapseBtn.addEventListener('click', collapseAll);
  levelBtns.forEach((b, i) => b.addEventListener('click', () => showLevel(i + 1)));

  sortBtn.addEventListener('click', () => {
    const on = !model.sortKeys;
    model.setSortKeys(on);
    sortBtn.setAttribute('aria-pressed', String(on));
    view.refresh();
    if (re) {
      searchedFor = ' '; // matches now come in a different order: search again
      runSearch();
    }
  });

  // Keyboard shortcuts: plain in-page listeners, so no `commands` permission.
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    const inInput = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const action = resolveShortcut(e, inInput);
    if (!action) return;
    if (showingRaw() && action !== 'clear-search') return;
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
    } else {
      e.preventDefault();
      showLevel(Number(action.slice(-1)));
    }
  });
}

function stateHeader(title: string, doc: ViewerDoc, opts: MountOptions): HTMLElement {
  const header = el('header', 'jvp-header');
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
  header.append(toolbar);
  return header;
}

function mountError(root: HTMLElement, doc: ErrorDoc, ctx: Context): void {
  const { opts } = ctx;
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

  if (doc.format === 'json') {
    const actions = el('p', 'jvp-actions');
    const lenient = button('Try a lenient parse', 'Accept comments and trailing commas (JSONC) to view the document anyway');
    const outcome = el('span', 'jvp-muted');
    lenient.addEventListener('click', () => {
      const retry = analyze(doc.raw, 'json', { jsonc: true });
      if (retry?.kind === 'json') {
        root.replaceChildren();
        window.scrollTo(0, 0);
        mountJson(root, retry, ctx);
      } else if (retry?.kind === 'error') {
        lenient.disabled = true;
        outcome.textContent = `A lenient parse fails too: ${retry.error.message} — line ${formatNumber(retry.error.line)}, column ${formatNumber(retry.error.column)}.`;
      }
    });
    actions.append(lenient, outcome);
    panel.append(actions);
  }

  // Highlight the error's line in the raw body (or a window around it, on a very long line).
  const at = doc.error.offset;
  let lineStart = at > 0 ? doc.raw.lastIndexOf('\n', at - 1) + 1 : 0;
  let lineEnd = doc.raw.indexOf('\n', at);
  if (lineEnd === -1) lineEnd = doc.raw.length;
  if (lineEnd - lineStart > 400) {
    lineStart = Math.max(lineStart, at - 40);
    lineEnd = Math.min(lineEnd, at + 40);
  }
  const rawView = new RawView(doc.raw, { mark: { start: lineStart, end: Math.max(lineEnd, lineStart + 1) } });
  rawView.setMetrics(ctx.settings().fontSize, rowHeightFor(ctx.settings().fontSize));
  ctx.onSettings((s) => rawView.setMetrics(s.fontSize, rowHeightFor(s.fontSize)));
  const body = el('section', 'jvp-state jvp-raw-section');
  body.append(el('h2', 'jvp-raw-heading', 'Response body'), rawView.el);
  root.append(stateHeader(`Invalid ${what}`, doc, opts), panel, body);
}

function mountEmpty(root: HTMLElement, doc: EmptyDoc, ctx: Context): void {
  const { opts } = ctx;
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
  root.append(stateHeader('Empty response', doc, opts), panel);
}
