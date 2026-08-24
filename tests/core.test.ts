import { describe, it, expect } from 'vitest';
import {
  formatSize,
  generatePath,
  isUrl,
  matchesQuery,
  formatMatchCount,
  computeVisibleNodes,
  resolveShortcut,
} from '../entrypoints/content';

// ========== JSON Detection ==========
describe('JSON parsing', () => {
  function tryParseJson(text: string) {
    try { return JSON.parse(text); }
    catch { return null; }
  }

  it('parses simple object', () => expect(tryParseJson('{"key": "value"}')).not.toBeNull());
  it('parses nested object', () => expect(tryParseJson('{"a": {"b": {"c": 1}}}')).not.toBeNull());
  it('parses array', () => expect(tryParseJson('[1, 2, 3]')).not.toBeNull());
  it('parses empty object', () => expect(tryParseJson('{}')).not.toBeNull());
  it('parses empty array', () => expect(tryParseJson('[]')).not.toBeNull());
  it('parses string', () => expect(tryParseJson('"hello"')).toBe('hello'));
  it('parses number', () => expect(tryParseJson('42')).toBe(42));
  it('parses boolean true', () => expect(tryParseJson('true')).toBe(true));
  it('parses boolean false', () => expect(tryParseJson('false')).toBe(false));
  it('parses null', () => expect(tryParseJson('null')).toBeNull());
  it('rejects plain text', () => expect(tryParseJson('hello world')).toBeNull());
  it('rejects HTML', () => expect(tryParseJson('<html></html>')).toBeNull());
  it('rejects incomplete JSON', () => expect(tryParseJson('{"key":')).toBeNull());
  it('rejects trailing comma', () => expect(tryParseJson('{"a": 1,}')).toBeNull());
  it('rejects single quotes', () => expect(tryParseJson("{'a': 1}")).toBeNull());

  it('parses 1000-key object', () => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < 1000; i++) obj['key' + i] = 'value' + i;
    expect(tryParseJson(JSON.stringify(obj))).not.toBeNull();
  });

  it('parses unicode escapes', () => expect(tryParseJson('{"emoji": "\\u2764"}')).not.toBeNull());
  it('parses actual unicode', () => expect(tryParseJson('{"emoji": "\u2764"}')).not.toBeNull());
});

// ========== URL Detection ==========
describe('URL detection', () => {
  it('detects http URL', () => expect(isUrl('http://example.com')).toBe(true));
  it('detects https URL', () => expect(isUrl('https://api.github.com/repos')).toBe(true));
  it('detects URL with path', () => expect(isUrl('https://example.com/path/to/resource')).toBe(true));
  it('rejects plain string', () => expect(isUrl('not a url')).toBe(false));
  it('rejects ftp', () => expect(isUrl('ftp://files.example.com')).toBe(false));
  it('rejects data URI', () => expect(isUrl('data:text/plain;base64,')).toBe(false));
  it('rejects javascript URI', () => expect(isUrl('javascript:alert(1)')).toBe(false));
});

// ========== Path Generation ==========
describe('path generation', () => {
  it('simple key', () => expect(generatePath('$', 'name')).toBe('$.name'));
  it('nested key', () => expect(generatePath('$.user', 'email')).toBe('$.user.email'));
  it('key with spaces', () => expect(generatePath('$', 'full name')).toBe('$["full name"]'));
  it('key with dots', () => expect(generatePath('$', 'a.b')).toBe('$["a.b"]'));
  it('key starting with number', () => expect(generatePath('$', '0key')).toBe('$["0key"]'));
  it('key with dashes', () => expect(generatePath('$', 'foo-bar')).toBe('$["foo-bar"]'));
  it('underscore key', () => expect(generatePath('$', '_private')).toBe('$._private'));
  it('dollar key', () => expect(generatePath('$', '$ref')).toBe('$.$ref'));
});

// ========== Size Formatting ==========
describe('size formatting', () => {
  it('formats bytes', () => expect(formatSize(500)).toBe('500 B'));
  it('formats KB', () => expect(formatSize(2048)).toBe('2.0 KB'));
  it('formats MB', () => expect(formatSize(1500000)).toBe('1.4 MB'));
  it('formats 0 bytes', () => expect(formatSize(0)).toBe('0 B'));
  it('formats 1024 bytes', () => expect(formatSize(1024)).toBe('1024 B'));
  it('formats 1025 bytes', () => expect(formatSize(1025)).toBe('1.0 KB'));
});

