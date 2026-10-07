/**
 * Structural JSON diff for the Compare view.
 *
 * `diffValues(left, right)` walks both documents once and keeps only what
 * differs: a container with changes inside is a `modified` node holding just its
 * changed children; everything that is equal is represented implicitly and
 * materialised (lazily, as `equal` nodes) when the view expands it. Memory and
 * the later patch walk are therefore proportional to the number of changes, not
 * to the size of the documents. Added and removed subtrees are expanded from
 * their value on demand in the same way.
 *
 * Pure (no DOM) and unit-tested.
 */
import { canonical, LosslessNumber } from './lossless';
import { isContainerValue, kindOf, type Key } from './tree';

export interface DiffOptions {
  /** Object key order is not a difference (default true). */
  ignoreKeyOrder: boolean;
  /** Arrays are compared as unordered collections instead of by index (default false). */
  unorderedArrays: boolean;
}

export const DEFAULT_DIFF_OPTIONS: DiffOptions = { ignoreKeyOrder: true, unorderedArrays: false };

/**
 * equal    — the same on both sides (shown only in the full view)
 * added    — only on the right
 * removed  — only on the left
 * changed  — a scalar with another value, or a value whose type changed
 * modified — a container (same type both sides) with differences inside it
 */
export type DiffKind = 'equal' | 'added' | 'removed' | 'changed' | 'modified';

let nextId = 1;

export class DiffNode {
  /** Unique per page; used for element ids (aria-activedescendant). */
  readonly id = nextId++;
  /** Key on the left (array index, object key; null for the root). */
  readonly key: Key;
  /** Key on the right; differs from `key` only for array items matched out of order. */
  readonly rightKey: Key;
  parent: DiffNode | null;
  readonly depth: number;
  readonly kind: DiffKind;
  /** Left value; `undefined` when absent (added). */
  readonly left: unknown;
  /** Right value; `undefined` when absent (removed). Equal nodes show the left value on both sides. */
  readonly right: unknown;
  /** Position among the parent's children in display order. */
  readonly pos: number;
  /** modified only: the children that differ, in display order. */
  changed: DiffNode[] = [];
  /** modified array only: items were matched as an unordered set. */
  unordered = false;
  /** modified object only: same keys and values, but the keys are in another order. */
  reordered = false;
  /** Number of individual differences at or below this node. */
  count = 0;
  /** Index into `DiffResult.changes` for a node that is itself a difference. */
  seq = -1;
  /** For a modified node: `seq` of the first difference at or below it (-1 if none). */
  firstSeq = -1;
  /** For a modified node: `seq` of the last difference at or below it. */
  lastSeq = -1;
  expanded = false;
  /** Every child in display order, built on first expand. */
  private _all: DiffNode[] | null = null;

  constructor(kind: DiffKind, key: Key, left: unknown, right: unknown, parent: DiffNode | null, depth: number, pos = 0, rightKey: Key = key) {
    this.kind = kind;
    this.key = key;
    this.rightKey = rightKey;
    this.left = left;
    this.right = right;
    this.parent = parent;
    this.depth = depth;
    this.pos = pos;
  }

  /** A container on at least one side that the view can open. */
  get expandable(): boolean {
    switch (this.kind) {
      case 'modified':
        return true;
      case 'equal':
      case 'added':
      case 'removed':
        return isContainerValue(this.kind === 'added' ? this.right : this.left) && sizeOf(this.kind === 'added' ? this.right : this.left) > 0;
      default:
        return false;
    }
  }

  /** Children for the full view: changed ones merged with the equal ones around them. */
  allChildren(): DiffNode[] {
    if (this._all) return this._all;
    this._all = this.kind === 'modified' ? mergeChildren(this) : valueChildren(this);
    return this._all;
  }

  /** Children for the "changes only" view. */
  changedChildren(): DiffNode[] {
    return this.kind === 'modified' ? this.changed : [];
  }

  /** Keys from the root to this node (left-hand keys). */
  path(): (string | number)[] {
    const p: (string | number)[] = [];
    for (let n: DiffNode | null = this; n && n.parent; n = n.parent) p.push(n.key as string | number);
    return p.reverse();
  }
}

export function sizeOf(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (isContainerValue(v)) return Object.keys(v).length;
  return 0;
}

