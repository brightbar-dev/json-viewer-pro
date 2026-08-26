export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_end',

  main() {
    // Only run on the top frame
    if (window !== window.top) return;

    init();
  },
});

interface JvpSettings {
  enabled: boolean;
  theme: 'auto' | 'light' | 'dark';
}

function isJsonPage(): boolean {
  const body = document.body;
  if (!body) return false;

  // Fast path: check document.contentType
  if (document.contentType === 'application/json' || document.contentType === 'text/json') {
    const pre = body.querySelector('pre');
    if (pre) {
      try { JSON.parse(pre.textContent!); return true; } catch { /* fall through */ }
    }
  }

  // Fallback: Chrome renders raw JSON inside a <pre> element
  const pre = body.querySelector('pre');
  if (!pre) return false;

  const children = Array.from(body.childNodes).filter(
    (n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent?.trim()),
  );
  const isSimple = children.length === 1 && children[0] === pre;
  const isChromeJson = children.length === 2 && children[0] === pre &&
    (children[1] as Element).classList?.contains('json-formatter-container');
  if (!isSimple && !isChromeJson) return false;

  try {
    JSON.parse(pre.textContent!);
    return true;
  } catch {
    return false;
  }
}

function getJsonFromPage(): unknown | null {
  const pre = document.body.querySelector('pre');
  if (!pre) return null;
  try {
    return JSON.parse(pre.textContent!);
  } catch {
    return null;
  }
}

// DOM helpers
function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function text(str: string): Text {
  return document.createTextNode(str);
}

// Render a JSON value as a DOM tree
function renderValue(value: unknown, key: string | number | null, depth: number, path: string): HTMLElement {
  const type = Array.isArray(value)
    ? 'array'
    : value === null
      ? 'null'
      : typeof value;

  if (type === 'object' || type === 'array') {
    return renderCollapsible(value as Record<string, unknown> | unknown[], key, type, depth, path);
  }
  return renderPrimitive(value, key, type, path);
}

function renderCollapsible(
  obj: Record<string, unknown> | unknown[],
  key: string | number | null,
  type: string,
  depth: number,
  path: string,
): HTMLElement {
  const isArray = type === 'array';
  const count = isArray ? (obj as unknown[]).length : Object.keys(obj).length;
  const bracket = isArray ? ['[', ']'] : ['{', '}'];

  const container = el('div', 'jvp-node jvp-collapsible');
  container.dataset.path = path;
  container.dataset.depth = String(depth);

  // Toggle row
  const toggle = el('span', 'jvp-toggle');
  toggle.textContent = '\u25BC';
  toggle.setAttribute('role', 'button');
  toggle.setAttribute('tabindex', '0');

  const header = el('div', 'jvp-header');
  header.appendChild(toggle);

  if (key !== null) {
    const keyEl = el('span', 'jvp-key');
    keyEl.textContent = JSON.stringify(key);
    header.appendChild(keyEl);
    header.appendChild(text(': '));
  }

  const bracketOpen = el('span', 'jvp-bracket');
  bracketOpen.textContent = bracket[0];
  header.appendChild(bracketOpen);

  const countEl = el('span', 'jvp-count');
  countEl.textContent = isArray
    ? `${count} item${count !== 1 ? 's' : ''}`
    : `${count} key${count !== 1 ? 's' : ''}`;
  header.appendChild(countEl);

  // Copy path button
  const copyBtn = el('button', 'jvp-copy-path');
  copyBtn.textContent = '\u2398';
  (copyBtn as HTMLButtonElement).title = `Copy path: ${path}`;
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(path);
    copyBtn.textContent = '\u2713';
    setTimeout(() => (copyBtn.textContent = '\u2398'), 1200);
  });
  header.appendChild(copyBtn);

  container.appendChild(header);

  // Children
  const childrenEl = el('div', 'jvp-children');
  if (isArray) {
    (obj as unknown[]).forEach((item, i) => {
      childrenEl.appendChild(renderValue(item, i, depth + 1, `${path}[${i}]`));
    });
  } else {
    for (const [k, v] of Object.entries(obj)) {
      const childPath = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k)
        ? `${path}.${k}`
        : `${path}[${JSON.stringify(k)}]`;
      childrenEl.appendChild(renderValue(v, k, depth + 1, childPath));
    }
  }

  const bracketClose = el('div', 'jvp-bracket-close');
  bracketClose.textContent = bracket[1];
  childrenEl.appendChild(bracketClose);

  container.appendChild(childrenEl);

  // Collapse toggle
  const toggleCollapse = () => {
    const collapsed = container.classList.toggle('jvp-collapsed');
    toggle.textContent = collapsed ? '\u25B6' : '\u25BC';
  };

  header.addEventListener('click', toggleCollapse);
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleCollapse();
    }
  });

  // Auto-collapse large nodes at depth > 1
  if (depth > 1 && count > 10) {
    toggleCollapse();
  }

  return container;
}

