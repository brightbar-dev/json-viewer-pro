import { describe, it, expect } from 'vitest';
import { LosslessNumber } from '../lib/lossless';
import { cellOf, cellText, compareCells, isTabular, preview, sortedOrder, tableColumns, VALUE_COLUMN } from '../lib/tabular';

const users = [
  { id: 2, name: 'Grace', email: 'grace@example.com', tags: ['a', 'b'] },
  { id: 1, name: 'Ada', active: true },
  { id: 10, name: 'alan', profile: { url: 'https://example.com', age: 41 } },
];

describe('isTabular', () => {
  it('an array of objects', () => expect(isTabular(users)).toBe(true));
  it('mostly objects is enough', () => expect(isTabular([{ a: 1 }, { a: 2 }, 3])).toBe(true));
  it('not an empty array', () => expect(isTabular([])).toBe(false));
  it('not an array of numbers', () => expect(isTabular([1, 2, 3])).toBe(false));
  it('not an array of arrays', () => expect(isTabular([[1], [2]])).toBe(false));
  it('not an object', () => expect(isTabular({ a: 1 })).toBe(false));
});

describe('tableColumns', () => {
  it('union of keys in first-seen order', () =>
    expect(tableColumns(users)).toEqual({ columns: ['id', 'name', 'email', 'tags', 'active', 'profile'], truncated: false }));
  it('adds a value column for non-object rows', () => expect(tableColumns([{ a: 1 }, 5]).columns).toEqual([VALUE_COLUMN, 'a']));
  it('caps the number of columns and says so', () => {
    const wide = [Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]))];
    expect(tableColumns(wide, 5)).toEqual({ columns: ['k0', 'k1', 'k2', 'k3', 'k4'], truncated: true });
  });
});

describe('cells', () => {
  it('kinds', () => {
    expect(cellOf(users[0], 'id')).toEqual({ kind: 'number', value: 2 });
    expect(cellOf(users[0], 'tags').kind).toBe('array');
    expect(cellOf(users[2], 'profile').kind).toBe('object');
    expect(cellOf(users[1], 'email')).toEqual({ kind: 'missing', value: undefined });
    expect(cellOf({ x: null }, 'x').kind).toBe('null');
    expect(cellOf({ x: new LosslessNumber('149883901923910003') }, 'x').kind).toBe('number');
  });
  it('the value column holds non-object rows only', () => {
    expect(cellOf(5, VALUE_COLUMN)).toEqual({ kind: 'number', value: 5 });
    expect(cellOf({ a: 1 }, VALUE_COLUMN).kind).toBe('missing');
  });
  it('text', () => {
    expect(cellText(cellOf(users[0], 'name'))).toBe('Grace');
    expect(cellText(cellOf({ x: new LosslessNumber('149883901923910003') }, 'x'))).toBe('149883901923910003');
    expect(cellText(cellOf(users[0], 'tags'))).toBe('["a", "b"]');
    expect(cellText(cellOf(users[2], 'profile'))).toBe('{"url": "https://example.com", "age": 41}');
    expect(cellText(cellOf(users[1], 'email'))).toBe('');
    expect(cellText({ kind: 'string', value: 'x'.repeat(100) }, 10)).toBe('xxxxxxxxx…');
  });
  it('preview stops early on a huge value', () => {
    const huge = Array.from({ length: 100000 }, (_, i) => ({ i }));
    const p = preview(huge, 40);
    expect(p.length).toBeLessThanOrEqual(40);
    expect(p.endsWith('…')).toBe(true);
  });
});

describe('sorting', () => {
  it('numbers numerically, not as text', () => expect(sortedOrder(users, 'id', 1)).toEqual([1, 0, 2]));
  it('descending', () => expect(sortedOrder(users, 'id', -1)).toEqual([2, 0, 1]));
  it('strings naturally and case-insensitively', () => expect(sortedOrder(users, 'name', 1)).toEqual([1, 2, 0]));
  it('rows without the column stay at the bottom in both directions', () => {
    expect(sortedOrder(users, 'email', 1)).toEqual([0, 1, 2]);
    expect(sortedOrder(users, 'active', -1)).toEqual([1, 0, 2]);
  });
  it('big integers sort exactly', () => {
    const rows = [{ id: new LosslessNumber('149883901923910004') }, { id: new LosslessNumber('149883901923910003') }, { id: 5 }];
    expect(sortedOrder(rows, 'id', 1)).toEqual([2, 1, 0]);
  });
  it('is stable for equal values', () => expect(sortedOrder([{ a: 1 }, { a: 1 }, { a: 0 }], 'a', 1)).toEqual([2, 0, 1]));
  it('mixed kinds group by kind', () => {
    expect(compareCells({ kind: 'number', value: 5 }, { kind: 'string', value: '1' })).toBeLessThan(0);
    expect(compareCells({ kind: 'null', value: null }, { kind: 'boolean', value: true })).toBeGreaterThan(0);
  });
});