/** Children of an equal / added / removed container, straight from its value. */
function valueChildren(node: DiffNode): DiffNode[] {
  const side = node.kind === 'added' ? node.right : node.left;
  const out: DiffNode[] = [];
  const make = (k: Key, v: unknown, pos: number) => {
    out.push(
      node.kind === 'added'
        ? new DiffNode('added', k, undefined, v, node, node.depth + 1, pos)
        : node.kind === 'removed'
          ? new DiffNode('removed', k, v, undefined, node, node.depth + 1, pos)
          : new DiffNode('equal', k, v, v, node, node.depth + 1, pos),
    );
  };
  if (Array.isArray(side)) side.forEach((v, i) => make(i, v, i));
  else if (isContainerValue(side)) {
    let i = 0;
    for (const k of Object.keys(side)) make(k, (side as Record<string, unknown>)[k], i++);
  }
  return out;
}

/** A modified container's children, equal ones filled in between the changed ones. */
function mergeChildren(node: DiffNode): DiffNode[] {
  const out: DiffNode[] = [];
  const changed = node.changed;
  let c = 0;
  let base: number;
  let at: (pos: number) => DiffNode;
  if (Array.isArray(node.left)) {
    const l = node.left as unknown[];
    const r = node.right as unknown[];
    // Ordered: indexes present on both sides. Unordered: every left item (matched ones are equal).
    base = node.unordered ? l.length : Math.min(l.length, r.length);
    at = (pos) => new DiffNode('equal', pos, l[pos], l[pos], node, node.depth + 1, pos);
  } else {
    const l = node.left as Record<string, unknown>;
    const keys = Object.keys(l);
    // Only keys present on both sides can be equal; the removed ones are in `changed`.
    base = keys.length;
    at = (pos) => new DiffNode('equal', keys[pos]!, l[keys[pos]!], l[keys[pos]!], node, node.depth + 1, pos);
  }
  for (let pos = 0; pos < base; pos++) {
    if (c < changed.length && changed[c]!.pos === pos) out.push(changed[c++]!);
    else out.push(at(pos));
  }
  while (c < changed.length) out.push(changed[c++]!);
  return out;
}

// ---------- the diff ----------

export interface DiffResult {
  root: DiffNode | null;
  /** Every difference in display order (leaf changes, plus key reorders). */
  changes: DiffNode[];
  options: DiffOptions;
}

export class DiffDepthError extends Error {
  constructor() {
    super('These documents are nested too deeply to compare.');
  }
}

function numberText(v: unknown): string {
  return canonical(v instanceof LosslessNumber ? v.source : String(v));
}

/** Canonical text of a value under the options, so equal values give equal strings. */
function canon(v: unknown, o: DiffOptions): string {
  switch (kindOf(v)) {
    case 'null':
      return 'n';
    case 'boolean':
      return v ? 't' : 'f';
    case 'string':
      return JSON.stringify(v);
    case 'number':
      return `#${numberText(v)}`;
    case 'array': {
      const parts = (v as unknown[]).map((x) => canon(x, o));
      if (o.unorderedArrays) parts.sort();
      return `[${parts.join(',')}]`;
    }
    default: {
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (o.ignoreKeyOrder) keys.sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(obj[k], o)}`).join(',')}}`;
    }
  }
}

function scalarEqual(a: unknown, b: unknown): boolean {
  const k = kindOf(a);
  if (k === 'number') return a === b || numberText(a) === numberText(b);
  return a === b;
}

/**
 * Compare two parsed documents. Plain `JSON.parse` output and `LosslessNumber`s
 * are both understood (numbers compare by value, exactly: 1 equals 1.0, but
 * 12345678901234567890 does not equal 12345678901234567891).
 */
export function diffValues(left: unknown, right: unknown, options: Partial<DiffOptions> = {}): DiffResult {
  const o: DiffOptions = { ...DEFAULT_DIFF_OPTIONS, ...options };
  let root: DiffNode | null;
  try {
    root = diff(left, right, o, null, null, 0, 0, null);
  } catch (e) {
    if (e instanceof RangeError) throw new DiffDepthError();
    throw e;
  }
  const changes: DiffNode[] = [];
  if (root) sequence(root, changes);
  return { root, changes, options: o };
}

