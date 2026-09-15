import { describe, it, expect } from 'vitest';
import { LosslessNumber } from '../lib/lossless';
import { expandByBudget, isCloseRow, kindOf, pathOf, TNode, TreeModel, type Row } from '../lib/tree';

/** A readable picture of the row list. */
function picture(rows: Row[]): string[] {
  return rows.map((r) => {
    if (isCloseRow(r)) return `${'  '.repeat(r.closeOf.depth)}${r.closeOf.kind === 'array' ? ']' : '}'}`;
    const key = r.key === null ? '' : `${r.key}: `;
    const val = r.isContainer ? (r.expanded && r.expandable ? (r.kind === 'array' ? '[' : '{') : `${r.kind}(${r.size})`) : JSON.stringify(r.value);
    return `${'  '.repeat(r.depth)}${key}${val}`;
  });
}

const sample = () => ({ a: 1, b: [1, 2], c: {}, d: { e: null } });

describe('kindOf', () => {
  it('classifies every JSON type', () => {
    expect([{}, [], 'x', 1, true, null].map(kindOf)).toEqual(['object', 'array', 'string', 'number', 'boolean', 'null']);
  });
  it('a lossless number is a number', () => expect(kindOf(new LosslessNumber('1'))).toBe('number'));
});

describe('TreeModel rows', () => {
  it('starts with just the root row', () => expect(picture(new TreeModel(sample()).rows)).toEqual(['object(4)']));

  it('expanding inserts children and a closing row; empty containers get no closing row', () => {
    const m = new TreeModel(sample());
    expect(m.expandAt(0)).toBe(5);
    expect(picture(m.rows)).toEqual(['{', '  a: 1', '  b: array(2)', '  c: object(0)', '  d: object(1)', '}']);
  });

  it('expand and collapse patch the list exactly as a rebuild would', () => {
    const m = new TreeModel(sample());
    m.expandAt(0);
    expect(m.expandAt(2)).toBe(3);
    const patched = picture(m.rows);
    m.rebuild();
    expect(picture(m.rows)).toEqual(patched);
    expect(patched).toEqual(['{', '  a: 1', '  b: [', '    0: 1', '    1: 2', '  ]', '  c: object(0)', '  d: object(1)', '}']);
    expect(m.collapseAt(2)).toBe(3);
    expect(m.rows).toHaveLength(6);
  });

  it('toggleAt returns a signed delta', () => {
    const m = new TreeModel(sample());
    expect(m.toggleAt(0)).toBe(5);
    expect(m.toggleAt(0)).toBe(-5);
  });

  it('ignores primitives, empty containers and closing rows', () => {
    const m = new TreeModel(sample());
    m.expandAt(0);
    expect(m.expandAt(1)).toBe(0); // a: 1
    expect(m.expandAt(3)).toBe(0); // c: {}
    expect(m.expandAt(5)).toBe(0); // }
  });

  it('children are materialised lazily', () => {
    const m = new TreeModel({ big: Array.from({ length: 10 }, (_, i) => ({ i })) });
    expect(m.root.children).toBeNull();
    m.expandAt(0);
    expect(m.root.children).toHaveLength(1);
    expect(m.root.children![0]!.children).toBeNull();
  });

  it('reveal expands ancestors and returns the row index', () => {
    const m = new TreeModel({ a: { b: [0, { c: 'hit' }] }, z: 1 });
    const i = m.reveal(['a', 'b', 1, 'c']);
    const row = m.rows[i] as TNode;
    expect(row.key).toBe('c');
    expect(row.value).toBe('hit');
    expect(pathOf(row)).toEqual(['a', 'b', 1, 'c']);
  });
  it('reveal of a missing path is -1', () => expect(new TreeModel({ a: 1 }).reveal(['nope'])).toBe(-1));
  it('reveal of the root is 0', () => expect(new TreeModel({ a: 1 }).reveal([])).toBe(0));

  it('expandSubtreeAt opens everything below', () => {
    const m = new TreeModel({ a: { b: { c: [1] } } });
    m.expandSubtreeAt(0);
    expect(picture(m.rows)).toEqual(['{', '  a: {', '    b: {', '      c: [', '        0: 1', '      ]', '    }', '  }', '}']);
  });
  it('expandSubtreeAt stops at its limit, says so, and continues when called again', () => {
    const m = new TreeModel(Array.from({ length: 100 }, () => ({ x: [1, 2, 3] })));
    expect(m.expandSubtreeAt(0, 150)).toBe(false);
    const opened = (n = m.root) => (n.children ?? []).filter((c) => c.expanded).length;
    expect(opened()).toBeGreaterThan(0);
    expect(opened()).toBeLessThan(100);
    const before = m.rows.length;
    expect(m.expandSubtreeAt(0)).toBe(true);
    expect(m.rows.length).toBeGreaterThan(before);
    expect(m.rows).toHaveLength(1 + 100 * 7 + 1);
  });

  it('expandSubtreeAt on an already open node replaces its block exactly', () => {
    const m = new TreeModel(sample());
    m.expandAt(0);
    m.expandSubtreeAt(0);
    const patched = picture(m.rows);
    m.rebuild();
    expect(picture(m.rows)).toEqual(patched);
  });

  it('collapseAll leaves only the root open', () => {
    const m = new TreeModel(sample());
    m.expandSubtreeAt(0);
    m.collapseAll();
    expect(picture(m.rows)).toEqual(['{', '  a: 1', '  b: array(2)', '  c: object(0)', '  d: object(1)', '}']);
  });

  it('a filter hides rows but keeps the structure consistent', () => {
    const m = new TreeModel(sample());
    m.expandSubtreeAt(0);
    m.setFilter((n) => n.key !== 'b');
    expect(picture(m.rows)).toEqual(['{', '  a: 1', '  c: object(0)', '  d: {', '    e: null', '  }', '}']);
    m.setFilter(null);
    expect(m.rows).toHaveLength(11);
  });
});

describe('expandByBudget', () => {
  it('opens a small document completely', () => {
    const m = new TreeModel(sample());
    expect(expandByBudget(m.root, 1500)).toBe(11);
    m.rebuild();
    expect(m.rows).toHaveLength(11);
  });

  it('always opens the root, even past the budget', () => {
    const m = new TreeModel(Array.from({ length: 5000 }, (_, i) => ({ id: i })));
    expect(expandByBudget(m.root, 1500)).toBe(5002);
    expect(m.root.children!.every((c) => !c.expanded)).toBe(true);
  });

  it('opens a level as far as the budget goes, then stops', () => {
    const m = new TreeModel(Array.from({ length: 100 }, () => ({ a: 1, b: 2, c: 3, d: 4 })));
    expect(expandByBudget(m.root, 300)).toBe(297);
    expect(m.root.children!.filter((c) => c.expanded)).toHaveLength(39);
    m.rebuild();
    expect(m.rows).toHaveLength(297);
  });

  it('skips a huge sibling and still opens the small ones', () => {
    const m = new TreeModel({ data: Array.from({ length: 5000 }, (_, i) => i), meta: { page: 1 } });
    expandByBudget(m.root, 100);
    const [data, meta] = m.root.children!;
    expect(data!.expanded).toBe(false);
    expect(meta!.expanded).toBe(true);
  });

  it('a primitive root is one row', () => expect(expandByBudget(new TreeModel(42).root, 10)).toBe(1));
});
