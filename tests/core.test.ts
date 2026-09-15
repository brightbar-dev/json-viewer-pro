import { describe, it, expect } from 'vitest';
import {
  downloadName, formatCount, formatMatchCount, formatNumber, formatSize, formatUtc, isHexColor, isImageUrl, isUrl, relativeTime,
  timestampMillis, utf8Length,
} from '../lib/format';
import { DEFAULT_MONOSPACE, DEFAULT_SETTINGS, fontStack, normalizeSettings, rowHeightFor } from '../lib/settings';
import { resolveShortcut, resolveTreeKey } from '../lib/shortcuts';
import { formatJsonPointer, formatJsPath, formatPath } from '../lib/tree';

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

describe('JS path and JSON Pointer', () => {
  it('JS path of the root is empty', () => expect(formatJsPath([])).toBe(''));
  it('JS path starts without a dot', () => expect(formatJsPath(['data', 3, 'email'])).toBe('data[3].email'));
  it('JS path for a root array', () => expect(formatJsPath([3, 'email'])).toBe('[3].email'));
  it('JS path quotes non-identifiers', () => expect(formatJsPath(['full name', 'x-y'])).toBe('["full name"]["x-y"]'));
  it('JSON Pointer', () => expect(formatJsonPointer(['data', 3, 'email'])).toBe('/data/3/email'));
  it('JSON Pointer escapes ~ and /', () => expect(formatJsonPointer(['a/b', 'm~n'])).toBe('/a~1b/m~0n'));
  it('JSON Pointer of the root is empty', () => expect(formatJsonPointer([])).toBe(''));
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
  it('defaults when missing', () => expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS));
  it('fills new fields for settings saved by an older version', () =>
    expect(normalizeSettings({ enabled: false, theme: 'dark' })).toEqual({ ...DEFAULT_SETTINGS, enabled: false, theme: 'dark' }));
  it('keeps valid values', () => {
    const s = { enabled: true, theme: 'light', fontFamily: 'JetBrains Mono', fontSize: 15, indent: 24, expandBudget: 5000, imagePreview: false };
    expect(normalizeSettings(s)).toEqual(s);
  });
  it('repairs a bad theme', () => expect(normalizeSettings({ enabled: true, theme: 'neon' }).theme).toBe('auto'));
  it('repairs a non-boolean enabled', () => expect(normalizeSettings({ enabled: 'yes' }).enabled).toBe(true));
  it('clamps numbers into range', () => {
    expect(normalizeSettings({ fontSize: 400, indent: -3, expandBudget: 1e9 })).toMatchObject({ fontSize: 24, indent: 8, expandBudget: 100000 });
  });
  it('rounds fractional numbers', () => expect(normalizeSettings({ fontSize: 13.6 }).fontSize).toBe(14));
  it('rejects a font family that is not a font list', () => {
    expect(normalizeSettings({ fontFamily: 'Fira Code; } body { display: none' }).fontFamily).toBe('');
    expect(normalizeSettings({ fontFamily: '"Cascadia Code", Consolas' }).fontFamily).toBe('"Cascadia Code", Consolas');
  });
  it('font stack falls back to the default monospace list', () => {
    expect(fontStack('')).toBe(DEFAULT_MONOSPACE);
    expect(fontStack('Fira Code')).toBe(`Fira Code, ${DEFAULT_MONOSPACE}`);
  });
  it('row height follows font size', () => expect([11, 13, 16, 20].map(rowHeightFor)).toEqual([17, 20, 25, 31]));
});