/** Assign `seq`/`firstSeq` in display order. Walks only the changed part of the tree. */
function sequence(root: DiffNode, out: DiffNode[]): void {
  const walk = (n: DiffNode): void => {
    n.firstSeq = out.length;
    if (n.kind !== 'modified' || n.reordered) {
      n.seq = out.length;
      out.push(n);
    }
    if (n.kind === 'modified') for (const c of n.changed) walk(c);
    n.lastSeq = out.length - 1;
  };
  walk(root);
}

function diff(a: unknown, b: unknown, o: DiffOptions, parent: DiffNode | null, key: Key, depth: number, pos: number, rightKey: Key | null): DiffNode | null {
  const rk = rightKey ?? key;
  const ka = kindOf(a);
  const kb = kindOf(b);
  if (ka !== kb) return changedNode(key, a, b, parent, depth, pos, rk);
  if (ka === 'array') return diffArrays(a as unknown[], b as unknown[], o, parent, key, depth, pos, rk);
  if (ka === 'object') return diffObjects(a as Record<string, unknown>, b as Record<string, unknown>, o, parent, key, depth, pos, rk);
  return scalarEqual(a, b) ? null : changedNode(key, a, b, parent, depth, pos, rk);
}

function changedNode(key: Key, a: unknown, b: unknown, parent: DiffNode | null, depth: number, pos: number, rightKey: Key): DiffNode {
  const n = new DiffNode('changed', key, a, b, parent, depth, pos, rightKey);
  n.count = 1;
  return n;
}

function added(key: Key, b: unknown, parent: DiffNode, pos: number): DiffNode {
  const n = new DiffNode('added', key, undefined, b, parent, parent.depth + 1, pos);
  n.count = 1;
  return n;
}

function removed(key: Key, a: unknown, parent: DiffNode, pos: number): DiffNode {
  const n = new DiffNode('removed', key, a, undefined, parent, parent.depth + 1, pos);
  n.count = 1;
  return n;
}

/**
 * Build a modified node from children computed against a parent that does not
 * exist yet: `make` receives the node and returns its changed children.
 */
function modified(key: Key, a: unknown, b: unknown, parent: DiffNode | null, depth: number, pos: number, rightKey: Key, fill: (n: DiffNode) => void): DiffNode | null {
  const n = new DiffNode('modified', key, a, b, parent, depth, pos, rightKey);
  fill(n);
  if (n.changed.length === 0 && !n.reordered) return null;
  for (const c of n.changed) n.count += c.count;
  if (n.reordered) n.count += 1;
  return n;
}

function diffObjects(a: Record<string, unknown>, b: Record<string, unknown>, o: DiffOptions, parent: DiffNode | null, key: Key, depth: number, pos: number, rightKey: Key): DiffNode | null {
  return modified(key, a, b, parent, depth, pos, rightKey, (n) => {
    const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
    let i = 0;
    const common: string[] = [];
    for (const k of Object.keys(a)) {
      if (has(k)) {
        common.push(k);
        const c = diff(a[k], b[k], o, n, k, depth + 1, i, null);
        if (c) n.changed.push(c);
      } else {
        n.changed.push(removed(k, a[k], n, i));
      }
      i++;
    }
    const hasA = (k: string) => Object.prototype.hasOwnProperty.call(a, k);
    const bKeys = Object.keys(b);
    for (const k of bKeys) if (!hasA(k)) n.changed.push(added(k, b[k], n, i++));
    if (!o.ignoreKeyOrder && common.length > 1) {
      let j = 0;
      for (const k of bKeys) {
        if (!hasA(k)) continue;
        if (common[j++] !== k) {
          n.reordered = true;
          break;
        }
      }
    }
  });
}

function diffArrays(a: unknown[], b: unknown[], o: DiffOptions, parent: DiffNode | null, key: Key, depth: number, pos: number, rightKey: Key): DiffNode | null {
  return modified(key, a, b, parent, depth, pos, rightKey, (n) => {
    if (o.unorderedArrays) return fillUnordered(n, a, b, o);
    const common = Math.min(a.length, b.length);
    for (let i = 0; i < common; i++) {
      const c = diff(a[i], b[i], o, n, i, depth + 1, i, null);
      if (c) n.changed.push(c);
    }
    for (let i = common; i < a.length; i++) n.changed.push(removed(i, a[i], n, i));
    for (let i = common; i < b.length; i++) n.changed.push(added(i, b[i], n, i));
  });
}

/**
 * Unordered arrays: items equal under the options cancel out wherever they sit;
 * what is left on each side is paired up in order (as changed items, so a record
 * edited in place reads as one change) and any surplus is removed / added.
 */
