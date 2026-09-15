import { describe, it, expect } from 'vitest';
import { formatCount, formatMatchCount, formatNumber, formatSize, isUrl, utf8Length } from '../lib/format';
import { normalizeSettings } from '../lib/settings';
import { resolveShortcut } from '../lib/shortcuts';
import { formatPath } from '../lib/tree';

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

// ========== Path formatting ==========
describe('path formatting', () => {
  it('root', () => expect(formatPath([])).toBe('$'));
  it('simple key', () => expect(formatPath(['name'])).toBe('$.name'));
  it('nested key', () => expect(formatPath(['user', 'email'])).toBe('$.user.email'));
  it('key with spaces', () => expect(formatPath(['full name'])).toBe('$["full name"]'));
  it('key with dots', () => expect(formatPath(['a.b'])).toBe('$["a.b"]'));
  it('key starting with number', () => expect(formatPath(['0key'])).toBe('$["0key"]'));
  it('key with dashes', () => expect(formatPath(['foo-bar'])).toBe('$["foo-bar"]'));
  it('underscore key', () => expect(formatPath(['_private'])).toBe('$._private'));
  it('dollar key', () => expect(formatPath(['$ref'])).toBe('$.$ref'));
  it('array indices', () => expect(formatPath(['data', 3, 'email'])).toBe('$.data[3].email'));
  it('a numeric-looking object key stays a string', () => expect(formatPath(['3'])).toBe('$["3"]'));
  it('quotes inside a key are escaped', () => expect(formatPath(['say "hi"'])).toBe('$["say \\"hi\\""]'));
});

// ========== Size and count formatting ==========
describe('size formatting', () => {
  it('formats bytes', () => expect(formatSize(500)).toBe('500 B'));
  it('formats KB', () => expect(formatSize(2048)).toBe('2.0 KB'));
  it('formats MB', () => expect(formatSize(1500000)).toBe('1.4 MB'));
  it('formats 0 bytes', () => expect(formatSize(0)).toBe('0 B'));
  it('formats 1024 bytes', () => expect(formatSize(1024)).toBe('1024 B'));
  it('formats 1025 bytes', () => expect(formatSize(1025)).toBe('1.0 KB'));
});

describe('number and count formatting', () => {
  it('groups thousands', () => expect(formatNumber(1234567)).toBe('1,234,567'));
  it('leaves small numbers alone', () => expect(formatNumber(999)).toBe('999'));
  it('one item', () => expect(formatCount('array', 1)).toBe('1 item'));
  it('many items', () => expect(formatCount('array', 60000)).toBe('60,000 items'));
  it('one key', () => expect(formatCount('object', 1)).toBe('1 key'));
  it('zero keys', () => expect(formatCount('object', 0)).toBe('0 keys'));
});

describe('UTF-8 length', () => {
  it('ASCII', () => expect(utf8Length('hello')).toBe(5));
  it('two-byte', () => expect(utf8Length('é')).toBe(2));
  it('three-byte', () => expect(utf8Length('日本')).toBe(6));
  it('surrogate pair is four bytes', () => expect(utf8Length('😀')).toBe(4));
  it('matches TextEncoder on mixed text', () => {
    const s = 'naïve café — 日本語 😀 {"a":1}';
    expect(utf8Length(s)).toBe(new TextEncoder().encode(s).length);
  });
});

describe('match count formatting', () => {
  it('zero', () => expect(formatMatchCount(0)).toBe('No matches'));
  it('one is singular', () => expect(formatMatchCount(1)).toBe('1 match'));
  it('two is plural', () => expect(formatMatchCount(2)).toBe('2 matches'));
  it('many', () => expect(formatMatchCount(1370)).toBe('1,370 matches'));
  it('shows the position of the selected match', () => expect(formatMatchCount(57, 2)).toBe('3 of 57'));
  it('marks a search that is still running', () => expect(formatMatchCount(120, -1, false)).toBe('120+ \u2026'));
  it('a running search with nothing yet', () => expect(formatMatchCount(0, -1, false)).toBe('0 \u2026'));
});

// ========== Settings ==========
describe('settings normalisation', () => {
  it('defaults when missing', () => expect(normalizeSettings(undefined)).toEqual({ enabled: true, theme: 'auto' }));
  it('keeps valid values', () => expect(normalizeSettings({ enabled: false, theme: 'dark' })).toEqual({ enabled: false, theme: 'dark' }));
  it('repairs a bad theme', () => expect(normalizeSettings({ enabled: true, theme: 'neon' }).theme).toBe('auto'));
  it('repairs a non-boolean enabled', () => expect(normalizeSettings({ enabled: 'yes' }).enabled).toBe(true));
});

// ========== Keyboard shortcuts ==========
describe('keyboard shortcuts', () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
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
  it('Cmd+G steps to the next match', () =>
    expect(resolveShortcut(key('g', { metaKey: true }), true)).toBe('next-match'));
  it('Shift+Ctrl+G steps to the previous match', () =>
    expect(resolveShortcut(key('G', { ctrlKey: true, shiftKey: true }), false)).toBe('prev-match'));
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
