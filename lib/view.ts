/**
 * DOM rendering of a TreeModel.
 *
 * Two layouts over the same row list:
 * - full    — up to FULL_RENDER_LIMIT rows are all in the DOM, in normal flow,
 *             so long values wrap and text selection works as on any page;
 * - virtual — beyond that, only the rows in (and just around) the viewport
 *             exist, positioned inside a spacer as tall as the whole list, so
 *             a million rows cost the same to show as sixty.
 *
 * The container is a WAI-ARIA `tree`: it keeps keyboard focus itself and points
 * `aria-activedescendant` at the selected `treeitem`, so re-rendering rows never
 * loses focus. Every row is a flat element carrying its depth in `--d`; one
 * delegated listener per event type serves them all.
 */
import { formatCount, formatNumber, formatUtc, isHexColor, isImageUrl, isUrl, relativeTime, timestampMillis } from './format';
import { icon } from './icons';
import { LosslessNumber } from './lossless';
import { primitiveText } from './search';
import { resolveTreeKey } from './shortcuts';
import { isCloseRow, pathOf, TNode, type Row, type TreeModel } from './tree';

export const FULL_RENDER_LIMIT = 3000;
/** Largest spacer we let the page grow to; comfortably below every engine's element-height limit. */
const MAX_SCROLL_PX = 8_000_000;
const OVERSCAN = 15;
/** Characters of a string shown before a "show more" affordance. */
const STRING_CLIP = 10_000;
/** Most child nodes one "expand all" or Alt+click may open before it stops and says so. */
export const EXPAND_LIMIT = 2_000_000;

export interface TreeViewHooks {
  /** The active search, if any. */
  highlight(): RegExp | null;
  /** Is `node` the currently selected search match? */
  isCurrent(node: TNode): boolean;
  /** Height of whatever sticks to the top of the viewport (the header). */
  topInset(): number;
  /** A subtree expand stopped at its safety limit; `expandFully` lifts it. */
  onLimit?(expandFully: () => void): void;
  /** The selected row changed. */
  onSelect?(node: TNode): void;
  /** Open the actions menu for `node`, anchored at `anchor`. */
  onMenu?(node: TNode, anchor: HTMLElement): void;
  /** Keyboard copy of the selected node: its value as JSON, or its path. */
  onCopy?(node: TNode, what: 'value' | 'path'): void;
  /** May hovering an image URL show a thumbnail? */
  imagePreview?(): boolean;
}

function span(className: string, text?: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  if (text !== undefined) s.textContent = text;
  return s;
}

const rowId = (node: TNode) => `jvp-r${node.id}`;

export class TreeView {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private rowEls: HTMLElement[] = [];
  private readonly rowOf = new WeakMap<Element, Row>();
  private virtual = false;
  private windowFrom = 0;
  private bodyTop = 0;
  private frame = 0;
  private rowHeight = 20;
  private readonly fullStrings = new WeakSet<TNode>();
  private globalRe: RegExp | null = null;
  private globalReFor: RegExp | null = null;
  private selected: TNode | null = null;
  private selIndex = -1;
  private preview: HTMLElement | null = null;

  constructor(
    readonly model: TreeModel,
    private readonly hooks: TreeViewHooks,
    signal?: AbortSignal,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'jvp-tree';
    this.el.id = 'jvp-tree';
    this.el.tabIndex = 0;
    this.el.setAttribute('role', 'tree');
    this.el.setAttribute('aria-label', 'JSON document');
    this.body = document.createElement('div');
    this.body.className = 'jvp-rows';
    this.el.appendChild(this.body);

    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.el.addEventListener('mousedown', () => this.el.classList.remove('jvp-kbd'));
    this.el.addEventListener('focus', () => {
      if (!this.selected && this.model.rows.length) this.select(0, false);
    });
    this.el.addEventListener('mouseover', (e) => this.onHover(e));
    this.el.addEventListener('mouseout', (e) => {
      const from = (e.target as Element).closest?.('.jvp-img-url');
      const to = (e.relatedTarget as Element | null)?.closest?.('.jvp-img-url');
      if (from && from !== to) this.hidePreview();
    });
    window.addEventListener('scroll', () => this.schedule(), { passive: true, signal });
    window.addEventListener(
      'resize',
      () => {
        if (!this.virtual) return;
        this.measure();
        this.schedule();
      },
      { signal },
    );
    signal?.addEventListener('abort', () => {
      cancelAnimationFrame(this.frame);
      this.preview?.remove();
    });
  }

