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
 * Every row is a flat element carrying its depth in `--d`; one delegated click
 * listener serves them all.
 */
import { copyText } from './dom';
import { formatCount, formatNumber, isUrl } from './format';
import { LosslessNumber } from './lossless';
import { primitiveText } from './search';
import { formatPath, isCloseRow, pathOf, TNode, type Row, type TreeModel } from './tree';

/** Must match `--jvp-row-h` in viewer.css. */
export const ROW_HEIGHT = 20;
export const FULL_RENDER_LIMIT = 3000;
/** Largest spacer we let the page grow to; comfortably below every engine's element-height limit. */
const MAX_SCROLL_PX = 8_000_000;
const OVERSCAN = 15;
/** Characters of a string shown before a "show more" affordance. */
const STRING_CLIP = 10_000;
/** Nodes Alt+click may materialise in one go. */
const SUBTREE_LIMIT = 2_000_000;

export interface TreeViewHooks {
  /** The active search, if any. */
  highlight(): RegExp | null;
  /** Is `node` the currently selected search match? */
  isCurrent(node: TNode): boolean;
  /** Height of whatever sticks to the top of the viewport (the toolbar). */
  topInset(): number;
  /** After the user expands or collapses something. */
  onToggle?(): void;
}

function span(className: string, text?: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  if (text !== undefined) s.textContent = text;
  return s;
}

export class TreeView {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private rowEls: HTMLElement[] = [];
  private readonly rowOf = new WeakMap<Element, Row>();
  private virtual = false;
  private windowFrom = 0;
  private bodyTop = 0;
  private frame = 0;
  private readonly fullStrings = new WeakSet<TNode>();
  private globalRe: RegExp | null = null;
  private globalReFor: RegExp | null = null;

  constructor(
    readonly model: TreeModel,
    private readonly hooks: TreeViewHooks,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'jvp-tree';
    this.el.id = 'jvp-tree';
    this.body = document.createElement('div');
    this.body.className = 'jvp-rows';
    this.el.appendChild(this.body);
    this.el.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('scroll', () => this.schedule(), { passive: true });
    window.addEventListener('resize', () => {
      if (!this.virtual) return;
      this.measure();
      this.schedule();
    });
  }

  get isVirtual(): boolean {
    return this.virtual;
  }

  /**
   * Re-render from the model. With `keep`, the row at that index stays at
   * screen position `keepY` (captured before the model changed).
   */
  refresh(keep?: number, keepY?: number | null): void {
    this.virtual = this.model.rows.length > FULL_RENDER_LIMIT;
    this.el.classList.toggle('jvp-virtual', this.virtual);
    const re = this.hooks.highlight();
    if (re !== this.globalReFor) {
      this.globalReFor = re;
      this.globalRe = re ? new RegExp(re.source, 'gi') : null;
    }

    if (this.virtual) {
      this.rowEls = [];
      // Size the spacer before any scroll, or the scroll is clamped to the old height.
      this.body.style.height = `${Math.min(this.model.rows.length * ROW_HEIGHT, MAX_SCROLL_PX)}px`;
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
    const y = this.rowScreenY(index);

    if (deep) {
      if (node.expanded) {
        this.model.collapseAt(index);
        const stack: TNode[] = [node];
        while (stack.length) {
          const n = stack.pop()!;
          n.expanded = false;
          if (n.children) for (const c of n.children) if (c.expanded) stack.push(c);
        }
      } else {
        this.model.expandSubtreeAt(index, SUBTREE_LIMIT);
      }
      this.refresh(index, y);
    } else {
      const delta = this.model.toggleAt(index);
      if (!this.virtual && this.model.rows.length <= FULL_RENDER_LIMIT) this.patch(index, delta);
      else this.refresh(index, y);
    }
    this.hooks.onToggle?.();
  }

  /** Scroll so row `index` is visible (`nearest`) or centred. */
  scrollToRow(index: number, align: 'nearest' | 'center' = 'nearest'): void {
    const top = this.hooks.topInset();
    const vh = window.innerHeight;
    const y = this.rowScreenY(index);
    if (align === 'nearest' && y !== null && y >= top && y + ROW_HEIGHT <= vh) return;
    let target: number;
    if (align === 'center') target = Math.round((top + vh - ROW_HEIGHT) / 2);
    else target = y !== null && y < top ? top : vh - ROW_HEIGHT;
    this.scrollRowTo(index, target);
  }

  /** The element currently showing row `index`, if it is rendered. */
  elementForRow(index: number): HTMLElement | null {
    if (!this.virtual) return this.rowEls[index] ?? null;
    const row = this.model.rows[index];
    for (const child of Array.from(this.body.children)) if (this.rowOf.get(child) === row) return child as HTMLElement;
    return null;
  }

  // ---------- layout ----------

  private measure(): void {
    this.bodyTop = this.body.getBoundingClientRect().top + window.scrollY;
  }

  private schedule(): void {
    if (!this.virtual || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderWindow();
    });
  }

