/**
 * The tree model: lazily materialised nodes and the flat list of visible rows.
 *
 * Nothing is built for a value until its parent is expanded, and the view only
 * ever renders the rows it can show, so the cost of a document is proportional
 * to what is on screen rather than to its size. Pure (no DOM) and unit-tested.
 */
import { LosslessNumber } from './lossless';

export type Kind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
export type Key = string | number | null;

export function kindOf(v: unknown): Kind {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      if (Array.isArray(v)) return 'array';
      return v instanceof LosslessNumber ? 'number' : 'object';
    default:
      return 'null';
  }
}

export function isContainerValue(v: unknown): v is object {
  return v !== null && typeof v === 'object' && !(v instanceof LosslessNumber);
}

let nextId = 1;

/** Key order for the view-only "sort keys" mode: natural ("item2" before "item10"), then exact. */
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export function compareKeys(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

export class TNode {
  /** Unique per page; used for element ids (aria-activedescendant). */
  readonly id = nextId++;
  readonly key: Key;
  readonly value: unknown;
  readonly parent: TNode | null;
  readonly depth: number;
  readonly kind: Kind;
  /** Position among its siblings as displayed. */
  index: number;
  /** Position among its siblings in the document. */
  readonly order: number;
  expanded = false;
  children: TNode[] | null = null;
  private _size = -1;
  private _close: CloseRow | null = null;

  constructor(key: Key, value: unknown, parent: TNode | null, index: number, order = index) {
    this.key = key;
    this.value = value;
    this.parent = parent;
    this.depth = parent ? parent.depth + 1 : 0;
    this.kind = kindOf(value);
    this.index = index;
    this.order = order;
  }

  get isContainer(): boolean {
    return this.kind === 'object' || this.kind === 'array';
  }

  /** Number of children (0 for primitives). */
  get size(): number {
    if (this._size < 0) {
      if (this.kind === 'array') this._size = (this.value as unknown[]).length;
      else if (this.kind === 'object') this._size = Object.keys(this.value as object).length;
      else this._size = 0;
    }
    return this._size;
  }

  /** A container that can be opened. */
  get expandable(): boolean {
    return this.isContainer && this.size > 0;
  }

  get closeRow(): CloseRow {
    return (this._close ??= { closeOf: this });
  }
}

/** The row holding a container's closing bracket. */
export interface CloseRow {
  readonly closeOf: TNode;
}

export type Row = TNode | CloseRow;

export function isCloseRow(row: Row | undefined): row is CloseRow {
  return row !== undefined && !(row instanceof TNode);
}

export function materialize(node: TNode, sortKeys = false): TNode[] {
  if (node.children) return node.children;
  const out: TNode[] = [];
  if (node.kind === 'array') {
    const arr = node.value as unknown[];
    for (let i = 0; i < arr.length; i++) out.push(new TNode(i, arr[i], node, i));
  } else if (node.kind === 'object') {
    const obj = node.value as Record<string, unknown>;
    let i = 0;
    for (const k of Object.keys(obj)) out.push(new TNode(k, obj[k], node, i, i++));
    if (sortKeys) sortChildren(out, true);
  }
  node.children = out;
  return out;
}

/** Order object children by key (or back to document order), keeping their state. */
function sortChildren(kids: TNode[], byKey: boolean): void {
  if (byKey) kids.sort((a, b) => compareKeys(a.key as string, b.key as string));
  else kids.sort((a, b) => a.order - b.order);
  for (let i = 0; i < kids.length; i++) kids[i]!.index = i;
}

/** Keys from the root to `node` (the root itself has an empty path). */
export function pathOf(node: TNode): (string | number)[] {
  const path: (string | number)[] = [];
  for (let n: TNode | null = node; n && n.parent; n = n.parent) path.push(n.key as string | number);
  return path.reverse();
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** JSONPath-style path: `$.data[3].email`, `$["full name"]`. */
export function formatPath(path: readonly (string | number)[]): string {
  let out = '$';
  for (const k of path) {
    if (typeof k === 'number') out += `[${k}]`;
    else out += IDENT.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`;
  }
  return out;
}

/** JavaScript accessor relative to the document: `data[3].email`, `["full name"]`. Empty for the root. */
export function formatJsPath(path: readonly (string | number)[]): string {
  let out = '';
  for (const k of path) {
    if (typeof k === 'number') out += `[${k}]`;
    else if (IDENT.test(k)) out += out ? `.${k}` : k;
    else out += `[${JSON.stringify(k)}]`;
  }
  return out;
}

/** RFC 6901 JSON Pointer: `/data/3/email`. Empty for the root. */
export function formatJsonPointer(path: readonly (string | number)[]): string {
  return path.map((k) => `/${String(k).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');
}

export type Include = (node: TNode) => boolean;

/**
 * Append the visible rows beneath `node` (not `node` itself): its children in
 * order, recursing into expanded ones, then its closing-bracket row.
 */
function appendDescendants(node: TNode, out: Row[], include: Include | null, sortKeys: boolean): void {
  if (!node.expanded || !node.expandable) return;
  const kids = (n: TNode) => (include ? materialize(n, sortKeys).filter(include) : materialize(n, sortKeys));
  const stack: { node: TNode; kids: TNode[]; i: number }[] = [{ node, kids: kids(node), i: 0 }];
  while (stack.length) {
    const f = stack[stack.length - 1]!;
    if (f.i < f.kids.length) {
      const c = f.kids[f.i++]!;
      out.push(c);
      if (c.expanded && c.expandable) stack.push({ node: c, kids: kids(c), i: 0 });
    } else {
      out.push(f.node.closeRow);
      stack.pop();
    }
  }
}

function insertAt<T>(arr: T[], index: number, items: T[]): T[] {
  if (items.length === 0) return arr;
  if (items.length < 1000 && arr.length < 50000) {
    arr.splice(index, 0, ...items);
    return arr;
  }
  return arr.slice(0, index).concat(items, arr.slice(index));
}

export class TreeModel {
  readonly root: TNode;
  rows: Row[] = [];
  private include: Include | null = null;
  private _sortKeys = false;

  constructor(value: unknown) {
    this.root = new TNode(null, value, null, 0);
    this.rebuild();
  }

  get filtered(): boolean {
    return this.include !== null;
  }

  get sortKeys(): boolean {
    return this._sortKeys;
  }

  rebuild(): void {
    const out: Row[] = [this.root];
    appendDescendants(this.root, out, this.include, this._sortKeys);
    this.rows = out;
  }

  /** View-only key sorting. Already-built nodes are reordered in place, so expansion state survives. */
  setSortKeys(on: boolean): void {
    if (on === this._sortKeys) return;
    this._sortKeys = on;
    const stack: TNode[] = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (!n.children) continue;
      if (n.kind === 'object') sortChildren(n.children, on);
      for (const c of n.children) if (c.children) stack.push(c);
    }
    this.rebuild();
  }

  /** Show only nodes for which `include` is true (null shows everything). */
  setFilter(include: Include | null): void {
    this.include = include;
    this.rebuild();
  }

  /** Expand the container at row `index`. Returns the number of rows inserted. */
  expandAt(index: number): number {
    const node = this.rows[index];
    if (!(node instanceof TNode) || node.expanded || !node.expandable) return 0;
    node.expanded = true;
    const add: Row[] = [];
    appendDescendants(node, add, this.include, this._sortKeys);
    this.rows = insertAt(this.rows, index + 1, add);
    return add.length;
  }

  /** Collapse the container at row `index`. Returns the number of rows removed. */
  collapseAt(index: number): number {
    const node = this.rows[index];
    if (!(node instanceof TNode) || !node.expanded || !node.expandable) return 0;
    const end = this.rows.indexOf(node.closeRow, index + 1);
    node.expanded = false;
    if (end < 0) return 0;
    const removed = end - index;
    if (removed < 1000 && this.rows.length < 50000) this.rows.splice(index + 1, removed);
    else this.rows = this.rows.slice(0, index + 1).concat(this.rows.slice(end + 1));
    return removed;
  }

  toggleAt(index: number): number {
    const node = this.rows[index];
    if (!(node instanceof TNode)) return 0;
    return node.expanded ? -this.collapseAt(index) : this.expandAt(index);
  }

  /**
   * Expand the node at `index` and everything beneath it. Opening a node costs
   * its child count, and nodes that would push the total past `limit` stay
   * closed, so one keypress can never build an unbounded tree. Nodes that are
   * already open cost nothing, so calling again with a higher limit continues.
   * Returns true when the whole subtree is now open.
   */
  expandSubtreeAt(index: number, limit = Infinity): boolean {
    const node = this.rows[index];
    if (!(node instanceof TNode) || !node.expandable) return true;
    const wasOpen = node.expanded;
    let cost = 0;
    let complete = true;
    const stack: TNode[] = [node];
    while (stack.length) {
      const n = stack.pop()!;
      if (!n.expanded) {
        if (cost + n.size > limit) {
          complete = false;
          continue;
        }
        cost += n.size;
        n.expanded = true;
      }
      const kids = materialize(n, this._sortKeys);
      for (let i = kids.length - 1; i >= 0; i--) if (kids[i]!.expandable) stack.push(kids[i]!);
    }
    const end = wasOpen ? this.rows.indexOf(node.closeRow, index + 1) : index;
    const block: Row[] = [];
    appendDescendants(node, block, this.include, this._sortKeys);
    this.rows = this.rows.slice(0, index + 1).concat(block, this.rows.slice(end + 1));
    return complete;
  }

  /** Collapse everything below the root, leaving the root open. */
  collapseAll(): void {
    const stack: TNode[] = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      n.expanded = false;
      if (n.children) for (const c of n.children) if (c.expanded) stack.push(c);
    }
    this.root.expanded = this.root.expandable;
    this.rebuild();
  }

  /** Expand every node (within `limit`, see expandSubtreeAt). True when everything is open. */
  expandAll(limit = Infinity): boolean {
    return this.expandSubtreeAt(0, limit);
  }

  /**
   * Show exactly `level` levels: nodes shallower than that open, everything
   * deeper closed. Opening costs child counts against `limit`, as in
   * expandSubtreeAt. True when every node that should be open is.
   */
  expandToLevel(level: number, limit = Infinity): boolean {
    let cost = 0;
    let complete = true;
    const stack: TNode[] = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (!n.expandable) continue;
      if (n.depth < level) {
        if (!n.expanded) {
          if (cost + n.size > limit) {
            complete = false;
            continue;
          }
          cost += n.size;
          n.expanded = true;
        }
        for (const c of materialize(n, this._sortKeys)) if (c.expandable) stack.push(c);
      } else {
        n.expanded = false;
        if (n.children) for (const c of n.children) if (c.expanded) stack.push(c);
      }
    }
    this.rebuild();
    return complete;
  }

  /** The next (dir 1) or previous (dir -1) node row, skipping closing brackets; -1 past either end. */
  stepRow(index: number, dir: 1 | -1): number {
    for (let i = index + dir; i >= 0 && i < this.rows.length; i += dir) {
      if (this.rows[i] instanceof TNode) return i;
    }
    return -1;
  }

  /** Row of the parent of the node at `index`, or -1. */
  parentRow(index: number): number {
    const node = this.rows[index];
    if (!(node instanceof TNode) || !node.parent) return -1;
    return this.rows.lastIndexOf(node.parent, index - 1);
  }

  lastNodeRow(): number {
    return this.stepRow(this.rows.length, -1);
  }

  /**
   * Expand every node for which `open` is true, walking only into containers
   * it opens. Used to reveal all search hits at once.
   */
  expandWhere(open: (node: TNode) => boolean, rebuild = true): void {
    const stack: TNode[] = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (!n.expandable || !open(n)) continue;
      n.expanded = true;
      for (const c of materialize(n, this._sortKeys)) if (c.expandable) stack.push(c);
    }
    if (rebuild) this.rebuild();
  }

  /**
   * Make the node at `path` visible, expanding its ancestors. Returns its row
   * index, or -1 if the path does not exist or is hidden by the filter.
   */
  reveal(path: readonly (string | number)[]): number {
    let node = this.root;
    let index = 0;
    for (const k of path) {
      if (!node.expandable) return -1;
      if (!node.expanded) this.expandAt(index);
      const kids = materialize(node, this._sortKeys);
      const child = node.kind === 'array' ? kids[k as number] : kids.find((c) => c.key === k);
      if (!child) return -1;
      index = this.rows.indexOf(child, index + 1);
      if (index < 0) return -1;
      node = child;
    }
    return index;
  }

  indexOfNode(node: TNode, from = 0): number {
    return this.rows.indexOf(node, from);
  }
}

/**
 * Initial expansion by a row budget: open the root, then open nodes breadth
 * first while the total row count stays within `budget`. A level that does not
 * fit entirely is opened as far as it goes and nothing deeper is opened, so
 * the result reads top-down rather than as a scatter of open nodes.
 * Returns the resulting row count.
 */
export function expandByBudget(root: TNode, budget: number, sortKeys = false): number {
  let rows = 1;
  if (!root.expandable) return rows;
  root.expanded = true;
  rows += root.size + 1;
  let level = materialize(root, sortKeys).filter((c) => c.expandable);
  while (level.length) {
    const next: TNode[] = [];
    let skipped = false;
    for (const n of level) {
      const cost = n.size + 1;
      if (rows + cost <= budget) {
        n.expanded = true;
        rows += cost;
        for (const c of materialize(n, sortKeys)) if (c.expandable) next.push(c);
      } else {
        skipped = true;
      }
    }
    if (skipped) break;
    level = next;
  }
  return rows;
}