function renderPrimitive(value: unknown, key: string | number | null, type: string, path: string): HTMLElement {
  const row = el('div', 'jvp-node jvp-primitive');
  row.dataset.path = path;

  if (key !== null) {
    const keyEl = el('span', 'jvp-key');
    keyEl.textContent = JSON.stringify(key);
    row.appendChild(keyEl);
    row.appendChild(text(': '));
  }

  const valEl = el('span', `jvp-value jvp-${type}`);
  if (type === 'string') {
    valEl.textContent = JSON.stringify(value);
    if (/^https?:\/\//.test(value as string)) {
      const link = document.createElement('a');
      link.className = 'jvp-link';
      link.href = value as string;
      link.textContent = JSON.stringify(value);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      valEl.textContent = '';
      valEl.appendChild(link);
    }
  } else if (value === null) {
    valEl.textContent = 'null';
  } else {
    valEl.textContent = String(value);
  }
  row.appendChild(valEl);

  // Copy value button
  const copyBtn = el('button', 'jvp-copy-path');
  copyBtn.textContent = '\u2398';
  (copyBtn as HTMLButtonElement).title = `Copy: ${path}`;
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(
      type === 'string' ? (value as string) : JSON.stringify(value),
    );
    copyBtn.textContent = '\u2713';
    setTimeout(() => (copyBtn.textContent = '\u2398'), 1200);
  });
  row.appendChild(copyBtn);

  return row;
}

// Toolbar
function createToolbar(data: unknown, rawText: string): HTMLElement {
  const toolbar = el('div', 'jvp-toolbar');

  // Search
  const searchBox = document.createElement('input');
  searchBox.className = 'jvp-search';
  searchBox.id = 'jvp-search';
  searchBox.type = 'text';
  searchBox.placeholder = 'Search keys and values\u2026 (/)';
  toolbar.appendChild(searchBox);

  // Live match count
  const matchCount = el('span', 'jvp-match-count');
  matchCount.setAttribute('role', 'status');
  matchCount.setAttribute('aria-live', 'polite');
  toolbar.appendChild(matchCount);

  // Filter toggle — hide non-matching rows instead of only highlighting them
  let filterMode = false;
  const filterBtn = el('button', 'jvp-btn');
  filterBtn.textContent = 'Filter';
  filterBtn.setAttribute('aria-pressed', 'false');
  (filterBtn as HTMLButtonElement).title = 'Hide rows that do not match the search';

  const rerunSearch = () => {
    const query = searchBox.value.toLowerCase().trim();
    const count = runSearch(query, filterMode);
    matchCount.textContent = query ? formatMatchCount(count) : '';
  };

  searchBox.addEventListener('input', rerunSearch);
  filterBtn.addEventListener('click', () => {
    filterMode = !filterMode;
    filterBtn.setAttribute('aria-pressed', String(filterMode));
    filterBtn.classList.toggle('jvp-btn-active', filterMode);
    rerunSearch();
  });
  toolbar.appendChild(filterBtn);

  // Toggle: Tree / Raw
  const toggleRaw = el('button', 'jvp-btn');
  toggleRaw.textContent = 'Raw';
  toggleRaw.addEventListener('click', () => {
    const tree = document.getElementById('jvp-tree');
    const raw = document.getElementById('jvp-raw');
    if (!tree || !raw) return;
    const showingTree = !tree.classList.contains('jvp-hidden');
    tree.classList.toggle('jvp-hidden', showingTree);
    raw.classList.toggle('jvp-hidden', !showingTree);
    toggleRaw.textContent = showingTree ? 'Tree' : 'Raw';
  });
  toolbar.appendChild(toggleRaw);

  // Copy all — copies whichever view is on screen
  const copyAll = el('button', 'jvp-btn');
  copyAll.textContent = 'Copy';
  copyAll.addEventListener('click', () => {
    const raw = document.getElementById('jvp-raw');
    const showingRaw = !!raw && !raw.classList.contains('jvp-hidden');
    navigator.clipboard.writeText(showingRaw ? rawText : JSON.stringify(data, null, 2));
    copyAll.textContent = 'Copied!';
    setTimeout(() => (copyAll.textContent = 'Copy'), 1200);
  });
  toolbar.appendChild(copyAll);

  // Expand all
  const expandAllBtn = el('button', 'jvp-btn');
  expandAllBtn.textContent = 'Expand All';
  (expandAllBtn as HTMLButtonElement).title = 'Expand every node (e)';
  expandAllBtn.addEventListener('click', expandAll);
  toolbar.appendChild(expandAllBtn);

  // Collapse all
  const collapseAllBtn = el('button', 'jvp-btn');
  collapseAllBtn.textContent = 'Collapse All';
  (collapseAllBtn as HTMLButtonElement).title = 'Collapse every node (c)';
  collapseAllBtn.addEventListener('click', collapseAll);
  toolbar.appendChild(collapseAllBtn);

  // Info
  const info = el('span', 'jvp-info');
  info.textContent = formatSize(new Blob([rawText]).size);
  toolbar.appendChild(info);

  return toolbar;
}