// ========== Search matching ==========
describe('search matching', () => {
  it('matches a substring', () => expect(matchesQuery('"userName"', 'user')).toBe(true));
  it('is case-insensitive on the haystack', () => expect(matchesQuery('"UserName"', 'user')).toBe(true));
  it('rejects a non-match', () => expect(matchesQuery('"userName"', 'zzz')).toBe(false));
  it('empty query never matches', () => expect(matchesQuery('anything', '')).toBe(false));
  it('null haystack never matches', () => expect(matchesQuery(null, 'a')).toBe(false));
  it('undefined haystack never matches', () => expect(matchesQuery(undefined, 'a')).toBe(false));
  it('matches inside a value', () => expect(matchesQuery('"https://example.com"', 'example')).toBe(true));
  it('matches a number rendered as text', () => expect(matchesQuery('42', '4')).toBe(true));
});

describe('match count formatting', () => {
  it('zero', () => expect(formatMatchCount(0)).toBe('No matches'));
  it('one is singular', () => expect(formatMatchCount(1)).toBe('1 match'));
  it('two is plural', () => expect(formatMatchCount(2)).toBe('2 matches'));
  it('many', () => expect(formatMatchCount(137)).toBe('137 matches'));
});

// ========== Filter visibility ==========
describe('filter visibility', () => {
  // Tree: 0 root -> 1 "user" -> 2 "name", 3 "id"; 0 -> 4 "meta"
  const parents = [null, 0, 1, 1, 0];

  it('no matches means nothing visible', () => {
    const v = computeVisibleNodes(parents, [false, false, false, false, false]);
    expect(v.size).toBe(0);
  });

  it('keeps a match and its ancestors', () => {
    const v = computeVisibleNodes(parents, [false, false, true, false, false]);
    expect([...v].sort()).toEqual([0, 1, 2]);
  });

  it('keeps descendants of a matching node', () => {
    const v = computeVisibleNodes(parents, [false, true, false, false, false]);
    expect([...v].sort()).toEqual([0, 1, 2, 3]);
  });

  it('hides unrelated siblings', () => {
    const v = computeVisibleNodes(parents, [false, false, true, false, false]);
    expect(v.has(4)).toBe(false);
    expect(v.has(3)).toBe(false);
  });

  it('a root match keeps the whole tree', () => {
    const v = computeVisibleNodes(parents, [true, false, false, false, false]);
    expect(v.size).toBe(5);
  });

  it('handles multiple matches in different branches', () => {
    const v = computeVisibleNodes(parents, [false, false, true, false, true]);
    expect([...v].sort()).toEqual([0, 1, 2, 4]);
  });

  it('handles a flat list of roots', () => {
    const v = computeVisibleNodes([null, null, null], [false, true, false]);
    expect([...v]).toEqual([1]);
  });

  it('handles an empty tree', () => {
    expect(computeVisibleNodes([], []).size).toBe(0);
  });
});

// ========== Keyboard shortcuts ==========
describe('keyboard shortcuts', () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
    ({ key: k, ctrlKey: false, metaKey: false, ...mods });

  it('Cmd+F focuses search', () =>
    expect(resolveShortcut(key('f', { metaKey: true }), false)).toBe('focus-search'));
  it('Ctrl+F focuses search', () =>
    expect(resolveShortcut(key('f', { ctrlKey: true }), false)).toBe('focus-search'));
  it('Cmd+F works even while typing', () =>
    expect(resolveShortcut(key('f', { metaKey: true }), true)).toBe('focus-search'));
  it('slash focuses search', () =>
    expect(resolveShortcut(key('/'), false)).toBe('focus-search'));
  it('slash is ignored while typing', () =>
    expect(resolveShortcut(key('/'), true)).toBeNull());
  it('Escape clears search', () =>
    expect(resolveShortcut(key('Escape'), true)).toBe('clear-search'));
  it('Escape works outside the input too', () =>
    expect(resolveShortcut(key('Escape'), false)).toBe('clear-search'));
  it('e expands all', () => expect(resolveShortcut(key('e'), false)).toBe('expand-all'));
  it('c collapses all', () => expect(resolveShortcut(key('c'), false)).toBe('collapse-all'));
  it('does not hijack Cmd+C', () =>
    expect(resolveShortcut(key('c', { metaKey: true }), false)).toBeNull());
  it('does not hijack Ctrl+C', () =>
    expect(resolveShortcut(key('c', { ctrlKey: true }), false)).toBeNull());
  it('does not fire e while typing', () =>
    expect(resolveShortcut(key('e'), true)).toBeNull());
  it('does not fire c while typing', () =>
    expect(resolveShortcut(key('c'), true)).toBeNull());
  it('ignores Alt+F', () =>
    expect(resolveShortcut(key('f', { altKey: true }), false)).toBeNull());
  it('ignores unrelated keys', () =>
    expect(resolveShortcut(key('q'), false)).toBeNull());
  it('handles uppercase E', () => expect(resolveShortcut(key('E'), false)).toBe('expand-all'));
  it('handles uppercase C', () => expect(resolveShortcut(key('C'), false)).toBe('collapse-all'));
  it('handles uppercase F with meta', () =>
    expect(resolveShortcut(key('F', { metaKey: true }), false)).toBe('focus-search'));
});
