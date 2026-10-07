/**
 * The Compare screen: two JSON inputs, then an aligned two-pane diff.
 *
 * The markup and every fixed string live in `entrypoints/viewer/index.html`;
 * this module wires it up. The diff itself is `lib/diff.ts` and the rows come
 * from `lib/diffmodel.ts` (both pure). The list is virtual: only the rows in
 * (or near) the viewport exist as elements, so a multi-megabyte pair costs the
 * same to scroll as a small one.
 */
import { analyze, type ContentClass, type ViewerDoc } from './document';
import { DiffDepthError, diffValues, toPatch, type DiffNode, type DiffOptions, type DiffResult } from './diff';
import { DiffModel, isDiffClose, type DiffRow } from './diffmodel';
import { copyText, el, flashLabel } from './dom';
import { formatCount, formatNumber, formatSize, utf8Length } from './format';
import { LosslessNumber } from './lossless';
import { stringifyJson } from './serialize';
import { rowHeightFor, type Settings } from './settings';
import { resolveTreeKey } from './shortcuts';

/** Files longer than this skip the text box and are kept as a string. */
const EDITOR_LIMIT = 2_000_000;
/** Taller than this and the scroll bar is compressed (browsers cap element height near 33 million px). */
const MAX_SPACER = 8_000_000;
const OVERSCAN = 8;
/** Longer strings are cut in the cell, and the cell says how much is missing. */
const CELL_LIMIT = 300;
const PLACEHOLDER = '{ "paste": "your JSON here" }';

type Side = 'left' | 'right';

interface Parsed {
  doc: ViewerDoc | null;
  value?: unknown;
  /** For an error: where, so the text box can select it. */
  offset?: number;
  message: string;
  tone: 'idle' | 'ok' | 'warn' | 'error';
}

function parseInput(text: string, cls: ContentClass): Parsed {
  if (!text.trim()) return { doc: null, tone: 'idle', message: 'Paste JSON, open a file, or drop one here.' };
  const size = formatSize(utf8Length(text));
  const strict = analyze(text, cls);
  if (strict?.kind === 'json') {
    const what = strict.format === 'ndjson' ? `Valid NDJSON · ${formatNumber((strict.value as unknown[]).length)} lines` : 'Valid JSON';
    return { doc: strict, value: strict.value, tone: 'ok', message: `✓ ${what} · ${size}` };
  }
  const lenient = cls === 'json' ? analyze(text, 'json', { jsonc: true }) : null;
  if (lenient?.kind === 'json') {
    return { doc: lenient, value: lenient.value, tone: 'warn', message: `Valid JSONC, not strict JSON · ${size}. Comments and trailing commas are ignored in the comparison.` };
  }
  const failed = lenient?.kind === 'error' ? lenient : strict?.kind === 'error' ? strict : null;
  if (failed) {
    const e = failed.error;
    return { doc: failed, offset: e.offset, tone: 'error', message: `✗ ${e.message} — line ${formatNumber(e.line)}, column ${formatNumber(e.column)}` };
  }
  return { doc: null, tone: 'error', message: 'This is not JSON.' };
}

class Pane {
  readonly input: HTMLTextAreaElement;
  private readonly status: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly title: HTMLElement;
  private big: string | null = null;
  private name = '';
  private cls: ContentClass = 'json';
  private timer: ReturnType<typeof setTimeout> | undefined;
  parsed: Parsed = { doc: null, tone: 'idle', message: '' };

