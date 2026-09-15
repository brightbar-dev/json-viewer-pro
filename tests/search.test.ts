import { describe, it, expect } from 'vitest';
import { LosslessNumber } from '../lib/lossless';
import {
  compileQuery, emptyResult, filterIncludes, matchFlags, MATCH_KEY, MATCH_VALUE, pathOfMatch, primitiveText, searchAll, searchSteps,
} from '../lib/search';
import { isCloseRow, TreeModel, type Row } from '../lib/tree';

const doc = () => ({
  user: { name: 'Ada', email: 'ada@example.com' },
  tags: ['admin', 'user'],
  count: 42,
  big: new LosslessNumber('12345678901234567890'),
  ok: true,
  none: null,
});

describe('compileQuery', () => {
  it('empty is null', () => expect(compileQuery('   ')).toBeNull());
  it('is case-insensitive', () => expect(compileQuery('ADA')!.test('ada')).toBe(true));
  it('treats regex characters literally', () => {
    const re = compileQuery('a.b(c)')!;
    expect(re.test('a.b(c)')).toBe(true);
    expect(re.test('axb(c)')).toBe(false);
  });
});

describe('primitiveText and matchFlags', () => {
  const re = (q: string) => compileQuery(q)!;
  it('strings are searched without quotes', () => expect(primitiveText('x')).toBe('x'));
  it('lossless numbers are searched by their exact digits', () => expect(primitiveText(new LosslessNumber('149883901923910003'))).toBe('149883901923910003'));
  it('null and booleans', () => expect([primitiveText(null), primitiveText(false)]).toEqual(['null', 'false']));
  it('key match', () => expect(matchFlags('userName', 1, re('user'))).toBe(MATCH_KEY));
  it('value match', () => expect(matchFlags('x', 'a user', re('user'))).toBe(MATCH_VALUE));
  it('both', () => expect(matchFlags('user', 'user', re('user'))).toBe(MATCH_KEY | MATCH_VALUE));
  it('array indices never match', () => expect(matchFlags(3, 7, re('3'))).toBe(0));
  it('containers match only by key', () => expect(matchFlags('k', { user: 1 }, re('user'))).toBe(0));
});

describe('searchAll', () => {
  it('finds keys and values in document order', () => {
    const r = searchAll(doc(), compileQuery('user')!);
    expect(r.count).toBe(2);
    expect(r.done).toBe(true);
    expect(pathOfMatch(r, 0)).toEqual(['user']);
    expect(pathOfMatch(r, 1)).toEqual(['tags', 1]);
  });

  it('finds values nested in objects', () => {
    const r = searchAll(doc(), compileQuery('ada')!);
    expect([pathOfMatch(r, 0), pathOfMatch(r, 1)]).toEqual([['user', 'name'], ['user', 'email']]);
  });

  it('matches numbers, including exact big ones', () => {
    const r = searchAll(doc(), compileQuery('4')!);
    expect([0, 1].map((i) => pathOfMatch(r, i))).toEqual([['count'], ['big']]);
    expect(searchAll(doc(), compileQuery('34567890')!).count).toBe(1);
  });

  it('does not count array indices', () => expect(searchAll([0, 10], compileQuery('0')!).count).toBe(2));

  it('records the containers on each path', () => {
    const d = doc();
    const r = searchAll(d, compileQuery('ada')!);
    expect(r.parents.get(d.user)).toEqual({ parent: d, key: 'user' });
    expect(r.parents.get(d)).toEqual({ parent: null, key: null });
    expect(r.parents.has(d.tags)).toBe(false);
  });

  it('a matching root primitive', () => {
    const r = searchAll('hello', compileQuery('ell')!);
    expect(r.count).toBe(1);
    expect(pathOfMatch(r, 0)).toEqual([]);
  });

  it('sliced search gives the same answer as a synchronous one', () => {
    const big = Array.from({ length: 3000 }, (_, i) => ({ id: i, label: `item ${i}`, nested: { flag: i % 7 === 0 ? 'seven' : 'no' } }));
    const re = compileQuery('seven')!;
    const sync = searchAll(big, re);
    const sliced = emptyResult();
    let yields = 0;
    for (const _ of searchSteps(big, re, sliced, 100)) yields++;
    expect(yields).toBeGreaterThan(10);
    expect(sliced.count).toBe(sync.count);
    expect(sliced.keys).toEqual(sync.keys);
    expect(pathOfMatch(sliced, 5)).toEqual(pathOfMatch(sync, 5));
    expect(pathOfMatch(sync, 5)).toEqual([35, 'nested', 'flag']);
  });
});

function keysOf(rows: Row[]): string[] {
  return rows.map((r) => (isCloseRow(r) ? `/${String(r.closeOf.key ?? 'root')}` : String(r.key ?? 'root')));
}

describe('filterIncludes', () => {
  it('keeps matches and the containers above them', () => {
    const d = doc();
    const re = compileQuery('ada')!;
    const r = searchAll(d, re);
    const m = new TreeModel(d);
    m.expandWhere((n) => typeof n.value === 'object' && n.value !== null && r.parents.has(n.value), false);
    m.setFilter(filterIncludes(r, re));
    expect(keysOf(m.rows)).toEqual(['root', 'user', 'name', 'email', '/user', '/root']);
  });

  it('keeps everything inside a matching container', () => {
    const d = doc();
    const re = compileQuery('user')!;
    const r = searchAll(d, re);
    const m = new TreeModel(d);
    m.expandWhere((n) => typeof n.value === 'object' && n.value !== null && r.parents.has(n.value), false);
    m.setFilter(filterIncludes(r, re));
    expect(keysOf(m.rows)).toEqual(['root', 'user', 'tags', '1', '/tags', '/root']);
    m.expandAt(1); // open the matching "user" object: all of its children stay visible
    expect(keysOf(m.rows)).toEqual(['root', 'user', 'name', 'email', '/user', 'tags', '1', '/tags', '/root']);
  });
});
