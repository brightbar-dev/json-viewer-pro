/**
 * Table view of an array of objects: one row per element, one column per key
 * (the union across all elements), sortable headers, nested values shown as a
 * compact preview that opens into formatted JSON. Rows are virtualised inside
 * the table's own scroll box, so 60,000 rows cost what is on screen.
 */
import { el } from './dom';
import { formatNumber } from './format';
import { stringifyJson } from './serialize';
import { cellOf, cellText, sortedOrder, tableColumns, VALUE_COLUMN } from './tabular';

/** Tallest the row spacer may grow; beyond it scrolling is compressed. */
const MAX_SCROLL_PX = 8_000_000;
const OVERSCAN = 8;
/** Characters of formatted JSON shown in a nested cell's popover. */
const POPOVER_CHARS = 20_000;

export interface TableHooks {
  /** Show element `row` (an index into the array), or one of its members, in the tree. */
  reveal(row: number, column: string | null): void;
  close(): void;
  copy(text: string, what: string): void;
  lossless: boolean;
}

export class TableView {
  readonly el: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly head: HTMLElement;
  private readonly body: HTMLElement;
  private readonly columns: string[];
  private order: number[];
  private sortColumn: string | null = null;
  private sortDir: 1 | -1 = 1;
  private rowHeight = 20;
  private fontSize = 13;
  private frame = 0;
  private popover: HTMLElement | null = null;
  private readonly onResize = () => this.fit();

  constructor(
    private readonly rows: unknown[],
    path: string,
    private readonly hooks: TableHooks,
  ) {
    const { columns, truncated } = tableColumns(rows);
    this.columns = columns;
    this.order = rows.map((_, i) => i);

    this.el = el('section', 'jvp-table-wrap');
    this.el.setAttribute('aria-label', `Table of ${path}`);

    const bar = el('div', 'jvp-table-bar');
    const title = el('span', 'jvp-table-title');
    title.append(el('strong', '', 'Table'), ' ', el('code', 'jvp-table-path', path));
    const dims = el('span', 'jvp-muted', `${formatNumber(rows.length)} row${rows.length === 1 ? '' : 's'} × ${formatNumber(columns.length)} column${columns.length === 1 ? '' : 's'}`);
    bar.append(title, dims);
    if (truncated) bar.append(el('span', 'jvp-badge', `showing the first ${formatNumber(columns.length)} columns`));
    const back = el('button', 'jvp-btn', 'Back to tree');
    back.type = 'button';
    back.addEventListener('click', () => this.hooks.close());
    bar.append(back);

    this.scroller = el('div', 'jvp-table-scroll');
    this.scroller.tabIndex = 0;
    this.scroller.setAttribute('role', 'grid');
    this.scroller.setAttribute('aria-rowcount', String(rows.length + 1));
    this.scroller.setAttribute('aria-colcount', String(columns.length + 1));
    this.head = el('div', 'jvp-tr jvp-table-head');
    this.head.setAttribute('role', 'row');
    this.body = el('div', 'jvp-table-body');
    this.scroller.append(this.head, this.body);
    this.el.append(bar, this.scroller);

    this.scroller.addEventListener('scroll', () => this.schedule(), { passive: true });
    this.scroller.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('resize', this.onResize);
    this.renderHead();
  }

  /** Call once the element is in the page, and when the font changes. */
  setMetrics(fontSize: number, rowHeight: number): void {
    this.fontSize = fontSize;
    this.rowHeight = rowHeight;
    this.layoutColumns();
    this.fit();
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.closePopover();
    this.el.remove();
  }

  // ---------- layout ----------

  /** Column widths from the header and a sample of rows, so they stay put while scrolling. */
  private layoutColumns(): void {
    const charWidth = this.fontSize * 0.62;
    const sample = Math.min(this.rows.length, 300);
    const widths = this.columns.map((c) => {
      let chars = c === VALUE_COLUMN ? 5 : c.length + 2;
      for (let i = 0; i < sample; i++) chars = Math.max(chars, cellText(cellOf(this.rows[i], c), 48).length);
      return Math.round(Math.min(360, Math.max(72, chars * charWidth + 24)));
    });
    const indexWidth = Math.round(Math.max(48, String(this.rows.length).length * charWidth + 24));
    const template = [indexWidth, ...widths].map((w) => `${w}px`).join(' ');
    this.el.style.setProperty('--jvp-cols', template);
    this.el.style.setProperty('--jvp-table-width', `${[indexWidth, ...widths].reduce((a, b) => a + b, 0)}px`);
  }

  /** Size the scroll box to the viewport below it, then render. */
  private fit(): void {
    if (!this.el.isConnected) return;
    const top = this.scroller.getBoundingClientRect().top;
    this.scroller.style.height = `${Math.max(160, window.innerHeight - Math.max(0, top) - 12)}px`;
    this.render();
  }