export function formatSize(bytes: number): string {
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function generatePath(base: string, key: string): string {
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) {
    return `${base}.${key}`;
  }
  return `${base}[${JSON.stringify(key)}]`;
}

export function isUrl(str: string): boolean {
  return /^https?:\/\//.test(str);
}

// ---------- Search ----------

/** True when `haystack` contains the already-lowercased `query`. */
export function matchesQuery(haystack: string | null | undefined, query: string): boolean {
  if (!query) return false;
  return (haystack ?? '').toLowerCase().includes(query);
}

/** Human-readable match count for the toolbar. */
export function formatMatchCount(count: number): string {
  if (count === 0) return 'No matches';
  return `${count} match${count === 1 ? '' : 'es'}`;
}

/**
 * Given each node's parent index (null for a root) and which nodes matched the
 * search, return the indices that stay visible in filter mode: the matches,
 * their ancestors (so a hit is never orphaned) and their descendants (so an
 * object that matched does not render as empty).
 */
export function computeVisibleNodes(
  parents: (number | null)[],
  matched: boolean[],
): Set<number> {
  const visible = new Set<number>();

  // Matches and everything above them.
  for (let i = 0; i < matched.length; i++) {
    if (!matched[i]) continue;
    let cur: number | null = i;
    while (cur !== null && cur >= 0) {
      visible.add(cur);
      cur = parents[cur] ?? null;
    }
  }

  // Matches and everything below them.
  const children: number[][] = parents.map(() => []);
  parents.forEach((parent, i) => {
    if (parent !== null && parent >= 0 && children[parent]) children[parent].push(i);
  });

  const seen = new Set<number>();
  const stack: number[] = [];
  matched.forEach((m, i) => {
    if (m) {
      stack.push(i);
      seen.add(i);
    }
  });

  while (stack.length) {
    const n = stack.pop()!;
    visible.add(n);
    for (const c of children[n] ?? []) {
      if (!seen.has(c)) {
        seen.add(c);
        stack.push(c);
      }
    }
  }

  return visible;
}

/**
 * Highlight every node matching `query`, expanding collapsed ancestors so the
 * hits are visible. When `filterMode` is on, non-matching rows are hidden
 * outright (see `computeVisibleNodes`). Returns the number of matching nodes.
 */
function runSearch(query: string, filterMode: boolean): number {
  document.querySelectorAll('.jvp-search-match').forEach((e) => {
    e.classList.remove('jvp-search-match');
  });
  document.querySelectorAll('.jvp-search-hidden').forEach((e) => {
    e.classList.remove('jvp-search-hidden');
  });

  if (!query) return 0;

  const nodes = Array.from(document.querySelectorAll('.jvp-node'));
  const index = new Map<Element, number>();
  nodes.forEach((node, i) => index.set(node, i));

  const parents: (number | null)[] = [];
  const matched: boolean[] = [];

  nodes.forEach((node, i) => {
    const parentNode = node.parentElement?.closest('.jvp-node') ?? null;
    parents[i] = parentNode ? index.get(parentNode) ?? null : null;

    const keys = node.querySelectorAll(':scope > .jvp-key, :scope > .jvp-header > .jvp-key');
    const values = node.querySelectorAll(':scope > .jvp-value');
    let isMatch = false;

    keys.forEach((k) => {
      if (matchesQuery(k.textContent, query)) {
        isMatch = true;
        k.classList.add('jvp-search-match');
      }
    });

    values.forEach((v) => {
      if (matchesQuery(v.textContent, query)) {
        isMatch = true;
        v.classList.add('jvp-search-match');
      }
    });

    matched[i] = isMatch;
  });

  // Reveal each hit by expanding the collapsed nodes above it.
  nodes.forEach((node, i) => {
    if (!matched[i]) return;
    let parent = node.parentElement;
    while (parent) {
      if (parent.classList.contains('jvp-collapsed')) {
        parent.classList.remove('jvp-collapsed');
        const t = parent.querySelector('.jvp-toggle');
        if (t) t.textContent = '\u25BC';
      }
      parent = parent.parentElement;
    }
  });

  if (filterMode) {
    const visible = computeVisibleNodes(parents, matched);
    nodes.forEach((node, i) => {
      if (!visible.has(i)) node.classList.add('jvp-search-hidden');
    });
  }

  return matched.reduce((n, m) => (m ? n + 1 : n), 0);
}