  constructor(readonly root: HTMLElement, readonly side: Side, private readonly onChange: () => void) {
    this.input = root.querySelector('textarea')!;
    this.status = root.querySelector('.cmp-pane-status')!;
    this.fileInput = root.querySelector('input[type=file]')!;
    this.title = root.querySelector('.cmp-pane-title')!;
    this.input.addEventListener('input', () => {
      this.clearBig();
      this.name = '';
      this.cls = 'json';
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.validate(), this.input.value.length > 200_000 ? 600 : 200);
      this.onChange();
    });
    root.querySelector('[data-act=open]')!.addEventListener('click', () => this.fileInput.click());
    root.querySelector('[data-act=clear]')!.addEventListener('click', () => {
      this.setText('', '');
      this.input.focus();
    });
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (f) void this.openFile(f);
    });
    root.addEventListener('dragover', (e) => {
      if (carriesFiles(e)) {
        e.preventDefault();
        root.classList.add('cmp-drag');
      }
    });
    root.addEventListener('dragleave', (e) => {
      if (!root.contains(e.relatedTarget as Node | null)) root.classList.remove('cmp-drag');
    });
    root.addEventListener('drop', (e) => {
      root.classList.remove('cmp-drag');
      const f = e.dataTransfer?.files[0];
      if (f && carriesFiles(e)) {
        e.preventDefault();
        void this.openFile(f);
      }
    });
    this.validate();
  }

  text(): string {
    return this.big ?? this.input.value;
  }

  get label(): string {
    return this.name || (this.text().trim() ? 'Pasted JSON' : '');
  }

  get bytes(): number {
    return utf8Length(this.text());
  }

  private clearBig(): void {
    if (this.big === null) return;
    this.big = null;
    this.input.placeholder = PLACEHOLDER;
  }

  setText(text: string, name: string, cls: ContentClass = 'json'): void {
    this.name = name;
    this.cls = cls;
    if (text.length > EDITOR_LIMIT) {
      this.big = text;
      this.input.value = '';
      this.input.placeholder = `${name || 'This document'} (${formatSize(utf8Length(text))}) is too large for the text box. Compare uses it as it is; typing here replaces it.`;
    } else {
      this.clearBig();
      this.input.value = text;
    }
    clearTimeout(this.timer);
    this.validate();
    this.onChange();
  }

  async openFile(file: File): Promise<void> {
    this.setText(await file.text(), file.name, /\.(?:ndjson|jsonl)$/i.test(file.name) ? 'ndjson' : 'json');
  }

  /** Parse now (cached until the text changes) and show what was found. */
  validate(): Parsed {
    this.parsed = parseInput(this.text(), this.cls);
    this.status.className = `cmp-pane-status ${this.parsed.tone}`;
    this.status.textContent = this.parsed.message;
    this.title.textContent = this.label ? ` — ${this.label}` : '';
    return this.parsed;
  }

  /** Put the caret on the syntax error. */
  showError(): void {
    if (this.parsed.offset === undefined || this.big !== null) return;
    this.input.focus();
    this.input.setSelectionRange(this.parsed.offset, this.parsed.offset + 1);
  }
}

const carriesFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

export interface CompareController {
  /** Put `text` on the left (the document being viewed or edited) and show the screen. */
  open(left: { text: string; name: string; cls: ContentClass }): void;
  /** Apply changed settings (row height). */
  applySettings(settings: Settings): void;
  /** True while the result is showing (not the inputs). */
  readonly showingResult: boolean;
}

