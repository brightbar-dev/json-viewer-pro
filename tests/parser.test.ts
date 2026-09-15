import { describe, it, expect } from 'vitest';
import { LosslessNumber } from '../lib/lossless';
import { errorExcerpt, lineColumn, parseText } from '../lib/parser';

const INVALID_FIXTURE = '{\n  "ok": true,\n  "items": [1, 2, 3,],\n  bad: "unquoted key"\n}\n';

function ok(text: string, opts = {}) {
  const r = parseText(text, opts);
  if (!r.ok) throw new Error(`expected success, got ${r.error.message}`);
  return r.value;
}
function fail(text: string, opts = {}) {
  const r = parseText(text, opts);
  if (r.ok) throw new Error('expected a syntax error');
  return r.error;
}

describe('parser: agrees with JSON.parse on valid JSON', () => {
  const docs = ['{}', '[]', '0', '-0', '1.5e3', '-2.25E-2', '"a\\u00e9\\n\\t\\"\\\\\\/"', 'true', 'false', 'null',
    '{"a":[1,{"b":null}],"c":"d"}', ' [1 , 2 ] ', '"\\ud83d\\ude00"', '{"a":1,"a":2}', '"naïve café 日本語"',
    '{"nested":{"deeper":{"deepest":[[[]]]}}}'];
  for (const d of docs) it(d, () => expect(ok(d)).toEqual(JSON.parse(d)));
});