// ---------- Expand / collapse ----------

function expandAll(): void {
  document.querySelectorAll('.jvp-collapsed').forEach((node) => {
    node.classList.remove('jvp-collapsed');
    const t = node.querySelector('.jvp-toggle');
    if (t) t.textContent = '\u25BC';
  });
}

function collapseAll(): void {
  document.querySelectorAll('.jvp-collapsible').forEach((node) => {
    node.classList.add('jvp-collapsed');
    const t = node.querySelector('.jvp-toggle');
    if (t) t.textContent = '\u25B6';
  });
}

// ---------- Keyboard shortcuts ----------

export type ShortcutAction =
  | 'focus-search'
  | 'clear-search'
  | 'expand-all'
  | 'collapse-all'
  | null;

export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
}

/**
 * Map a keydown to a viewer action. Ctrl/Cmd+F is claimed deliberately: the
 * browser's own find cannot reach text inside collapsed nodes, our search can.
 * Bare letter keys are ignored while the user is typing in a field.
 */
export function resolveShortcut(e: ShortcutEvent, inInput: boolean): ShortcutAction {
  const mod = e.ctrlKey || e.metaKey;

  if (mod && !e.altKey && (e.key === 'f' || e.key === 'F')) return 'focus-search';
  if (e.key === 'Escape') return 'clear-search';

  if (inInput || mod || e.altKey) return null;

  if (e.key === '/') return 'focus-search';
  if (e.key === 'e' || e.key === 'E') return 'expand-all';
  if (e.key === 'c' || e.key === 'C') return 'collapse-all';

  return null;
}

function init(): void {
  browser.storage.sync.get('settings').then((data) => {
    const settings: JvpSettings = (data.settings as JvpSettings) || { enabled: true, theme: 'auto' };
    if (!settings.enabled) return;

    if (!isJsonPage()) return;

    const jsonData = getJsonFromPage();
    if (jsonData === null) return;

    const rawText = document.body.querySelector('pre')!.textContent!;

    // Replace page content
    document.body.textContent = '';
    document.title = 'JSON Viewer Pro \u2014 ' + document.title;

    // Determine theme
    const theme = settings.theme || 'auto';
    let darkMode = false;
    if (theme === 'dark') {
      darkMode = true;
    } else if (theme === 'auto') {
      darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    document.body.className = darkMode ? 'jvp-dark' : 'jvp-light';

    // Inject CSS
    const cssUrl = browser.runtime.getURL('/viewer.css');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl;
    document.head.appendChild(link);

    // Build UI
    const root = el('div', 'jvp-root');
    root.appendChild(createToolbar(jsonData, rawText));

    const treeContainer = el('div', 'jvp-tree-container');
    treeContainer.id = 'jvp-tree';
    treeContainer.appendChild(renderValue(jsonData, null, 0, '$'));
    root.appendChild(treeContainer);

    const rawContainer = el('pre', 'jvp-raw jvp-hidden');
    rawContainer.id = 'jvp-raw';
    // The untouched response body — not a re-serialisation of the parsed value.
    rawContainer.textContent = rawText;
    root.appendChild(rawContainer);

    document.body.appendChild(root);

    // Keyboard shortcuts. These are plain in-page listeners: the `commands`
    // manifest key (and its permission prompt) is not needed for them.
    document.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      const inInput = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      const action = resolveShortcut(e, inInput);
      if (!action) return;

      const search = document.getElementById('jvp-search') as HTMLInputElement | null;

      if (action === 'focus-search') {
        e.preventDefault();
        search?.focus();
        search?.select();
      } else if (action === 'clear-search') {
        if (!search || (!search.value && document.activeElement !== search)) return;
        e.preventDefault();
        search.value = '';
        search.dispatchEvent(new Event('input'));
        search.blur();
      } else if (action === 'expand-all') {
        e.preventDefault();
        expandAll();
      } else if (action === 'collapse-all') {
        e.preventDefault();
        collapseAll();
      }
    });
  });
}