  get selectedNode(): TNode | null {
    return this.selected;
  }

  /** Row height in px; follows the font size setting. */
  setRowHeight(px: number): void {
    if (px === this.rowHeight) return;
    this.rowHeight = px;
    if (!this.el.isConnected) return;
    const keep = this.selectedIndex();
    this.refresh();
    if (keep >= 0) this.scrollToRow(keep, 'center');
  }

  /**
   * Re-render from the model. With `keep`, the row at that index stays at
   * screen position `keepY` (captured before the model changed).
   */
  refresh(keep?: number, keepY?: number | null): void {
    this.hidePreview();
    this.virtual = this.model.rows.length > FULL_RENDER_LIMIT;
    this.el.classList.toggle('jvp-virtual', this.virtual);
    this.el.setAttribute('aria-rowcount', String(this.model.rows.length));
    const re = this.hooks.highlight();
    if (re !== this.globalReFor) {
      this.globalReFor = re;
      this.globalRe = re ? new RegExp(re.source, 'gi') : null;
    }
    this.selIndex = -1;

    if (this.virtual) {
      this.rowEls = [];
      // Size the spacer before any scroll, or the scroll is clamped to the old height.
      this.body.style.height = `${Math.min(this.model.rows.length * this.rowHeight, MAX_SCROLL_PX)}px`;
      this.measure();
      if (keep !== undefined && keepY !== undefined && keepY !== null) this.scrollRowTo(keep, keepY);
      this.renderWindow();
      return;
    }

    this.body.style.height = '';
    const rows = this.model.rows;
    const frag = document.createDocumentFragment();
    const els = new Array<HTMLElement>(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const e = this.renderRow(rows[i]!);
      els[i] = e;
      frag.appendChild(e);
    }
    this.rowEls = els;
    this.body.replaceChildren(frag);
    if (keep !== undefined && keepY !== undefined && keepY !== null) this.scrollRowTo(keep, keepY);
  }

  /** Expand or collapse the container at row `index` (recursively with `deep`). */
  toggleAt(index: number, deep = false): void {
    const node = this.model.rows[index];
    if (!(node instanceof TNode) || !node.expandable) return;
    if (deep) {
      if (node.expanded) this.collapseSubtreeAt(index);
      else this.expandSubtreeAt(index);
      return;
    }
    const y = this.rowScreenY(index);
    const delta = this.model.toggleAt(index);
    if (!this.virtual && this.model.rows.length <= FULL_RENDER_LIMIT) this.patch(index, delta);
    else this.refresh(index, y);
    this.keepSelectionVisible(index);
  }

  expandSubtreeAt(index: number): void {
    const node = this.model.rows[index];
    if (!(node instanceof TNode) || !node.expandable) return;
    const y = this.rowScreenY(index);
    if (!this.model.expandSubtreeAt(index, EXPAND_LIMIT)) {
      this.hooks.onLimit?.(() => {
        const at = this.model.indexOfNode(node);
        if (at < 0) return;
        this.model.expandSubtreeAt(at);
        this.refresh();
      });
    }
    this.refresh(index, y);
  }

  collapseSubtreeAt(index: number): void {
    const node = this.model.rows[index];
    if (!(node instanceof TNode) || !node.expandable) return;
    const y = this.rowScreenY(index);
    this.model.collapseAt(index);
    const stack: TNode[] = [node];
    while (stack.length) {
      const n = stack.pop()!;
      n.expanded = false;
      if (n.children) for (const c of n.children) if (c.expanded) stack.push(c);
    }
    this.refresh(index, y);
    this.keepSelectionVisible(index);
  }

  // ---------- selection ----------

  /** Row index of the selected node, or -1 when nothing is selected or it is hidden. */
  selectedIndex(): number {
    if (!this.selected) return -1;
    const rows = this.model.rows;
    if (rows[this.selIndex] !== this.selected) this.selIndex = rows.indexOf(this.selected);
    return this.selIndex;
  }