describe('parser: safety', () => {
  it('defines __proto__ as an own property instead of setting the prototype', () => {
    const v = ok('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(Object.keys(v)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('handles nesting far deeper than the call stack', () => {
    const depth = 100000;
    const v = ok('['.repeat(depth) + ']'.repeat(depth));
    let d = 0;
    for (let x = v as unknown[]; Array.isArray(x) && x.length; x = x[0] as unknown[]) d++;
    expect(d).toBe(depth - 1);
  });
  it('skips a byte-order mark', () => expect(ok('\ufeff{"a":1}')).toEqual({ a: 1 }));
});

describe('parser: error messages and positions', () => {
  it('reports the trailing comma in the invalid fixture', () => {
    const e = fail(INVALID_FIXTURE);
    expect(e.message).toBe('Trailing comma is not allowed in JSON');
    expect([e.line, e.column]).toEqual([3, 20]);
    expect(INVALID_FIXTURE[e.offset]).toBe(',');
  });
  it('then the unquoted key, once trailing commas are allowed', () => {
    const e = fail(INVALID_FIXTURE, { trailingCommas: true });
    expect(e.message).toBe('Property names must be double-quoted strings');
    expect([e.line, e.column]).toEqual([4, 3]);
  });
  it('empty input', () => expect(fail('')).toMatchObject({ message: 'Unexpected end of input', offset: 0, line: 1, column: 1 }));
  it('truncated document', () => expect(fail('{"a": 1').message).toBe('Unexpected end of input'));
  it('missing colon', () => expect(fail('{"a" 1}')).toMatchObject({ message: "Expected ':' after property name", column: 6 }));
  it('missing comma in an array', () => {
    const e = fail('[1 2]');
    expect(e.message).toBe("Expected ',' or ']' after an array element but found character '2'");
    expect(e.column).toBe(4);
  });
  it('missing comma in an object', () => expect(fail('{"a":1 "b":2}').message).toMatch(/^Expected ',' or '}'/));
  it('unterminated string', () => expect(fail('"abc')).toMatchObject({ message: 'Unterminated string', offset: 0 }));
  it('bad escape', () => expect(fail('"a\\x"')).toMatchObject({ message: 'Invalid escape sequence \\x', offset: 2 }));
  it('bad unicode escape', () => expect(fail('"\\u12G4"').message).toMatch(/four hex digits/));
  it('raw line break in a string', () => expect(fail('"a\nb"').message).toMatch(/^Unterminated string/));
  it('raw control character in a string', () => expect(fail('"a\u0001b"').message).toBe('Control characters in strings must be escaped'));
  it('leading zero', () => expect(fail('[01]').message).toBe('Numbers cannot have leading zeros'));
  it('dangling decimal point', () => expect(fail('[1.]').message).toBe('Invalid number'));
  it('lone minus', () => expect(fail('[-]').message).toBe('Invalid number'));
  it('single-quoted key', () => expect(fail("{'a': 1}").message).toBe('Property names must use double quotes'));
  it('single-quoted string', () => expect(fail("['a']").message).toBe('Strings must use double quotes'));
  it('content after the value', () => expect(fail('{"a": 1} x')).toMatchObject({ message: 'Unexpected content after the JSON value', column: 10 }));
  it('NaN is not JSON', () => expect(fail('[NaN]').message).toBe("Unexpected character 'N'"));
  it('comments are not JSON', () => expect(fail('// c\n{}').message).toBe('Comments are not allowed in JSON'));
});

describe('parser: JSONC options', () => {
  it('accepts line and block comments', () => expect(ok('// head\n{ /* inner */ "a": 1 // tail\n}', { comments: true })).toEqual({ a: 1 }));
  it('reports an unterminated block comment', () => expect(fail('/* open', { comments: true }).message).toBe('Unterminated block comment'));
  it('accepts trailing commas', () => expect(ok('{"a": [1, 2,],}', { trailingCommas: true })).toEqual({ a: [1, 2] }));
  it('still rejects a lone comma', () => expect(fail('[,]', { trailingCommas: true }).message).toMatch(/^Unexpected/));
});

describe('parser: lossless numbers', () => {
  it('keeps imprecise numbers as their source and counts them', () => {
    const r = parseText('[149883901923910003, 1.5, 12345678901234567000, 0.1000000000000000055511151231257827]', { lossless: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [a, b, c, d] = r.value as unknown[];
    expect(a).toBeInstanceOf(LosslessNumber);
    expect((a as LosslessNumber).source).toBe('149883901923910003');
    expect(b).toBe(1.5);
    expect(c).toBe(12345678901234567000);
    expect((d as LosslessNumber).source).toBe('0.1000000000000000055511151231257827');
    expect(r.preserved).toBe(2);
  });
  it('without the option, numbers are plain', () => expect(ok('[149883901923910003]')).toEqual([149883901923910000]));
});

describe('lineColumn', () => {
  it('first line', () => expect(lineColumn('abc', 1)).toEqual({ line: 1, column: 2 }));
  it('on a line break', () => expect(lineColumn('a\nbc\nd', 4)).toEqual({ line: 2, column: 3 }));
  it('start of a later line', () => expect(lineColumn('a\nbc\nd', 5)).toEqual({ line: 3, column: 1 }));
});

describe('errorExcerpt', () => {
  const text = 'l1\nl2\nl3 bad\nl4\nl5\nl6';
  it('shows context lines around the error and marks the character', () => {
    const lines = errorExcerpt(text, text.indexOf('bad'));
    expect(lines.map((l) => l.number)).toEqual([1, 2, 3, 4, 5]);
    const err = lines.find((l) => l.isErrorLine)!;
    expect([err.before, err.mark, err.after]).toEqual(['l3 ', 'b', 'ad']);
  });
  it('an error at the end of input has no character to mark', () => {
    const lines = errorExcerpt('{"a":', 5);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ before: '{"a":', mark: '', after: '', isErrorLine: true });
  });
  it('includes an empty first line as context', () => {
    expect(errorExcerpt('\n{x}', 2).map((l) => l.number)).toEqual([1, 2]);
  });
  it('clips a very long line to a window around the error', () => {
    const long = 'x'.repeat(1000) + 'Y' + 'z'.repeat(1000);
    const [line] = errorExcerpt(long, 1000, 2, 120);
    expect(line!.mark).toBe('Y');
    expect(line!.before.startsWith('\u2026')).toBe(true);
    expect(line!.after.endsWith('\u2026')).toBe(true);
    expect(line!.before.length + line!.after.length).toBeLessThanOrEqual(123);
  });
});