describe('value affordances', () => {
  it('hex colours', () => {
    expect(['#fff', '#FFFF', '#0a0b0c', '#0a0b0cdd'].map(isHexColor)).toEqual([true, true, true, true]);
    expect(['fff', '#ggg', '#12345', '#1234567', 'red'].map(isHexColor)).toEqual([false, false, false, false, false]);
  });
  it('image URLs', () => {
    expect(isImageUrl('https://picsum.photos/seed/0/64.png')).toBe(true);
    expect(isImageUrl('https://cdn.example.com/a/b.JPG?w=64#x')).toBe(true);
    expect(isImageUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isImageUrl('https://example.com/u/1')).toBe(false);
    expect(isImageUrl('javascript:alert(1)//.png')).toBe(false);
    expect(isImageUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
  });
  it('ISO-8601 strings are timestamps', () => {
    expect(timestampMillis('anything', '2023-11-14T22:13:20.000Z')).toBe(Date.UTC(2023, 10, 14, 22, 13, 20));
    expect(timestampMillis(null, '2023-11-14')).toBe(Date.UTC(2023, 10, 14));
    expect(timestampMillis('t', '2023-11-14 22:13:20+00:00')).toBe(Date.UTC(2023, 10, 14, 22, 13, 20));
    expect(timestampMillis('t', 'not a date 2023-11-14')).toBeNull();
    expect(timestampMillis('t', '2023-13-45')).toBeNull();
  });
  it('epoch numbers need a time-like key', () => {
    expect(timestampMillis('createdAt', 1700000000)).toBe(1700000000000);
    expect(timestampMillis('updated_at', 1700000000123)).toBe(1700000000123);
    expect(timestampMillis('exp', 1700000000)).toBe(1700000000000);
    expect(timestampMillis('timestamp', 1700000000)).toBe(1700000000000);
    expect(timestampMillis('id', 1700000000)).toBeNull();
    expect(timestampMillis('format', 1700000000)).toBeNull();
    expect(timestampMillis(3, 1700000000)).toBeNull();
    expect(timestampMillis('createdAt', 17)).toBeNull();
    expect(timestampMillis('createdAt', 1700000000.5)).toBeNull();
  });
  it('formats UTC', () => {
    expect(formatUtc(Date.UTC(2023, 10, 14, 22, 13, 20))).toBe('2023-11-14 22:13:20 UTC');
    expect(formatUtc(Date.UTC(2023, 10, 14, 22, 13, 20, 5))).toBe('2023-11-14 22:13:20.005 UTC');
  });
  it('relative time', () => {
    const now = Date.UTC(2026, 8, 15);
    expect(relativeTime(now - 10_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(relativeTime(now + 3 * 3600_000, now)).toBe('in 3 hours');
    expect(relativeTime(now - 2 * 86400_000, now)).toBe('2 days ago');
    expect(relativeTime(now - 400 * 86400_000, now)).toBe('1 year ago');
  });
  it('download names', () => {
    expect(downloadName('https://api.example.com/v1/users.json?page=2')).toBe('users.json');
    expect(downloadName('https://api.example.com/v1/users')).toBe('users.json');
    expect(downloadName('https://api.example.com/')).toBe('response.json');
    expect(downloadName('https://x.test/a%20b%2Fc.ndjson')).toBe('a_b_c.json');
    expect(downloadName('not a url')).toBe('response.json');
  });
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
  it('digits 1-3 show that many levels', () =>
    expect(['1', '2', '3'].map((k) => resolveShortcut(key(k), false))).toEqual(['level-1', 'level-2', 'level-3']));
  it('digits are ignored while typing', () => expect(resolveShortcut(key('2'), true)).toBeNull());
  it('4 is not a level', () => expect(resolveShortcut(key('4'), false)).toBeNull());
});

describe('tree keys', () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
    ({ key: k, ctrlKey: false, metaKey: false, ...mods });
  it('arrows', () =>
    expect(['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].map((k) => resolveTreeKey(key(k)))).toEqual(['down', 'up', 'right', 'left']));
  it('Home, End, PageUp, PageDown', () =>
    expect(['Home', 'End', 'PageUp', 'PageDown'].map((k) => resolveTreeKey(key(k)))).toEqual(['home', 'end', 'page-up', 'page-down']));
  it('Enter and Space toggle', () => expect([resolveTreeKey(key('Enter')), resolveTreeKey(key(' '))]).toEqual(['toggle', 'toggle']));
  it('* expands the subtree', () => expect(resolveTreeKey(key('*', { shiftKey: true }))).toBe('expand-subtree'));
  it('Cmd+C copies the value, Cmd+Shift+C the path', () => {
    expect(resolveTreeKey(key('c', { metaKey: true }))).toBe('copy-value');
    expect(resolveTreeKey(key('C', { ctrlKey: true, shiftKey: true }))).toBe('copy-path');
  });
  it('the context-menu key and Shift+F10 open the menu', () => {
    expect(resolveTreeKey(key('ContextMenu'))).toBe('menu');
    expect(resolveTreeKey(key('F10', { shiftKey: true }))).toBe('menu');
  });
  it('modified arrows are left to the browser', () => expect(resolveTreeKey(key('ArrowDown', { altKey: true }))).toBeNull());
  it('letters are not tree keys', () => expect(resolveTreeKey(key('a'))).toBeNull());
});