  select(index: number, scroll = true): void {
    const row = this.model.rows[index];
    if (!(row instanceof TNode)) return;
    const prev = this.selected;
    this.selected = row;
    this.selIndex = index;
    if (prev && prev !== row) {
      const old = document.getElementById(rowId(prev));
      old?.classList.remove('jvp-row-selected');
      old?.removeAttribute('aria-selected');
    }
    const e = document.getElementById(rowId(row));
    e?.classList.add('jvp-row-selected');
    e?.setAttribute('aria-selected', 'true');
    this.el.setAttribute('aria-activedescendant', rowId(row));
    if (scroll) this.scrollToRow(index, 'nearest');
    if (prev !== row) this.hooks.onSelect?.(row);
  }

  /** Select `node`, opening its ancestors if needed. */
  selectNode(node: TNode, scroll = true): void {
    let index = this.model.indexOfNode(node);
    if (index < 0) {
      index = this.model.reveal(pathOf(node));
      if (index < 0) return;
      this.refresh();
    }
    this.select(index, false);
    if (scroll) this.scrollToRow(index, 'center');
  }

  /** After collapsing the node at `index`, move a selection it hid onto it. */
  private keepSelectionVisible(index: number): void {
    if (this.selected && this.selectedIndex() < 0) this.select(index, false);
  }

  /** Scroll so row `index` is visible (`nearest`) or centred. */
  scrollToRow(index: number, align: 'nearest' | 'center' = 'nearest'): void {
    const top = this.hooks.topInset();
    const vh = window.innerHeight;
    const y = this.rowScreenY(index);
    const h = this.rowHeight;
    if (align === 'nearest' && y !== null && y >= top && y + h <= vh) return;
    let target: number;
    if (align === 'center') target = Math.round((top + vh - h) / 2);
    else target = y !== null && y < top ? top : vh - h;
    this.scrollRowTo(index, target);
  }

  /** The element currently showing row `index`, if it is rendered. */
  elementForRow(index: number): HTMLElement | null {
    const row = this.model.rows[index];
    return row instanceof TNode ? document.getElementById(rowId(row)) : null;
  }

  // ---------- layout ----------

  private measure(): void {
    this.bodyTop = this.body.getBoundingClientRect().top + window.scrollY;
  }