  /**
   * Scroll geometry for the virtual layout. Row i sits at body offset
   * `scroll + (i - exact) * ROW_HEIGHT`, where `exact` is the fractional row
   * at the top of the viewport. `k` compresses scrolling when the list is taller
   * than MAX_SCROLL_PX (k = 1 otherwise).
   */
  private geometry() {
    const n = this.model.rows.length;
    const vh = window.innerHeight;
    const total = n * ROW_HEIGHT;
    const spacer = Math.min(total, MAX_SCROLL_PX);
    const maxScroll = Math.max(0, spacer - vh);
    const rowsBelowFold = Math.max(0, n - vh / ROW_HEIGHT);
    const k = total > MAX_SCROLL_PX && rowsBelowFold > 0 ? maxScroll / (rowsBelowFold * ROW_HEIGHT) : 1;
    const scroll = Math.min(maxScroll, Math.max(0, window.scrollY - this.bodyTop));
    const exact = scroll / (k * ROW_HEIGHT);
    return { n, vh, spacer, k, scroll, exact };
  }

  private renderWindow(): void {
    if (!this.virtual || !this.el.isConnected || this.el.classList.contains('jvp-hidden')) return;
    const g = this.geometry();
    this.body.style.height = `${g.spacer}px`;
    const first = Math.floor(g.exact);
    const from = Math.max(0, first - OVERSCAN);
    const to = Math.min(g.n, first + Math.ceil(g.vh / ROW_HEIGHT) + 1 + OVERSCAN);
    const frag = document.createDocumentFragment();
    const rows = this.model.rows;
    for (let i = from; i < to; i++) {
      const e = this.renderRow(rows[i]!);
      e.style.top = `${Math.round(g.scroll + (i - g.exact) * ROW_HEIGHT)}px`;
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
    return this.bodyTop - window.scrollY + g.scroll + (index - g.exact) * ROW_HEIGHT;
  }

  private scrollRowTo(index: number, screenY: number): void {
    if (!this.virtual) {
      const e = this.rowEls[index];
      if (e) window.scrollBy(0, e.getBoundingClientRect().top - screenY);
      return;
    }
    // On screen, row i sits at (i * ROW_HEIGHT - scroll / k); solve for scroll.
    const g = this.geometry();
    window.scrollTo(window.scrollX, this.bodyTop + (index * ROW_HEIGHT - screenY) * g.k);
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
  }

  // ---------- rows ----------

  private renderRow(row: Row): HTMLElement {
    const e = document.createElement('div');
    this.rowOf.set(e, row);

    if (isCloseRow(row)) {
      e.className = 'jvp-row jvp-close';
      e.style.setProperty('--d', String(row.closeOf.depth));
      e.appendChild(span('jvp-bracket', row.closeOf.kind === 'array' ? ']' : '}'));
      return e;
    }

    const node = row;
    const re = this.globalRe;
    e.className = node.expandable ? 'jvp-row jvp-expandable' : 'jvp-row';
    e.style.setProperty('--d', String(node.depth));
    if (this.hooks.isCurrent(node)) e.classList.add('jvp-row-current');

    // The arrow is CSS generated content, so it never ends up in copied text.
    if (node.expandable) {
      e.appendChild(span('jvp-toggle'));
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

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'jvp-copy';
    copy.dataset.act = 'copy';
    copy.tabIndex = -1;
    copy.textContent = '⎘';
    copy.title = node.isContainer ? 'Copy path' : 'Copy value';
    e.appendChild(copy);
    return e;
  }

  private appendString(row: HTMLElement, node: TNode, re: RegExp | null): void {
    const s = node.value as string;
    const clipped = s.length > STRING_CLIP && !this.fullStrings.has(node);
    const v = span('jvp-value jvp-string');
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
      v.append(a, '"');
    } else {
      this.appendText(v, JSON.stringify(s), re);
    }
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
    if (target.closest('a')) return;
    const rowEl = target.closest('.jvp-row');
    if (!rowEl) return;
    const row = this.rowOf.get(rowEl);
    if (!row || isCloseRow(row)) return;

    const act = (target.closest('[data-act]') as HTMLElement | null)?.dataset.act;
    if (act === 'copy') {
      e.stopPropagation();
      const text = row.isContainer
        ? formatPath(pathOf(row))
        : typeof row.value === 'string'
          ? row.value
          : primitiveText(row.value);
      const btn = target.closest('button')!;
      void copyText(text).then((ok) => {
        btn.textContent = ok ? '✓' : '✕';
        setTimeout(() => (btn.textContent = '⎘'), 1200);
      });
      return;
    }
    if (act === 'more') {
      this.fullStrings.add(row);
      const index = this.indexOfElement(rowEl);
      if (index >= 0 && !this.virtual) {
        const fresh = this.renderRow(row);
        rowEl.replaceWith(fresh);
        this.rowEls[index] = fresh;
      } else {
        this.renderWindow();
      }
      return;
    }

    if (!row.expandable) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.anchorNode && rowEl.contains(sel.anchorNode)) return;
    const index = this.indexOfElement(rowEl);
    if (index >= 0) this.toggleAt(index, e.altKey);
  }
}