  private schedule(): void {
    this.closePopover();
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private geometry() {
    const h = this.rowHeight;
    const n = this.order.length;
    const view = Math.max(0, this.scroller.clientHeight - this.head.offsetHeight);
    const total = n * h;
    const spacer = Math.min(total, MAX_SCROLL_PX);
    const maxScroll = Math.max(0, spacer - view);
    const below = Math.max(0, n - view / h);
    const k = total > MAX_SCROLL_PX && below > 0 ? maxScroll / (below * h) : 1;
    const scroll = Math.min(maxScroll, this.scroller.scrollTop);
    return { n, view, spacer, scroll, exact: scroll / (k * h), h };
  }

  private renderHead(): void {
    const cells: HTMLElement[] = [];
    const index = el('div', 'jvp-th jvp-td-index', '#');
    index.setAttribute('role', 'columnheader');
    cells.push(index);
    this.columns.forEach((c, i) => {
      const th = el('button', 'jvp-th');
      th.type = 'button';
      th.setAttribute('role', 'columnheader');
      th.dataset.col = String(i);
      const sorted = this.sortColumn === c;
      th.setAttribute('aria-sort', sorted ? (this.sortDir === 1 ? 'ascending' : 'descending') : 'none');
      th.title = `Sort by ${c === VALUE_COLUMN ? 'value' : c}`;
      th.append(el('span', 'jvp-th-label', c === VALUE_COLUMN ? '(value)' : c));
      if (sorted) th.append(el('span', 'jvp-th-sort', this.sortDir === 1 ? '▲' : '▼'));
      cells.push(th);
    });
    this.head.replaceChildren(...cells);
  }

  private render(): void {
    if (!this.el.isConnected) return;
    const g = this.geometry();
    this.body.style.height = `${g.spacer}px`;
    const first = Math.floor(g.exact);
    const from = Math.max(0, first - OVERSCAN);
    const to = Math.min(g.n, first + Math.ceil(g.view / g.h) + 1 + OVERSCAN);
    const frag = document.createDocumentFragment();
    for (let i = from; i < to; i++) {
      const rowIndex = this.order[i]!;
      const row = this.rows[rowIndex];
      const tr = el('div', 'jvp-tr');
      tr.setAttribute('role', 'row');
      tr.setAttribute('aria-rowindex', String(i + 2));
      tr.style.top = `${Math.round(g.scroll + (i - g.exact) * g.h)}px`;
      const idx = el('button', 'jvp-td jvp-td-index', String(rowIndex));
      idx.type = 'button';
      idx.setAttribute('role', 'rowheader');
      idx.dataset.row = String(rowIndex);
      idx.title = `Show element ${rowIndex} in the tree`;
      tr.append(idx);
      this.columns.forEach((c, ci) => {
        const cell = cellOf(row, c);
        if (cell.kind === 'object' || cell.kind === 'array') {
          const b = el('button', 'jvp-td jvp-td-nested', cellText(cell, 60));
          b.type = 'button';
          b.setAttribute('role', 'gridcell');
          b.dataset.row = String(rowIndex);
          b.dataset.col = String(ci);
          b.title = 'Open this value';
          tr.append(b);
        } else {
          const td = el('div', `jvp-td jvp-${cell.kind === 'missing' ? 'td-missing' : cell.kind}`, cellText(cell, 200));
          td.setAttribute('role', 'gridcell');
          tr.append(td);
        }
      });
      frag.append(tr);
    }
    this.body.replaceChildren(frag);
  }

  // ---------- interaction ----------

  private sortBy(columnIndex: number): void {
    const c = this.columns[columnIndex]!;
    if (this.sortColumn !== c) {
      this.sortColumn = c;
      this.sortDir = 1;
    } else if (this.sortDir === 1) {
      this.sortDir = -1;
    } else {
      this.sortColumn = null;
    }
    this.order = this.sortColumn === null ? this.rows.map((_, i) => i) : sortedOrder(this.rows, this.sortColumn, this.sortDir);
    this.renderHead();
    this.scroller.scrollTop = 0;
    this.render();
  }

  private onClick(e: MouseEvent): void {
    const target = (e.target as Element).closest('button');
    if (!target) return;
    if (target.classList.contains('jvp-th')) {
      if (target.dataset.col !== undefined) this.sortBy(Number(target.dataset.col));
      return;
    }
    const row = Number(target.dataset.row);
    if (target.classList.contains('jvp-td-index')) {
      this.hooks.reveal(row, null);
      return;
    }
    if (target.classList.contains('jvp-td-nested')) {
      const column = this.columns[Number(target.dataset.col)]!;
      this.openPopover(target, row, column);
    }
  }

  private openPopover(anchor: HTMLElement, row: number, column: string): void {
    this.closePopover();
    const value = cellOf(this.rows[row], column).value;
    const json = stringifyJson(value, 2, this.hooks.lossless);
    const box = el('div', 'jvp-popover');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', `${column} of element ${row}`);
    const pre = el('pre', 'jvp-popover-json', json.length > POPOVER_CHARS ? `${json.slice(0, POPOVER_CHARS)}\n…` : json);
    const actions = el('div', 'jvp-popover-actions');
    const copy = el('button', 'jvp-btn jvp-btn-small', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', () => this.hooks.copy(json, 'value'));
    const show = el('button', 'jvp-btn jvp-btn-small', 'Show in tree');
    show.type = 'button';
    show.addEventListener('click', () => this.hooks.reveal(row, column));
    const close = el('button', 'jvp-btn jvp-btn-small jvp-btn-icon', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.closePopover());
    actions.append(copy, show, close);
    box.append(actions, pre);
    this.el.append(box);
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8));
    let top = r.bottom + 4;
    if (top + box.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - box.offsetHeight - 4);
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
    this.popover = box;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        this.closePopover();
        anchor.focus();
      }
    };
    box.addEventListener('keydown', onKey);
    copy.focus();
  }

  private closePopover(): void {
    this.popover?.remove();
    this.popover = null;
  }
}
