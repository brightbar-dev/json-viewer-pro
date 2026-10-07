/**
 * The Compare view's row model: which diff nodes are visible, in order.
 *
 * Like `TreeModel`, nothing is built for a subtree until it is opened, and the
 * view renders only the rows on screen. Also finds the next / previous
 * difference from wherever the selection is. Pure (no DOM) and unit-tested.
 */
import type { DiffNode, DiffResult } from './diff';

export interface DiffCloseRow {
  closeOf: DiffNode;
}
export type DiffRow = DiffNode | DiffCloseRow;

export const isDiffClose = (r: DiffRow | undefined): r is DiffCloseRow => !!r && 'closeOf' in r;

/** Rows opened automatically, breadth first, when a comparison is first shown. */
export const INITIAL_DIFF_ROWS = 1500;

export class DiffModel {
  rows: DiffRow[] = [];
  private only = false;

  constructor(readonly result: DiffResult) {
    if (result.root) {
      this.rows = [result.root];
      this.openChanges(INITIAL_DIFF_ROWS);
    }
  }

  get changesOnly(): boolean {
    return this.only;
  }

  setChangesOnly(on: boolean): void {
    if (on === this.only) return;
    this.only = on;
    this.rebuild();
  }

  /** Children of an open node as the current filter shows them. */
  kids(n: DiffNode): DiffNode[] {
    return this.only && n.kind === 'modified' ? n.changedChildren() : n.allChildren();
  }

  private open(n: DiffNode): boolean {
    return n.expanded && n.expandable && this.kids(n).length > 0;
  }

  /** Recompute every row from the expanded flags. */
  rebuild(): void {
    const root = this.result.root;
    this.rows = [];
    if (!root) return;
    this.rows.push(root);
    this.append(root, this.rows);
  }

  /** Append the rows beneath `node` (its children, recursively when open, then its closing row). */
  private append(node: DiffNode, out: DiffRow[]): void {
    if (!this.open(node)) return;
    const stack: { node: DiffNode; kids: DiffNode[]; i: number }[] = [{ node, kids: this.kids(node), i: 0 }];
    while (stack.length) {
      const f = stack[stack.length - 1]!;
      if (f.i < f.kids.length) {
        const c = f.kids[f.i++]!;
        out.push(c);
        if (this.open(c)) stack.push({ node: c, kids: this.kids(c), i: 0 });
      } else {
        out.push({ closeOf: f.node });
        stack.pop();
      }
    }
  }

  /** Open changed containers breadth-first until about `budget` rows are showing. */
  private openChanges(budget: number): void {
    const root = this.result.root;
    if (!root) return;
    let total = 1;
    const queue: DiffNode[] = [root];
    for (let q = 0; q < queue.length; q++) {
      const n = queue[q]!;
      if (!n.expandable || n.kind === 'equal') continue;
      // Changed containers always open (until the budget is spent); added and removed ones only when small.
      if (n !== root && (total >= budget || (n.kind !== 'modified' && !smallEnough(n)))) continue;
      n.expanded = true;
      const kids = this.kids(n);
      total += kids.length + 1;
      for (const k of kids) if (k.expandable) queue.push(k);
    }
    this.rebuild();
  }

  /** Open the node at row `index`; returns how many rows appeared. */
  expandAt(index: number): number {
    const n = this.rows[index];
    if (!n || isDiffClose(n) || !n.expandable || n.expanded) return 0;
    n.expanded = true;
    const added: DiffRow[] = [];
    this.append(n, added);
    this.rows.splice(index + 1, 0, ...added);
    return added.length;
  }

  /** Close the node at row `index`; returns how many rows went away. */
  collapseAt(index: number): number {
    const n = this.rows[index];
    if (!n || isDiffClose(n) || !n.expanded) return 0;
    const wasOpen = this.open(n);
    n.expanded = false;
    if (!wasOpen) return 0;
    let end = index + 1;
    while (end < this.rows.length) {
      const r = this.rows[end]!;
      end++;
      if (isDiffClose(r) && r.closeOf === n) break;
    }
    this.rows.splice(index + 1, end - index - 1);
    return end - index - 1;
  }

  /** Open every container under `node` (and `node` itself), up to `limit` nodes. Returns false if the limit stopped it. */
  expandSubtree(node: DiffNode, limit = 200_000): boolean {
    let count = 0;
    const stack = [node];
    while (stack.length) {
      const n = stack.pop()!;
      if (!n.expandable) continue;
      if (++count > limit) {
        this.rebuild();
        return false;
      }
      n.expanded = true;
      for (const k of this.kids(n)) stack.push(k);
    }
    this.rebuild();
    return true;
  }

  collapseAll(): void {
    const root = this.result.root;
    if (!root) return;
    const stack = [root];
    while (stack.length) {
      const n = stack.pop()!;
      if (!n.expanded) continue;
      n.expanded = false;
      for (const k of this.kids(n)) stack.push(k);
    }
    root.expanded = true;
    this.rebuild();
  }

  /** Open the ancestors of `node` so it has a row; returns that row's index (-1 if it cannot be shown). */
  reveal(node: DiffNode): number {
    let changed = false;
    for (let p = node.parent; p; p = p.parent) {
      if (!p.expanded) {
        p.expanded = true;
        changed = true;
      }
    }
    if (changed) this.rebuild();
    return this.indexOf(node);
  }

  indexOf(row: DiffRow): number {
    return this.rows.indexOf(row);
  }

  /**
   * The difference after (`dir` 1) or before (`dir` -1) the selection, in
   * document order, wrapping round at either end. `from` is the selected row's
   * index, or -1 for none.
   */
  step(from: number, dir: 1 | -1): { node: DiffNode; wrapped: boolean } | null {
    const list = this.result.changes;
    const n = list.length;
    if (n === 0) return null;
    const sel = from >= 0 ? this.rows[from] : undefined;
    let target: number;
    if (sel === undefined) {
      target = dir === 1 ? 0 : n - 1;
    } else {
      const node = isDiffClose(sel) ? sel.closeOf : sel;
      if (!isDiffClose(sel) && node.seq >= 0) target = node.seq + dir;
      else if (!isDiffClose(sel) && node.kind === 'modified') target = dir === 1 ? node.firstSeq : node.firstSeq - 1;
      else if (isDiffClose(sel) && node.kind === 'modified') target = dir === 1 ? node.lastSeq + 1 : node.lastSeq;
      else target = this.scan(from, dir);
    }
    const wrapped = target < 0 || target >= n;
    target = ((target % n) + n) % n;
    return { node: list[target]!, wrapped };
  }

  /** From a row that is no difference: the `seq` of the nearest difference in `dir`, or out of range if there is none. */
  private scan(from: number, dir: 1 | -1): number {
    const n = this.result.changes.length;
    for (let i = from + dir; i >= 0 && i < this.rows.length; i += dir) {
      const r = this.rows[i]!;
      if (isDiffClose(r)) continue;
      if (r.seq >= 0) return r.seq;
      // A closed container's differences are not rows; use its edge.
      if (r.kind === 'modified' && !r.expanded) return dir === 1 ? r.firstSeq : r.lastSeq;
    }
    return dir === 1 ? n : -1;
  }
}

function smallEnough(n: DiffNode): boolean {
  const v = n.kind === 'added' ? n.right : n.left;
  return Array.isArray(v) ? v.length <= 12 : v !== null && typeof v === 'object' && Object.keys(v).length <= 12;
}
