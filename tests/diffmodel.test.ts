import { describe, it, expect } from 'vitest';
import { diffValues } from '../lib/diff';
import { DiffModel, isDiffClose, type DiffRow } from '../lib/diffmodel';

/** A readable picture of the row list: `kind key` indented by depth, `}` for closing rows. */
function picture(rows: DiffRow[]): string[] {
  return rows.map((r) => (isDiffClose(r) ? `${'  '.repeat(r.closeOf.depth)}}` : `${'  '.repeat(r.depth)}${r.kind} ${r.key ?? '$'}`));
}

const left = { a: 1, keep: { x: 1, y: 2 }, b: { c: [1, 2], d: 'x' }, gone: true };
const right = { a: 2, keep: { x: 1, y: 2 }, b: { c: [1, 3], d: 'x' }, extra: { n: 1 } };

describe('DiffModel', () => {
  it('has no rows when the documents are equal', () => {
    const m = new DiffModel(diffValues({ a: 1 }, { a: 1 }));
    expect(m.rows).toEqual([]);
    expect(m.step(-1, 1)).toBeNull();
  });

  it('opens the changed containers and leaves equal ones closed', () => {
    const m = new DiffModel(diffValues(left, right));
    expect(picture(m.rows)).toEqual([
      'modified $',
      '  changed a',
      '  equal keep',
      '  modified b',
      '    modified c',
      '      equal 0',
      '      changed 1',
      '    }',
      '    equal d',
      '  }',
      '  removed gone',
      '  added extra',
      '    added n',
      '  }',
      '}',
    ]);
  });

  it('"changes only" hides the equal rows and goes back again', () => {
    const m = new DiffModel(diffValues(left, right));
    m.setChangesOnly(true);
    expect(picture(m.rows).filter((r) => r.includes('equal'))).toEqual([]);
    expect(m.rows).toHaveLength(12);
    m.setChangesOnly(false);
    expect(picture(m.rows)).toContain('  equal keep');
  });

  it('expand and collapse patch the rows exactly as a rebuild would', () => {
    const m = new DiffModel(diffValues(left, right));
    const keep = m.rows.findIndex((r) => !isDiffClose(r) && r.key === 'keep');
    expect(m.expandAt(keep)).toBe(3);
    const patched = picture(m.rows);
    m.rebuild();
    expect(picture(m.rows)).toEqual(patched);
    expect(m.collapseAt(keep)).toBe(3);
    expect(picture(m.rows)).not.toContain('    equal x');
  });

  it('an added container opens into added children', () => {
    const m = new DiffModel(diffValues(left, right));
    const i = m.rows.findIndex((r) => !isDiffClose(r) && r.key === 'extra');
    // small, so it was opened with the rest
    expect(picture(m.rows).slice(i, i + 3)).toEqual(['  added extra', '    added n', '  }']);
  });

  it('the first rows are bounded by the budget on a wide document', () => {
    const a = Array.from({ length: 5000 }, (_, i) => ({ id: i, v: i }));
    const b = a.map((x) => ({ ...x, v: x.v + 1 }));
    const m = new DiffModel(diffValues(a, b));
    expect(m.rows.length).toBeLessThan(10_000);
    expect(m.rows.length).toBeGreaterThan(1500);
  });

  it('expandSubtree opens everything below a node; collapseAll closes to the root', () => {
    const r = diffValues({ k: { a: { b: { c: 1 } } }, z: 1 }, { k: { a: { b: { c: 1 } } }, z: 2 });
    const m = new DiffModel(r);
    const k = m.rows.find((x) => !isDiffClose(x) && x.key === 'k') as any;
    expect(m.expandSubtree(k)).toBe(true);
    expect(picture(m.rows)).toContain('        equal c');
    m.collapseAll();
    expect(picture(m.rows)).toEqual(['modified $', '  equal k', '  changed z', '}']);
  });

  it('reveal opens the ancestors of a hidden difference', () => {
    const m = new DiffModel(diffValues({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } }));
    m.collapseAll();
    const target = m.result.changes[0]!;
    expect(m.indexOf(target)).toBe(-1);
    const i = m.reveal(target);
    expect(i).toBeGreaterThan(0);
    expect(m.rows[i]).toBe(target);
  });
});

describe('DiffModel.step', () => {
  const m = () => new DiffModel(diffValues(left, right));
  const names = (n: { node: { path(): unknown[] } } | null) => n && n.node.path().join('/');

  it('starts at the first (next) or last (previous) difference with no selection', () => {
    expect(names(m().step(-1, 1))).toBe('a');
    expect(names(m().step(-1, -1))).toBe('extra');
  });

  it('walks through every difference in order and wraps', () => {
    const model = m();
    const seen: string[] = [];
    let from = -1;
    let wrappedAt = -1;
    for (let i = 0; i < 6; i++) {
      const s = model.step(from, 1)!;
      if (s.wrapped) wrappedAt = i;
      seen.push(s.node.path().join('/'));
      from = model.reveal(s.node);
    }
    expect(seen).toEqual(['a', 'b/c/1', 'gone', 'extra', 'a', 'b/c/1']);
    expect(wrappedAt).toBe(4);
  });

  it('goes backwards too, and wraps at the start', () => {
    const model = m();
    const first = model.step(-1, 1)!;
    const back = model.step(model.reveal(first.node), -1)!;
    expect(back.wrapped).toBe(true);
    expect(back.node.path().join('/')).toBe('extra');
  });

  it('from an equal row, finds the next difference below and the previous above', () => {
    const model = m();
    const keep = model.rows.findIndex((r) => !isDiffClose(r) && r.key === 'keep');
    expect(names(model.step(keep, 1))).toBe('b/c/1');
    expect(names(model.step(keep, -1))).toBe('a');
  });

  it('from a closed changed container, next goes into it and previous goes before it', () => {
    const model = m();
    const bi = model.rows.findIndex((r) => !isDiffClose(r) && r.key === 'b');
    model.collapseAt(bi);
    expect(names(model.step(bi, 1))).toBe('b/c/1');
    expect(names(model.step(bi, -1))).toBe('a');
    // and from the row after it, previous lands inside the closed container
    expect(names(model.step(bi + 1, -1))).toBe('b/c/1');
  });

  it('from a closing row, next is the difference after the container', () => {
    const model = m();
    const close = model.rows.findIndex((r) => isDiffClose(r) && r.closeOf.key === 'b');
    expect(names(model.step(close, 1))).toBe('gone');
    expect(names(model.step(close, -1))).toBe('b/c/1');
  });

  it('key reorders are differences too', () => {
    const model = new DiffModel(diffValues({ a: 1, b: 2 }, { b: 2, a: 1 }, { ignoreKeyOrder: false }));
    expect(model.result.changes).toHaveLength(1);
    expect(model.step(-1, 1)!.node).toBe(model.result.root);
  });
});
