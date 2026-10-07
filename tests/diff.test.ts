import { describe, it, expect } from 'vitest';
import { applyPatch, diffValues, toPatch, DiffDepthError, type DiffNode, type DiffOptions } from '../lib/diff';
import { LosslessNumber } from '../lib/lossless';
import { stringifyJson } from '../lib/serialize';

const diff = (a: unknown, b: unknown, o: Partial<DiffOptions> = {}) => diffValues(a, b, o);

/** `kind@path` of every difference, in display order. */
const summary = (r: ReturnType<typeof diff>) => r.changes.map((n) => `${n.kind}${n.reordered ? '(reordered)' : ''}@/${n.path().join('/')}`);

/** The patch must turn `a` into `b` (exactly, or as a collection for unordered arrays). */
function roundTrip(a: unknown, b: unknown, o: Partial<DiffOptions> = {}) {
  const r = diff(a, b, o);
  const out = applyPatch(a, toPatch(r));
  return { r, out };
}

describe('diffValues: equality', () => {
  it('identical documents have no root', () => {
    const r = diff({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] });
    expect(r.root).toBeNull();
    expect(r.changes).toEqual([]);
  });
  it('1 equals 1.0 and 1e0, but not 2', () => {
    expect(diff(1, new LosslessNumber('1.0')).root).toBeNull();
    expect(diff(new LosslessNumber('100'), new LosslessNumber('1e2')).root).toBeNull();
    expect(diff(1, 2).root?.kind).toBe('changed');
  });
  it('exact big numbers differ in their last digit', () => {
    const a = new LosslessNumber('12345678901234567890');
    const b = new LosslessNumber('12345678901234567891');
    expect(diff(a, b).root?.kind).toBe('changed');
    expect(diff(a, new LosslessNumber('12345678901234567890')).root).toBeNull();
  });
  it('null, false, 0 and "" are all different from each other', () => {
    const vals = [null, false, 0, ''];
    for (const x of vals) for (const y of vals) expect(diff(x, y).root === null).toBe(x === y);
  });
});

describe('diffValues: objects', () => {
  it('reports added, removed and changed keys', () => {
    const r = diff({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, d: 4 });
    expect(summary(r)).toEqual(['changed@/b', 'removed@/c', 'added@/d']);
    expect(r.root!.count).toBe(3);
  });
  it('a nested change makes every ancestor modified and counts once', () => {
    const r = diff({ x: { y: { z: 1 } } }, { x: { y: { z: 2 } } });
    expect(r.root!.kind).toBe('modified');
    expect(r.changes.map((n) => n.kind)).toEqual(['changed']);
    expect(r.root!.count).toBe(1);
  });
  it('a type change is one changed node (not a deep diff)', () => {
    const r = diff({ a: { b: 1 } }, { a: [1] });
    expect(summary(r)).toEqual(['changed@/a']);
  });
  it('key order is ignored by default', () => {
    expect(diff({ a: 1, b: 2 }, { b: 2, a: 1 }).root).toBeNull();
  });
  it('key order is a difference when asked, and it does not make a patch operation', () => {
    const r = diff({ a: 1, b: 2 }, { b: 2, a: 1 }, { ignoreKeyOrder: false });
    expect(summary(r)).toEqual(['modified(reordered)@/']);
    expect(toPatch(r)).toEqual([]);
  });
  it('does not call a missing key a reorder', () => {
    const r = diff({ a: 1, b: 2, c: 3 }, { a: 1, c: 3 }, { ignoreKeyOrder: false });
    expect(summary(r)).toEqual(['removed@/b']);
  });
  it('a key named __proto__ is an ordinary key', () => {
    const a = JSON.parse('{"__proto__": 1}');
    const b = JSON.parse('{"__proto__": 2}');
    expect(summary(diff(a, b))).toEqual(['changed@/__proto__']);
    expect(diff(a, {}).root?.kind).toBe('modified');
  });
});

describe('diffValues: arrays by index', () => {
  it('compares item by item', () => {
    expect(summary(diff([1, 2, 3], [1, 9, 3]))).toEqual(['changed@/1']);
  });
  it('trailing items are added or removed', () => {
    expect(summary(diff([1], [1, 2, 3]))).toEqual(['added@/1', 'added@/2']);
    expect(summary(diff([1, 2, 3], [1]))).toEqual(['removed@/1', 'removed@/2']);
  });
  it('an inserted item shifts the rest, as an index diff must', () => {
    expect(summary(diff([1, 2, 3], [0, 1, 2, 3]))).toEqual(['changed@/0', 'changed@/1', 'changed@/2', 'added@/3']);
  });
});