  private schedule(): void {
    this.hidePreview();
    if (!this.virtual || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderWindow();
    });
  }

  /**
   * Scroll geometry for the virtual layout. Row i sits at body offset
   * `scroll + (i - exact) * rowHeight`, where `exact` is the fractional row
   * at the top of the viewport. `k` compresses scrolling when the list is taller
   * than MAX_SCROLL_PX (k = 1 otherwise).
   */
  private geometry() {
    const h = this.rowHeight;
    const n = this.model.rows.length;
    const vh = window.innerHeight;
    const total = n * h;
    const spacer = Math.min(total, MAX_SCROLL_PX);
    const maxScroll = Math.max(0, spacer - vh);
    const rowsBelowFold = Math.max(0, n - vh / h);
    const k = total > MAX_SCROLL_PX && rowsBelowFold > 0 ? maxScroll / (rowsBelowFold * h) : 1;
    const scroll = Math.min(maxScroll, Math.max(0, window.scrollY - this.bodyTop));
    const exact = scroll / (k * h);
    return { n, vh, spacer, k, scroll, exact };
  }

  private renderWindow(): void {
    if (!this.virtual || !this.el.isConnected || this.el.classList.contains('jvp-hidden')) return;
    const g = this.geometry();
    const h = this.rowHeight;
    this.body.style.height = `${g.spacer}px`;
    const first = Math.floor(g.exact);
    const from = Math.max(0, first - OVERSCAN);
    const to = Math.min(g.n, first + Math.ceil(g.vh / h) + 1 + OVERSCAN);
    const frag = document.createDocumentFragment();
    const rows = this.model.rows;
    for (let i = from; i < to; i++) {
      const e = this.renderRow(rows[i]!);
      e.style.top = `${Math.round(g.scroll + (i - g.exact) * h)}px`;
      frag.appendChild(e);
    }
    this.windowFrom = from;
    this.body.replaceChildren(frag);
  }

  private rowScreenY(index: number): number | null {
    if (!this.virtual) {
      const e = this.rowEls[index];
      return e ? e.getBoundingClientRect().top : null;
    }
    const g = this.geometry();
    return this.bodyTop - window.scrollY + g.scroll + (index - g.exact) * this.rowHeight;
  }

  private scrollRowTo(index: number, screenY: number): void {
    if (!this.virtual) {
      const e = this.rowEls[index];
      if (e) window.scrollBy(0, e.getBoundingClientRect().top - screenY);
      return;
    }
    // On screen, row i sits at (i * rowHeight - scroll / k); solve for scroll.
    const g = this.geometry();
    window.scrollTo(window.scrollX, this.bodyTop + (index * this.rowHeight - screenY) * g.k);
    this.renderWindow();
  }

  /** Full layout only: apply a toggle at `index` without rebuilding every row. */
  private patch(index: number, delta: number): void {
    const rows = this.model.rows;
    const old = this.rowEls[index];
    if (!old) {
      this.refresh();
      return;
    }
    const fresh = this.renderRow(rows[index]!);
    old.replaceWith(fresh);
    this.rowEls[index] = fresh;
    if (delta > 0) {
      const frag = document.createDocumentFragment();
      const added: HTMLElement[] = [];
      for (let i = index + 1; i <= index + delta; i++) {
        const e = this.renderRow(rows[i]!);
        added.push(e);
        frag.appendChild(e);
      }
      fresh.after(frag);
      this.rowEls.splice(index + 1, 0, ...added);
    } else if (delta < 0) {
      for (const e of this.rowEls.splice(index + 1, -delta)) e.remove();
    }
    this.selIndex = -1;
  }

  // ---------- rows ----------

  private renderRow(row: Row): HTMLElement {
    const e = document.createElement('div');
    this.rowOf.set(e, row);

    if (isCloseRow(row)) {
      e.className = 'jvp-row jvp-close';
      e.setAttribute('role', 'none');
      e.setAttribute('aria-hidden', 'true');
      e.style.setProperty('--d', String(row.closeOf.depth));
      e.appendChild(span('jvp-bracket', row.closeOf.kind === 'array' ? ']' : '}'));
      return e;
    }

    const node = row;
    const re = this.globalRe;
    e.id = rowId(node);
    e.className = node.expandable ? 'jvp-row jvp-expandable' : 'jvp-row';
    e.setAttribute('role', 'treeitem');
    e.setAttribute('aria-level', String(node.depth + 1));
    if (node.parent) {
      e.setAttribute('aria-setsize', String(node.parent.size));
      e.setAttribute('aria-posinset', String(node.index + 1));
    }
    e.style.setProperty('--d', String(node.depth));
    if (this.hooks.isCurrent(node)) e.classList.add('jvp-row-current');
    if (node === this.selected) {
      e.classList.add('jvp-row-selected');
      e.setAttribute('aria-selected', 'true');
    }

    // The arrow is CSS generated content, so it never ends up in copied text.
    if (node.expandable) {
      e.appendChild(span('jvp-toggle'));
      e.setAttribute('aria-expanded', String(node.expanded));
      if (node.expanded) e.classList.add('jvp-open');
    }

    if (node.parent) {
      if (node.parent.kind === 'object') {
        const k = span('jvp-key');
        this.appendText(k, JSON.stringify(node.key), re);
        e.appendChild(k);
      } else {
        e.appendChild(span('jvp-index', String(node.key)));
      }
      e.appendChild(span('jvp-colon', ': '));
    }

    switch (node.kind) {
      case 'object':
      case 'array': {
        const open = node.kind === 'array' ? '[' : '{';
        const close = node.kind === 'array' ? ']' : '}';
        if (!node.expandable) {
          e.appendChild(span('jvp-bracket', open + close));
        } else if (node.expanded) {
          e.appendChild(span('jvp-bracket', open));
        } else {
          e.appendChild(span('jvp-bracket', open));
          e.appendChild(span('jvp-count', formatCount(node.kind, node.size)));
          e.appendChild(span('jvp-bracket', close));
        }
        break;
      }
      case 'string':
        this.appendString(e, node, re);
        break;
      case 'number': {
        const v = span('jvp-value jvp-number');
        this.appendText(v, primitiveText(node.value), re);
        if (node.value instanceof LosslessNumber) {
          v.classList.add('jvp-lossless');
          v.title = 'Exact value: more digits than a JavaScript number holds, so it is shown and copied exactly as sent';
        } else {
          this.describeTime(v, node);
        }
        e.appendChild(v);
        break;
      }
      default: {
        const v = span(`jvp-value jvp-${node.kind}`);
        this.appendText(v, primitiveText(node.value), re);
        e.appendChild(v);
      }
    }

    const actions = document.createElement('button');
    actions.type = 'button';
    actions.className = 'jvp-actions-btn';
    actions.dataset.act = 'menu';
    actions.tabIndex = -1;
    actions.append(icon('more'));
    actions.title = 'Copy value or path…';
    actions.setAttribute('aria-label', 'Actions');
    actions.setAttribute('aria-haspopup', 'menu');
    e.appendChild(actions);
    return e;
  }

  /** A human date tooltip on values that look like timestamps. */
  private describeTime(v: HTMLElement, node: TNode): void {
    const ms = timestampMillis(node.parent?.kind === 'object' ? node.key : null, node.value);
    if (ms === null) return;
    v.classList.add('jvp-time');
    v.title = `${formatUtc(ms)}\n${new Date(ms).toLocaleString()} (your time)\n${relativeTime(ms, Date.now())}`;
  }

  private appendString(row: HTMLElement, node: TNode, re: RegExp | null): void {
    const s = node.value as string;
    const clipped = s.length > STRING_CLIP && !this.fullStrings.has(node);
    const v = span('jvp-value jvp-string');
    if (!clipped && isHexColor(s)) {
      const swatch = span('jvp-swatch');
      swatch.setAttribute('aria-hidden', 'true');
      swatch.style.backgroundColor = s;
      row.appendChild(swatch);
    }
    if (clipped) {
      this.appendText(v, JSON.stringify(s.slice(0, STRING_CLIP)).slice(0, -1) + '…', re);
    } else if (isUrl(s)) {
      const quoted = JSON.stringify(s);
      v.append('"');
      const a = document.createElement('a');
      a.className = 'jvp-link';
      a.href = s;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      this.appendText(a, quoted.slice(1, -1), re);
      if (isImageUrl(s)) a.classList.add('jvp-img-url');
      v.append(a, '"');
    } else {
      this.appendText(v, JSON.stringify(s), re);
      if (isImageUrl(s)) v.classList.add('jvp-img-url');
      this.describeTime(v, node);
    }
    // Virtual rows are one line and clip long values; the tooltip shows the rest.
    if (this.virtual && s.length > 60 && !v.title) v.title = s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
    row.appendChild(v);
    if (clipped) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'jvp-more';
      more.dataset.act = 'more';
      more.textContent = `show ${formatNumber(s.length - STRING_CLIP)} more characters`;
      row.appendChild(more);
    }
  }

  /** Append `text`, wrapping each match of the global regex `re` in a <mark>. */
  private appendText(parent: HTMLElement, text: string, re: RegExp | null): void {
    if (!re) {
      parent.append(text);
      return;
    }
    re.lastIndex = 0;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (m.index > last) parent.append(text.slice(last, m.index));
      const mark = document.createElement('mark');
      mark.className = 'jvp-search-match';
      mark.textContent = m[0];
      parent.append(mark);
      last = m.index + m[0].length;
    }
    if (last < text.length) parent.append(last === 0 ? text : text.slice(last));
  }

  // ---------- events ----------

  private indexOfElement(rowEl: Element): number {
    const row = this.rowOf.get(rowEl);
    if (!row) return -1;
    if (!this.virtual) return this.rowEls.indexOf(rowEl as HTMLElement);
    return this.model.rows.indexOf(row, this.windowFrom);
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as Element;
    const rowEl = target.closest('.jvp-row');
    if (!rowEl) return;
    const row = this.rowOf.get(rowEl);
    if (!row || isCloseRow(row)) return;
    const index = this.indexOfElement(rowEl);
    if (index < 0) return;

    if (target.closest('a')) {
      this.select(index, false);
      return;
    }
    const act = (target.closest('[data-act]') as HTMLElement | null)?.dataset.act;
    if (act === 'menu') {
      e.stopPropagation();
      this.select(index, false);
      this.hooks.onMenu?.(row, target.closest('button')!);
      return;
    }
    if (act === 'more') {
      this.fullStrings.add(row);
      if (!this.virtual) {
        const fresh = this.renderRow(row);
        rowEl.replaceWith(fresh);
        this.rowEls[index] = fresh;
      } else {
        this.renderWindow();
      }
      return;
    }

    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.anchorNode && rowEl.contains(sel.anchorNode)) return;
    this.select(index, false);
    this.el.focus({ preventScroll: true });
    // The label (arrow, key, bracket, count) toggles; the rest of the row only selects.
    if (row.expandable && target.closest('.jvp-toggle, .jvp-key, .jvp-index, .jvp-colon, .jvp-bracket, .jvp-count')) {
      this.toggleAt(index, e.altKey);
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.target !== this.el) return;
    const action = resolveTreeKey(e);
    if (!action) return;
    this.el.classList.add('jvp-kbd');
    const rows = this.model.rows;
    const index = this.selectedIndex();
    if (index < 0) {
      if (action === 'copy-value' || action === 'copy-path') return;
      e.preventDefault();
      if (rows.length) this.select(0);
      return;
    }
    const node = rows[index] as TNode;
    const page = Math.max(1, Math.floor((window.innerHeight - this.hooks.topInset()) / this.rowHeight) - 1);
    const nodeRowNear = (i: number, dir: 1 | -1) => {
      if (rows[i] instanceof TNode) return i;
      const t = this.model.stepRow(i, dir);
      return t >= 0 ? t : this.model.stepRow(i, dir === 1 ? -1 : 1);
    };
    let target = -1;
    switch (action) {
      case 'down':
        target = this.model.stepRow(index, 1);
        break;
      case 'up':
        target = this.model.stepRow(index, -1);
        break;
      case 'right':
        if (node.expandable && !node.expanded) this.toggleAt(index);
        else if (node.expandable) target = this.model.stepRow(index, 1);
        break;
      case 'left':
        if (node.expandable && node.expanded) this.toggleAt(index);
        else target = this.model.parentRow(index);
        break;
      case 'home':
        target = 0;
        break;
      case 'end':
        target = this.model.lastNodeRow();
        break;
      case 'page-down':
        target = nodeRowNear(Math.min(rows.length - 1, index + page), -1);
        break;
      case 'page-up':
        target = nodeRowNear(Math.max(0, index - page), 1);
        break;
      case 'toggle':
        if (node.expandable) this.toggleAt(index);
        break;
      case 'expand-subtree':
        if (node.expandable) this.expandSubtreeAt(index);
        break;
      case 'copy-value':
      case 'copy-path': {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return; // copying selected text is the browser's job
        this.hooks.onCopy?.(node, action === 'copy-value' ? 'value' : 'path');
        break;
      }
      case 'menu':
        this.scrollToRow(index);
        this.hooks.onMenu?.(node, this.elementForRow(index) ?? this.el);
        break;
    }
    e.preventDefault();
    if (target >= 0) this.select(target);
  }

  // ---------- image preview ----------

  private onHover(e: MouseEvent): void {
    const hit = (e.target as Element).closest?.('.jvp-img-url') as HTMLElement | null;
    if (!hit || !this.hooks.imagePreview?.()) return;
    const rowEl = hit.closest('.jvp-row');
    const node = rowEl ? this.rowOf.get(rowEl) : undefined;
    if (!(node instanceof TNode) || typeof node.value !== 'string') return;
    this.showPreview(node.value, hit);
  }

  private showPreview(src: string, anchor: HTMLElement): void {
    if (!this.preview) {
      const box = document.createElement('div');
      box.className = 'jvp-preview';
      box.setAttribute('role', 'tooltip');
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      const caption = span('jvp-preview-caption');
      img.addEventListener('load', () => {
        caption.textContent = `${formatNumber(img.naturalWidth)} × ${formatNumber(img.naturalHeight)}`;
      });
      img.addEventListener('error', () => {
        caption.textContent = 'Could not load this image (the site or this page’s security policy may block it)';
      });
      box.append(img, caption);
      this.preview = box;
      document.body.appendChild(box);
    }
    const box = this.preview;
    const img = box.querySelector('img')!;
    if (img.getAttribute('src') !== src) {
      (box.querySelector('.jvp-preview-caption') as HTMLElement).textContent = 'Loading…';
      img.src = src;
    }
    const r = anchor.getBoundingClientRect();
    const top = r.bottom + 240 < window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - 246);
    box.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 248)))}px`;
    box.style.top = `${Math.round(top)}px`;
    box.hidden = false;
  }

  private hidePreview(): void {
    if (this.preview) this.preview.hidden = true;
  }
}