export function initCompare(root: HTMLElement, getSettings: () => Settings): CompareController {
  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const inputsEl = q<HTMLElement>('#cmp-inputs');
  const resultEl = q<HTMLElement>('#cmp-result');
  const runBtn = q<HTMLButtonElement>('#cmp-run');
  const editBtn = q<HTMLButtonElement>('#cmp-edit');
  const swapBtn = q<HTMLButtonElement>('#cmp-swap');
  const prevBtn = q<HTMLButtonElement>('#cmp-prev');
  const nextBtn = q<HTMLButtonElement>('#cmp-next');
  const patchBtn = q<HTMLButtonElement>('#cmp-patch');
  const expandBtn = q<HTMLButtonElement>('#cmp-expand');
  const collapseBtn = q<HTMLButtonElement>('#cmp-collapse');
  const ignoreOrder = q<HTMLInputElement>('#cmp-ignore-order');
  const unordered = q<HTMLInputElement>('#cmp-unordered');
  const changesOnly = q<HTMLInputElement>('#cmp-changes-only');
  const position = q<HTMLElement>('#cmp-position');
  const summary = q<HTMLElement>('#cmp-summary');
  const live = q<HTMLElement>('#cmp-live');
  const message = q<HTMLElement>('#cmp-message');
  const headLeft = q<HTMLElement>('#cmp-head-left');
  const headRight = q<HTMLElement>('#cmp-head-right');
  const tree = q<HTMLElement>('#cmp-tree');
  const spacer = q<HTMLElement>('#cmp-spacer');
  const win = q<HTMLElement>('#cmp-window');
  const empty = q<HTMLElement>('#cmp-empty');

  const left = new Pane(q('#cmp-pane-left'), 'left', () => {});
  const right = new Pane(q('#cmp-pane-right'), 'right', () => {});

  let model: DiffModel | null = null;
  let result: DiffResult | null = null;
  /** Row selected in the tree (a node or a closing row). */
  let selected: DiffRow | null = null;
  /** Latest comparison number, so a slow one finishing late is dropped. */
  let run = 0;
  let rowH = rowHeightFor(getSettings().fontSize);
  let raf = 0;

  const options = (): DiffOptions => ({ ignoreKeyOrder: ignoreOrder.checked, unorderedArrays: unordered.checked });
  const announce = (text: string) => {
    live.textContent = '';
    // A change of text is what screen readers announce; clearing first makes repeats count.
    setTimeout(() => (live.textContent = text), 30);
  };

  // ---------- the two screens inside Compare ----------

  function showInputs(): void {
    run++;
    resultEl.hidden = true;
    inputsEl.hidden = false;
    for (const b of [prevBtn, nextBtn, patchBtn, expandBtn, collapseBtn, editBtn]) b.disabled = true;
    changesOnly.disabled = true;
    runBtn.hidden = false;
    swapBtn.hidden = false;
    editBtn.hidden = true;
    position.textContent = '';
    message.textContent = '';
    (left.text().trim() && !right.text().trim() ? right.input : left.input).focus();
  }

  function showResult(): void {
    inputsEl.hidden = true;
    resultEl.hidden = false;
    runBtn.hidden = true;
    swapBtn.hidden = true;
    editBtn.hidden = false;
    editBtn.disabled = false;
    changesOnly.disabled = false;
  }

  async function compare(): Promise<void> {
    const l = left.validate();
    const r = right.validate();
    if (l.doc?.kind !== 'json' || r.doc?.kind !== 'json') {
      message.textContent = !left.text().trim() || !right.text().trim() ? 'Both sides need a document.' : 'Fix the highlighted syntax error first.';
      if (l.tone === 'error') left.showError();
      else if (r.tone === 'error') right.showError();
      else (left.text().trim() ? right : left).input.focus();
      return;
    }
    message.textContent = '';
    const mine = ++run;
    runBtn.disabled = true;
    summary.textContent = 'Comparing…';
    showResult();
    tree.hidden = true;
    empty.hidden = true;
    // Let the browser paint "Comparing…" before the synchronous walk.
    await new Promise((res) => setTimeout(res, 30));
    if (mine !== run) return;
    try {
      result = diffValues(l.value, r.value, options());
    } catch (e) {
      result = null;
      model = null;
      summary.textContent = e instanceof DiffDepthError ? e.message : 'The comparison failed.';
      runBtn.disabled = false;
      return;
    }
    runBtn.disabled = false;
    model = new DiffModel(result);
    selected = null;
    headLeft.textContent = `Left — ${left.label}`;
    headRight.textContent = `Right — ${right.label}`;
    headLeft.title = `${left.label} · ${formatSize(left.bytes)}`;
    headRight.title = `${right.label} · ${formatSize(right.bytes)}`;
    changesOnly.checked = changesOnly.checked && result.changes.length > 0;
    model.setChangesOnly(changesOnly.checked);
    present();
    if (result.changes.length > 0) tree.focus({ preventScroll: true });
  }

  /** Show the model: summary line, buttons, and the list (or the "identical" message). */
  function present(): void {
    if (!result || !model) return;
    const n = result.changes.length;
    let added = 0;
    let removed = 0;
    let changed = 0;
    let reordered = 0;
    for (const c of result.changes) {
      if (c.kind === 'added') added++;
      else if (c.kind === 'removed') removed++;
      else if (c.kind === 'changed') changed++;
      else reordered++;
    }
    const parts = [added && `${formatNumber(added)} added`, removed && `${formatNumber(removed)} removed`, changed && `${formatNumber(changed)} changed`, reordered && `key order differs in ${formatNumber(reordered)} object${reordered === 1 ? '' : 's'}`].filter(Boolean);
    summary.textContent = n === 0 ? 'No differences' : `${formatNumber(n)} difference${n === 1 ? '' : 's'} · ${parts.join(' · ')}`;
    for (const b of [prevBtn, nextBtn, patchBtn, expandBtn, collapseBtn]) b.disabled = n === 0;
    empty.hidden = n !== 0;
    tree.hidden = n === 0;
    position.textContent = n === 0 ? '' : `${formatNumber(n)} to review`;
    if (n === 0) {
      const o = options();
      empty.textContent = `The two documents are identical${o.ignoreKeyOrder ? ' (object key order ignored)' : ''}${o.unorderedArrays ? ' (array order ignored)' : ''}. ${o.ignoreKeyOrder && !o.unorderedArrays ? 'Turn on "Arrays as unordered sets" to also ignore the order of array items.' : ''}`.trim();
      return;
    }
    updateSpacer();
    tree.scrollTop = 0;
    render();
  }

  // ---------- virtual list ----------

  const total = () => (model?.rows.length ?? 0) * rowH;
  const spacerHeight = () => Math.min(total(), MAX_SPACER);
  /** Rows per scrolled pixel when the scroll range is compressed (1 when not). */
  function ratio(): number {
    const vh = tree.clientHeight;
    const s = spacerHeight();
    return s >= total() || s <= vh ? 1 : (total() - vh) / (s - vh);
  }
  function updateSpacer(): void {
    spacer.style.height = `${spacerHeight() + 0}px`;
  }
  /** Row index at the top of the viewport. */
  function firstRow(): number {
    return Math.floor((tree.scrollTop * ratio()) / rowH);
  }
  /** Scroll offset (px) that puts row `i` at the top. */
  const offsetOf = (i: number) => (i * rowH) / ratio();

  function ensureVisible(i: number, center = false): void {
    const vh = tree.clientHeight;
    const top = offsetOf(i);
    const bottom = top + rowH / ratio();
    if (center && (top < tree.scrollTop || bottom > tree.scrollTop + vh)) tree.scrollTop = Math.max(0, top - vh / 2 + rowH);
    else if (top < tree.scrollTop) tree.scrollTop = top;
    else if (bottom > tree.scrollTop + vh) tree.scrollTop = bottom - vh;
    render();
  }

  function render(): void {
    cancelAnimationFrame(raf);
    if (!model) return;
    const rows = model.rows;
    const vh = tree.clientHeight || 600;
    const first = Math.max(0, firstRow() - OVERSCAN);
    const last = Math.min(rows.length, firstRow() + Math.ceil(vh / rowH) + OVERSCAN);
    const compressed = ratio() !== 1;
    win.style.top = `${compressed ? tree.scrollTop - (tree.scrollTop * ratio() - first * rowH) : first * rowH}px`;
    const selIndex = selected ? indexOfSelected() : -1;
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) frag.append(renderRow(rows[i]!, i, i === selIndex));
    win.replaceChildren(frag);
    if (selIndex >= 0) tree.setAttribute('aria-activedescendant', rowId(rows[selIndex]!));
    else tree.removeAttribute('aria-activedescendant');
  }

  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
  };

  function indexOfSelected(): number {
    return selected && model ? model.rows.indexOf(selected) : -1;
  }

  function select(i: number, scroll = true): void {
    if (!model) return;
    selected = model.rows[Math.max(0, Math.min(model.rows.length - 1, i))] ?? null;
    if (scroll && selected) ensureVisible(indexOfSelected());
    else render();
  }

  // ---------- keeping the selection when rows come and go ----------

  function toggleAt(i: number): void {
    if (!model) return;
    const row = model.rows[i];
    if (!row || isDiffClose(row)) return;
    if (row.expanded && row.expandable) model.collapseAt(i);
    else model.expandAt(i);
    // A selection inside a collapsed subtree moves up to the container.
    if (selected && model.indexOf(selected) < 0) selected = row;
    updateSpacer();
    render();
  }

  // ---------- change navigation ----------

  function go(dir: 1 | -1): void {
    if (!model || !result) return;
    const hit = model.step(indexOfSelected(), dir);
    if (!hit) return;
    const i = model.reveal(hit.node);
    if (i < 0) return;
    updateSpacer();
    selected = hit.node;
    ensureVisible(i, true);
    tree.focus({ preventScroll: true });
    const n = result.changes.length;
    const text = `Difference ${formatNumber(hit.node.seq + 1)} of ${formatNumber(n)}`;
    position.textContent = text;
    announce(`${hit.wrapped ? (dir === 1 ? 'Back at the first difference. ' : 'On the last difference. ') : ''}${text}: ${describe(hit.node)}`);
  }

  // ---------- events ----------

  tree.addEventListener('scroll', schedule, { passive: true });
  new ResizeObserver(() => {
    if (model && !tree.hidden) {
      updateSpacer();
      schedule();
    }
  }).observe(tree);

  tree.addEventListener('click', (e) => {
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.cmp-row');
    if (!rowEl || !model) return;
    const i = Number(rowEl.dataset.i);
    selected = model.rows[i] ?? null;
    const row = model.rows[i];
    if (row && !isDiffClose(row) && row.expandable) toggleAt(i);
    else render();
    tree.focus({ preventScroll: true });
  });

  tree.addEventListener('keydown', (e) => {
    if (!model) return;
    const mod = e.ctrlKey || e.metaKey;
    // Differences: n / p, F3 / Shift+F3, Alt+Down / Alt+Up.
    if ((!mod && !e.altKey && (e.key === 'n' || e.key === 'N')) || (e.key === 'F3' && !e.shiftKey) || (e.altKey && e.key === 'ArrowDown')) {
      e.preventDefault();
      go(1);
      return;
    }
    if ((!mod && !e.altKey && (e.key === 'p' || e.key === 'P')) || (e.key === 'F3' && e.shiftKey) || (e.altKey && e.key === 'ArrowUp')) {
      e.preventDefault();
      go(-1);
      return;
    }
    const action = resolveTreeKey(e);
    if (!action) return;
    const rows = model.rows;
    const i = indexOfSelected();
    const row = i >= 0 ? rows[i]! : null;
    const page = Math.max(1, Math.floor(tree.clientHeight / rowH) - 1);
    let handled = true;
    switch (action) {
      case 'down':
        select(i < 0 ? 0 : i + 1);
        break;
      case 'up':
        select(i < 0 ? 0 : i - 1);
        break;
      case 'home':
        select(0);
        break;
      case 'end':
        select(rows.length - 1);
        break;
      case 'page-down':
        select(i < 0 ? page : i + page);
        break;
      case 'page-up':
        select(i < 0 ? 0 : i - page);
        break;
      case 'right':
        if (row && !isDiffClose(row) && row.expandable) {
          if (!row.expanded) toggleAt(i);
          else select(i + 1);
        }
        break;
      case 'left':
        if (row && isDiffClose(row)) select(rows.indexOf(row.closeOf));
        else if (row && row.expanded && row.expandable) toggleAt(i);
        else if (row?.parent) select(rows.indexOf(row.parent));
        break;
      case 'toggle':
        if (row && !isDiffClose(row) && row.expandable) toggleAt(i);
        break;
      case 'expand-subtree':
        if (row && !isDiffClose(row) && row.expandable) {
          const complete = model.expandSubtree(row);
          updateSpacer();
          render();
          if (!complete) announce('Stopped opening at 200,000 containers.');
        }
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  });

  runBtn.addEventListener('click', () => void compare());
  editBtn.addEventListener('click', showInputs);
  swapBtn.addEventListener('click', () => {
    const a = { text: left.text(), name: left.label === 'Pasted JSON' ? '' : left.label };
    const b = { text: right.text(), name: right.label === 'Pasted JSON' ? '' : right.label };
    left.setText(b.text, b.name);
    right.setText(a.text, a.name);
  });
  prevBtn.addEventListener('click', () => go(-1));
  nextBtn.addEventListener('click', () => go(1));
  expandBtn.addEventListener('click', () => {
    if (!model?.result.root) return;
    const complete = model.expandSubtree(model.result.root);
    updateSpacer();
    render();
    announce(complete ? 'Everything is open.' : 'Opened what fits; the rest stays closed.');
  });
  collapseBtn.addEventListener('click', () => {
    model?.collapseAll();
    selected = model?.rows[0] ?? null;
    updateSpacer();
    tree.scrollTop = 0;
    render();
  });
  changesOnly.addEventListener('change', () => {
    if (!model) return;
    model.setChangesOnly(changesOnly.checked);
    if (selected && model.indexOf(selected) < 0) selected = null;
    updateSpacer();
    tree.scrollTop = selected ? offsetOf(Math.max(0, indexOfSelected() - 3)) : 0;
    render();
  });
  for (const box of [ignoreOrder, unordered]) {
    box.addEventListener('change', () => {
      if (!resultEl.hidden) void compare();
    });
  }
  patchBtn.addEventListener('click', () => {
    if (!result) return;
    const ops = toPatch(result);
    const text = stringifyJson(ops, 2, true);
    flashLabel(patchBtn, copyText(text), 'Copied');
    announce(`Copied a JSON Patch with ${formatNumber(ops.length)} operation${ops.length === 1 ? '' : 's'}.`);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !inputsEl.hidden) {
      e.preventDefault();
      void compare();
    }
  });

  return {
    open(l) {
      left.setText(l.text, l.name, l.cls);
      showInputs();
    },
    applySettings(s) {
      rowH = rowHeightFor(s.fontSize);
      if (model && !tree.hidden) {
        updateSpacer();
        render();
      }
    },
    get showingResult() {
      return !resultEl.hidden;
    },
  };
}