function fillUnordered(n: DiffNode, a: unknown[], b: unknown[], o: DiffOptions): void {
  n.unordered = true;
  const pool = new Map<string, number[]>();
  for (let j = b.length - 1; j >= 0; j--) {
    const k = canon(b[j], o);
    const list = pool.get(k);
    if (list) list.push(j);
    else pool.set(k, [j]);
  }
  const leftA: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const list = pool.get(canon(a[i], o));
    if (list && list.length) list.pop();
    else leftA.push(i);
  }
  const leftB: number[] = [];
  for (const list of pool.values()) for (const j of list) leftB.push(j);
  leftB.sort((x, y) => x - y);

  const paired = Math.min(leftA.length, leftB.length);
  for (let k = 0; k < paired; k++) {
    const i = leftA[k]!;
    const j = leftB[k]!;
    const c = diff(a[i], b[j], o, n, i, n.depth + 1, i, j);
    if (c) n.changed.push(c);
  }
  for (let k = paired; k < leftA.length; k++) n.changed.push(removed(leftA[k]!, a[leftA[k]!], n, leftA[k]!));
  n.changed.sort((x, y) => x.pos - y.pos);
  for (let k = paired; k < leftB.length; k++) n.changed.push(added(leftB[k]!, b[leftB[k]!], n, a.length + (k - paired)));
}

// ---------- JSON Patch (RFC 6902) ----------

export interface PatchOp {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: unknown;
}

const escapePointer = (k: string | number) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * The operations that turn the left document into the right one. Key order is
 * not part of a patch (object members are unordered in RFC 6902), so a pure
 * reorder yields no operation. For unordered arrays the patch makes the array
 * equal to the right one as a collection: surplus items are appended, so their
 * positions can differ from the right document.
 */
export function toPatch(result: DiffResult): PatchOp[] {
  const ops: PatchOp[] = [];
  const root = result.root;
  if (!root) return ops;
  if (root.kind !== 'modified') {
    ops.push({ op: 'replace', path: '', value: root.right });
    return ops;
  }
  const walk = (n: DiffNode, base: string): void => {
    if (Array.isArray(n.left)) {
      const nested: DiffNode[] = [];
      const drop: DiffNode[] = [];
      const add: DiffNode[] = [];
      for (const c of n.changed) {
        if (c.kind === 'added') add.push(c);
        else if (c.kind === 'removed') drop.push(c);
        else nested.push(c);
      }
      // Edits first, at the left document's own indexes; then removals from the end so indexes stay valid; then additions.
      for (const c of nested) {
        const p = `${base}/${c.key}`;
        if (c.kind === 'modified') walk(c, p);
        else ops.push({ op: 'replace', path: p, value: c.right });
      }
      for (let i = drop.length - 1; i >= 0; i--) ops.push({ op: 'remove', path: `${base}/${drop[i]!.key}` });
      for (const c of add) ops.push({ op: 'add', path: n.unordered ? `${base}/-` : `${base}/${c.key}`, value: c.right });
      return;
    }
    for (const c of n.changed) {
      const p = `${base}/${escapePointer(c.key as string)}`;
      if (c.kind === 'modified') walk(c, p);
      else if (c.kind === 'removed') ops.push({ op: 'remove', path: p });
      else ops.push({ op: c.kind === 'added' ? 'add' : 'replace', path: p, value: c.right });
    }
  };
  walk(root, '');
  return ops;
}

function clone(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clone);
  if (isContainerValue(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
}

/** Apply a patch to a deep copy of `doc` (used by the tests; handles the operations `toPatch` emits). */
export function applyPatch(doc: unknown, ops: readonly PatchOp[]): unknown {
  let root = clone(doc);
  for (const op of ops) {
    if (op.path === '') {
      root = clone(op.value);
      continue;
    }
    const parts = op.path.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    const last = parts.pop()!;
    let target: any = root;
    for (const p of parts) target = target[p];
    const value = clone(op.value);
    if (Array.isArray(target)) {
      if (op.op === 'add') target.splice(last === '-' ? target.length : Number(last), 0, value);
      else if (op.op === 'remove') target.splice(Number(last), 1);
      else target[Number(last)] = value;
    } else if (op.op === 'remove') delete target[last];
    else target[last] = value;
  }
  return root;
}