describe('diffValues: arrays as unordered sets', () => {
  const o = { unorderedArrays: true };
  it('the same items in another order are equal', () => {
    expect(diff([1, 2, 3], [3, 1, 2], o).root).toBeNull();
    expect(diff([{ a: 1 }, { b: 2 }], [{ b: 2 }, { a: 1 }], o).root).toBeNull();
  });
  it('is recursive: inner arrays are unordered too', () => {
    expect(diff({ k: [[1, 2], [3]] }, { k: [[3], [2, 1]] }, o).root).toBeNull();
  });
  it('duplicates count: [1,1] is not [1]', () => {
    expect(summary(diff([1, 1], [1], o))).toEqual(['removed@/1']);
    expect(summary(diff([1], [1, 1], o))).toEqual(['added@/1']);
  });
  it('leftovers pair up as changes, surplus is added or removed', () => {
    expect(summary(diff([1, 2, 3], [3, 1, 9], o))).toEqual(['changed@/1']);
    expect(summary(diff([1], [1, 7, 8], o))).toEqual(['added@/1', 'added@/2']);
    expect(summary(diff([1, 7, 8], [1], o))).toEqual(['removed@/1', 'removed@/2']);
  });
  it('an edited record reads as one change inside it', () => {
    const r = diff([{ id: 1, v: 'a' }, { id: 2, v: 'b' }], [{ id: 2, v: 'b' }, { id: 1, v: 'z' }], o);
    expect(summary(r)).toEqual(['changed@/0/v']);
  });
  it('still honours key order when it is not ignored', () => {
    expect(diff([{ a: 1, b: 2 }], [{ b: 2, a: 1 }], { ...o, ignoreKeyOrder: false }).root).not.toBeNull();
  });
});

describe('children for the view', () => {
  it('allChildren merges equal items between the changed ones, in order', () => {
    const r = diff({ a: 1, b: 2, c: 3, d: 4 }, { a: 1, b: 9, c: 3, e: 5 });
    const kids = r.root!.allChildren();
    expect(kids.map((k) => `${k.key}:${k.kind}`)).toEqual(['a:equal', 'b:changed', 'c:equal', 'd:removed', 'e:added']);
    expect(r.root!.changedChildren().map((k) => k.key)).toEqual(['b', 'd', 'e']);
  });
  it('array children keep index order, with surplus items after', () => {
    const r = diff([1, 2, 3], [1, 9]);
    expect(r.root!.allChildren().map((k) => `${k.key}:${k.kind}`)).toEqual(['0:equal', '1:changed', '2:removed']);
  });
  it('unordered children list every left item, matched ones equal', () => {
    const r = diff([1, 2, 3], [3, 1, 9], { unorderedArrays: true });
    expect(r.root!.allChildren().map((k) => `${k.key}:${k.kind}`)).toEqual(['0:equal', '1:changed', '2:equal']);
  });
  it('an added container expands into added children; an equal one into equal children', () => {
    const r = diff({ keep: { x: 1 } }, { keep: { x: 1 }, n: { a: [1] } });
    const n = r.root!.changed[0]!;
    expect(n.kind).toBe('added');
    expect(n.expandable).toBe(true);
    expect(n.allChildren().map((k) => `${k.key}:${k.kind}`)).toEqual(['a:added']);
    const eq = r.root!.allChildren()[0]!;
    expect(eq.kind).toBe('equal');
    expect(eq.allChildren().map((k) => `${k.key}:${k.kind}`)).toEqual(['x:equal']);
  });
  it('a changed scalar is not expandable; an empty container is not either', () => {
    const r = diff({ a: 1, e: [] }, { a: 2, e: [], f: {} });
    expect(r.root!.changed[0]!.expandable).toBe(false);
    expect(r.root!.changed[1]!.expandable).toBe(false);
  });
});

describe('sequence numbers', () => {
  it('count differences in display order; modified nodes know their first', () => {
    const r = diff({ a: { x: 1, y: 2 }, b: 1, c: [1, 2] }, { a: { x: 9, y: 8 }, b: 2, c: [1] });
    expect(summary(r)).toEqual(['changed@/a/x', 'changed@/a/y', 'changed@/b', 'removed@/c/1']);
    expect(r.changes.map((n) => n.seq)).toEqual([0, 1, 2, 3]);
    const a = r.root!.changed[0]!;
    expect(a.firstSeq).toBe(0);
    expect(r.root!.changed[2]!.firstSeq).toBe(3);
  });
});