// ---------- rows ----------

const rowId = (r: DiffRow) => (isDiffClose(r) ? `jvp-cc${r.closeOf.id}` : `jvp-cr${r.id}`);

const ARIA_KIND: Record<DiffNode['kind'], string> = { equal: 'unchanged', added: 'added', removed: 'removed', changed: 'changed', modified: 'modified' };
const MARK: Record<DiffNode['kind'], string> = { equal: '', added: '+', removed: '−', changed: '~', modified: '' };

function preview(v: unknown): string {
  if (Array.isArray(v)) return `array of ${formatCount('array', v.length)}`;
  if (v !== null && typeof v === 'object' && !(v instanceof LosslessNumber)) return `object with ${formatCount('object', Object.keys(v).length)}`;
  const t = v instanceof LosslessNumber ? v.source : JSON.stringify(v);
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

/** A sentence for screen readers (and the live region) about one row. */
export function describe(n: DiffNode): string {
  const where = n.parent ? `${typeof n.key === 'number' ? `item ${n.key}` : `key ${n.key}`}` : 'the document';
  switch (n.kind) {
    case 'added':
      return `${where} added, ${preview(n.right)}`;
    case 'removed':
      return `${where} removed, was ${preview(n.left)}`;
    case 'changed':
      return `${where} changed from ${preview(n.left)} to ${preview(n.right)}`;
    case 'modified':
      return n.reordered ? `${where}, key order differs` : `${where}, ${formatNumber(n.count)} difference${n.count === 1 ? '' : 's'} inside`;
    default:
      return `${where} unchanged, ${preview(n.left)}`;
  }
}

function valueSpan(v: unknown): HTMLElement {
  if (v === null) return el('span', 'jvp-null', 'null');
  if (typeof v === 'boolean') return el('span', 'jvp-boolean', String(v));
  if (typeof v === 'number') return el('span', 'jvp-number', String(v));
  if (v instanceof LosslessNumber) return el('span', 'jvp-number', v.source);
  const s = String(v);
  const wrap = el('span', 'jvp-string');
  if (s.length <= CELL_LIMIT) {
    wrap.textContent = JSON.stringify(s);
  } else {
    // Cut, and say so: the full text is in the tooltip up to 2,000 characters, and in the inputs.
    wrap.textContent = `${JSON.stringify(s.slice(0, CELL_LIMIT)).slice(0, -1)}…"`;
    wrap.append(el('span', 'jvp-count', ` (+${formatNumber(s.length - CELL_LIMIT)} characters)`));
    wrap.title = s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
  }
  return wrap;
}

function renderCell(n: DiffNode, side: 'l' | 'r', open: boolean): HTMLElement {
  const c = el('div', `cmp-cell cmp-${side}`);
  c.style.setProperty('--d', String(n.depth));
  const present = side === 'l' ? n.kind !== 'added' : n.kind !== 'removed';
  if (!present) {
    c.classList.add('cmp-gap');
    c.setAttribute('aria-hidden', 'true');
    return c;
  }
  const v = side === 'l' || n.kind === 'equal' ? n.left : n.right;
  const k = side === 'l' ? n.key : n.rightKey;
  if (n.kind === 'added' || (n.kind === 'changed' && side === 'r')) c.classList.add('cmp-add');
  else if (n.kind === 'removed' || (n.kind === 'changed' && side === 'l')) c.classList.add('cmp-del');

  const container = v !== null && typeof v === 'object' && !(v instanceof LosslessNumber);
  if (n.expandable) {
    c.classList.toggle('cmp-open', open);
    c.append(el('span', 'cmp-toggle'));
  }
  if (k !== null) {
    c.append(el('span', typeof k === 'number' ? 'jvp-index' : 'jvp-key', typeof k === 'number' ? String(k) : JSON.stringify(k)));
    c.append(el('span', 'jvp-colon', ': '));
  }
  if (container) {
    const arr = Array.isArray(v);
    const size = arr ? (v as unknown[]).length : Object.keys(v as object).length;
    if (open && n.expandable) {
      c.append(el('span', 'jvp-bracket', arr ? '[' : '{'));
    } else {
      c.append(el('span', 'jvp-bracket', size === 0 ? (arr ? '[]' : '{}') : arr ? '[…]' : '{…}'));
      if (size > 0) c.append(el('span', 'jvp-count', formatCount(arr ? 'array' : 'object', size)));
      if (side === 'r' && n.kind === 'modified') c.append(el('span', 'cmp-badge', `${formatNumber(n.count)} change${n.count === 1 ? '' : 's'}`));
    }
  } else {
    c.append(valueSpan(v));
  }
  if (n.kind === 'modified' && n.reordered && side === 'r') c.append(el('span', 'cmp-badge', 'keys reordered'));
  return c;
}

function renderRow(r: DiffRow, i: number, selected: boolean): HTMLElement {
  const row = el('div', 'cmp-row');
  row.dataset.i = String(i);
  row.id = rowId(r);
  row.style.setProperty('--i', String(i));
  if (isDiffClose(r)) {
    const n = r.closeOf;
    row.classList.add(`cmp-k-${n.kind}`);
    row.setAttribute('role', 'none');
    row.setAttribute('aria-hidden', 'true');
    row.append(el('span', 'cmp-mark'));
    for (const side of ['l', 'r'] as const) {
      const c = el('div', `cmp-cell cmp-${side}`);
      c.style.setProperty('--d', String(n.depth));
      const has = side === 'l' ? n.kind !== 'added' : n.kind !== 'removed';
      if (!has) c.classList.add('cmp-gap');
      else {
        if (n.kind === 'added') c.classList.add('cmp-add');
        if (n.kind === 'removed') c.classList.add('cmp-del');
        c.append(el('span', 'jvp-bracket', Array.isArray(n.left ?? n.right) ? ']' : '}'));
      }
      row.append(c);
    }
    if (selected) row.classList.add('cmp-selected');
    return row;
  }
  const open = r.expanded && r.expandable;
  row.classList.add(`cmp-k-${r.kind}`);
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-level', String(r.depth + 1));
  row.setAttribute('aria-selected', String(selected));
  row.setAttribute('aria-label', describe(r));
  if (r.expandable) row.setAttribute('aria-expanded', String(open));
  if (selected) row.classList.add('cmp-selected');
  const mark = el('span', 'cmp-mark', r.reordered ? '⇅' : MARK[r.kind]);
  mark.setAttribute('aria-hidden', 'true');
  mark.title = r.reordered ? 'Key order differs' : ARIA_KIND[r.kind];
  row.append(mark, renderCell(r, 'l', open), renderCell(r, 'r', open));
  return row;
}
