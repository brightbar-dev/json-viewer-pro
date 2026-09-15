/**
 * Search over the parsed data rather than the DOM, so it sees every value —
 * including the ones that have never been rendered — and can run in time
 * slices on a huge document without freezing the page. Pure and unit-tested.
 */
import { LosslessNumber } from './lossless';
import { compareKeys, isContainerValue, type Key, type TNode } from './tree';

/** Case-insensitive literal matcher, or null for an empty query. */
export function compileQuery(query: string): RegExp | null {
  const q = query.trim();
  if (!q) return null;
  return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

/** The text a primitive is searched (and displayed) as, without quotes. */
export function primitiveText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null) return 'null';
  if (v instanceof LosslessNumber) return v.source;
  return String(v);
}

export const MATCH_KEY = 1;
export const MATCH_VALUE = 2;

/**
 * Which parts of an entry match: its property name (array indices are
 * positions, not data, and never match) and/or its primitive value.
 */
export function matchFlags(key: Key, value: unknown, re: RegExp): number {
  let flags = 0;
  if (typeof key === 'string' && re.test(key)) flags |= MATCH_KEY;
  if (!isContainerValue(value) && re.test(primitiveText(value))) flags |= MATCH_VALUE;
  return flags;
}

export interface ParentLink {
  parent: object | null;
  key: Key;
}

export interface SearchResult {
  count: number;
  /** Per match, in document order: the container holding it (null for the root value)… */
  containers: (object | null)[];
  /** …and its key within that container. */
  keys: Key[];
  /** Every container on a path to a match → where it sits in its parent. */
  parents: Map<object, ParentLink>;
  done: boolean;
}

export function emptyResult(): SearchResult {
  return { count: 0, containers: [], keys: [], parents: new Map(), done: false };
}

interface Frame {
  c: object;
  keys: string[] | null;
  i: number;
  len: number;
}

function frame(c: object, sortKeys: boolean): Frame {
  if (Array.isArray(c)) return { c, keys: null, i: 0, len: c.length };
  const keys = Object.keys(c);
  if (sortKeys) keys.sort(compareKeys);
  return { c, keys, i: 0, len: keys.length };
}

/**
 * Walk `root` in display order recording matches into `result`, yielding every
 * `slice` entries so a caller can spread the work across frames. Drain it in
 * one go (`for (const _ of searchSteps(...));`) for a synchronous search.
 */
export function* searchSteps(
  root: unknown,
  re: RegExp,
  result: SearchResult,
  slice = 4000,
  sortKeys = false,
): Generator<void, void, void> {
  if (matchFlags(null, root, re)) {
    result.containers.push(null);
    result.keys.push(null);
    result.count++;
  }
  if (!isContainerValue(root)) {
    result.done = true;
    return;
  }

  const stack: Frame[] = [frame(root, sortKeys)];
  let steps = 0;

  const registerPath = () => {
    for (let j = stack.length - 1; j >= 0; j--) {
      const f = stack[j]!;
      if (result.parents.has(f.c)) break;
      const up = j > 0 ? stack[j - 1]! : null;
      result.parents.set(f.c, {
        parent: up ? up.c : null,
        key: up ? (up.keys ? up.keys[up.i - 1]! : up.i - 1) : null,
      });
    }
  };

  while (stack.length) {
    const f = stack[stack.length - 1]!;
    if (f.i >= f.len) {
      stack.pop();
      continue;
    }
    const key: string | number = f.keys ? f.keys[f.i]! : f.i;
    f.i++;
    const value = (f.c as Record<string | number, unknown>)[key];
    if (matchFlags(f.keys ? key : null, value, re)) {
      registerPath();
      result.containers.push(f.c);
      result.keys.push(key);
      result.count++;
    }
    if (isContainerValue(value)) stack.push(frame(value, sortKeys));
    if (++steps % slice === 0) yield;
  }
  result.done = true;
}

/** Synchronous search. */
export function searchAll(root: unknown, re: RegExp, sortKeys = false): SearchResult {
  const result = emptyResult();
  const it = searchSteps(root, re, result, Infinity, sortKeys);
  while (!it.next().done);
  return result;
}

/** Keys from the root to match `i`. */
export function pathOfMatch(result: SearchResult, i: number): (string | number)[] {
  const container = result.containers[i];
  if (container === null || container === undefined) return [];
  const path: (string | number)[] = [result.keys[i] as string | number];
  let c: object | null = container;
  while (c) {
    const link = result.parents.get(c);
    if (!link || link.parent === null) break;
    path.push(link.key as string | number);
    c = link.parent;
  }
  return path.reverse();
}

/** Does `node` itself match? */
export function nodeMatches(node: TNode, re: RegExp): boolean {
  const key = node.parent && node.parent.kind === 'object' ? node.key : null;
  return matchFlags(key, node.value, re) !== 0;
}

/**
 * Filter mode keeps a node when it matches, when it is a container on the path
 * to a match (so no hit is orphaned), or when it sits inside a matching node
 * (so a matching object does not render as empty).
 */
export function filterIncludes(result: SearchResult, isMatch: (node: TNode) => boolean): (node: TNode) => boolean {
  return (node) => {
    if (isMatch(node)) return true;
    if (isContainerValue(node.value) && result.parents.has(node.value)) return true;
    for (let p = node.parent; p && p.parent; p = p.parent) if (isMatch(p)) return true;
    return false;
  };
}

/**
 * A SearchResult built from match paths (a JSONPath query's output), so query
 * results reuse everything text search has: stepping, revealing, filtering.
 */
export function resultFromPaths(root: unknown, paths: readonly (readonly (string | number)[])[]): SearchResult {
  const result = emptyResult();
  for (const path of paths) {
    if (path.length === 0) {
      result.containers.push(null);
      result.keys.push(null);
      result.count++;
      continue;
    }
    let container = root as object;
    let parent: object | null = null;
    let parentKey: Key = null;
    for (let j = 0; ; j++) {
      if (!result.parents.has(container)) result.parents.set(container, { parent, key: parentKey });
      if (j === path.length - 1) break;
      parent = container;
      parentKey = path[j]!;
      container = (container as Record<string | number, unknown>)[path[j]!] as object;
    }
    result.containers.push(container);
    result.keys.push(path[path.length - 1]!);
    result.count++;
  }
  result.done = true;
  return result;
}

/** Is `node` one of `result`'s matches? Matches are identified by their container and key. */
export function matchLookup(result: SearchResult): (node: TNode) => boolean {
  const byContainer = new Map<object | null, Set<Key>>();
  for (let i = 0; i < result.count; i++) {
    const c = result.containers[i] ?? null;
    let keys = byContainer.get(c);
    if (!keys) byContainer.set(c, (keys = new Set()));
    keys.add(result.keys[i] ?? null);
  }
  return (node) => byContainer.get(node.parent ? (node.parent.value as object) : null)?.has(node.key) ?? false;
}