describe('toPatch (RFC 6902)', () => {
  it('has the documented shape', () => {
    const r = diff({ a: 1, b: { c: 2 }, d: 3 }, { a: 2, b: { c: 2, e: 5 } });
    expect(toPatch(r)).toEqual([
      { op: 'replace', path: '/a', value: 2 },
      { op: 'add', path: '/b/e', value: 5 },
      { op: 'remove', path: '/d' },
    ]);
  });
  it('escapes ~ and / in keys', () => {
    const r = diff({ 'a/b': 1, 'c~d': 1 }, { 'a/b': 2, 'c~d': 2 });
    expect(toPatch(r).map((o) => o.path)).toEqual(['/a~1b', '/c~0d']);
  });
  it('replaces the whole document when the roots differ', () => {
    expect(toPatch(diff({ a: 1 }, [1]))).toEqual([{ op: 'replace', path: '', value: [1] }]);
    expect(toPatch(diff(1, 2))).toEqual([{ op: 'replace', path: '', value: 2 }]);
    expect(toPatch(diff({}, {}))).toEqual([]);
  });
  it('removes array items from the end so indexes stay valid', () => {
    const r = diff([1, 2, 3, 4], [1, 9]);
    expect(toPatch(r)).toEqual([
      { op: 'replace', path: '/1', value: 9 },
      { op: 'remove', path: '/3' },
      { op: 'remove', path: '/2' },
    ]);
  });
  it('appends with "-" for unordered arrays', () => {
    const r = diff([1], [1, 5, 6], { unorderedArrays: true });
    expect(toPatch(r)).toEqual([
      { op: 'add', path: '/-', value: 5 },
      { op: 'add', path: '/-', value: 6 },
    ]);
  });

  const cases: [string, unknown, unknown][] = [
    ['objects', { a: 1, b: { c: [1, 2, { d: 1 }] }, e: null }, { a: 2, b: { c: [1, 3, { d: 2 }, 4] }, f: true }],
    ['shrinking arrays', { l: [1, 2, 3, 4, 5], m: [{ a: 1 }, { a: 2 }] }, { l: [1], m: [{ a: 1 }] }],
    ['type changes', { a: [1], b: { x: 1 }, c: 'str' }, { a: { y: 1 }, b: [2], c: null }],
    ['special keys', { '': 1, 'a/b': { '~': 2 } }, { '': 2, 'a/b': { '~': 3, '/': 1 } }],
  ];
  for (const [name, a, b] of cases) {
    it(`applying the patch gives the right document: ${name}`, () => {
      const { out } = roundTrip(a, b);
      expect(out).toEqual(b);
    });
  }

  it('applying the patch works for unordered arrays (equal as collections)', () => {
    const a = { l: [1, 2, 3, 4], m: [{ id: 1, v: 'a' }, { id: 2 }] };
    const b = { l: [4, 9, 1], m: [{ id: 2 }, { id: 1, v: 'z' }, { id: 3 }] };
    const { r, out } = roundTrip(a, b, { unorderedArrays: true });
    expect(diff(out, b, { unorderedArrays: true }).root).toBeNull();
    expect(r.changes.length).toBeGreaterThan(0);
  });

  it('randomised documents: patch(a) equals b (ordered) and diff(patch(a), b) is empty (unordered)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const gen = (depth: number): unknown => {
      const t = rnd();
      if (depth > 3 || t < 0.4) return [1, 2, 'x', null, true, 3.5][Math.floor(rnd() * 6)];
      if (t < 0.7) return Array.from({ length: Math.floor(rnd() * 5) }, () => gen(depth + 1));
      const o: Record<string, unknown> = {};
      for (let i = Math.floor(rnd() * 5); i > 0; i--) o[`k${Math.floor(rnd() * 6)}`] = gen(depth + 1);
      return o;
    };
    for (let i = 0; i < 300; i++) {
      const a = gen(0);
      const b = rnd() < 0.5 ? gen(0) : JSON.parse(JSON.stringify(a), (_k, v) => (typeof v === 'number' && rnd() < 0.2 ? v + 1 : v));
      expect(applyPatch(a, toPatch(diff(a, b)))).toEqual(b);
      expect(diff(applyPatch(a, toPatch(diff(a, b, { unorderedArrays: true }))), b, { unorderedArrays: true }).root).toBeNull();
    }
  });

  it('carries exact big numbers through the patch text', () => {
    const big = new LosslessNumber('12345678901234567890');
    const r = diff({ id: 1 }, { id: big });
    expect(stringifyJson(toPatch(r))).toBe('[{"op":"replace","path":"/id","value":12345678901234567890}]');
  });
});

describe('scale and limits', () => {
  it('walks a large pair quickly and keeps nodes only for the changes', () => {
    const make = (flip: boolean) => Array.from({ length: 200_000 }, (_, i) => ({ id: i, name: `item ${i}`, tags: ['a', 'b'], n: { x: i % 7 }, ok: flip && i % 50_000 === 0 ? false : true }));
    const a = make(false);
    const b = make(true);
    const t = performance.now();
    const r = diff(a, b);
    expect(performance.now() - t).toBeLessThan(5000);
    expect(r.changes).toHaveLength(4);
    expect(r.root!.changed).toHaveLength(4);
  });
  it('unordered comparison of a large shuffled array is equal', () => {
    const a = Array.from({ length: 50_000 }, (_, i) => ({ id: i, s: `v${i}` }));
    const b = [...a].reverse();
    expect(diff(a, b, { unorderedArrays: true }).root).toBeNull();
  });
  it('reports absurd nesting instead of crashing', () => {
    let a: unknown = 1;
    let b: unknown = 2;
    for (let i = 0; i < 200_000; i++) {
      a = [a];
      b = [b];
    }
    expect(() => diff(a, b)).toThrow(DiffDepthError);
  });
});

describe('DiffNode.path', () => {
  it('runs from the root with left-hand keys', () => {
    const r = diff({ a: [{ b: 1 }] }, { a: [{ b: 2 }] });
    const n: DiffNode = r.changes[0]!;
    expect(n.path()).toEqual(['a', 0, 'b']);
  });
});
