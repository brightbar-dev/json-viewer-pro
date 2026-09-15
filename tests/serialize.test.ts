import { describe, it, expect } from 'vitest';
import { LosslessNumber } from '../lib/lossless';
import { stringifyJson } from '../lib/serialize';

describe('stringifyJson', () => {
  it('writes lossless numbers as their exact digits', () => {
    expect(stringifyJson({ id: new LosslessNumber('149883901923910003'), n: 1 })).toBe('{"id":149883901923910003,"n":1}');
  });
  it('a lossless root number', () => expect(stringifyJson(new LosslessNumber('12345678901234567890'))).toBe('12345678901234567890'));
  it('indents', () => expect(stringifyJson({ a: [new LosslessNumber('1e400')] }, 2)).toBe('{\n  "a": [\n    1e400\n  ]\n}'));
  it('cannot be fooled by a string that looks like the internal tag', () => {
    const out = stringifyJson({ s: '\u0000jvpabcdefgh:123', n: new LosslessNumber('9007199254740993') });
    expect(JSON.parse(out).s).toBe('\u0000jvpabcdefgh:123');
    expect(out).toContain('"n":9007199254740993');
  });
  it('output parses back to the same structure', () => {
    const v = { a: 'x', b: [1, true, null], c: { d: new LosslessNumber('0.1000000000000000055511151231257827') } };
    expect(JSON.parse(stringifyJson(v))).toEqual({ a: 'x', b: [1, true, null], c: { d: 0.1 } });
  });
  it('fast path without lossless numbers matches JSON.stringify', () => {
    const v = { a: [1, 2], b: 'c' };
    expect(stringifyJson(v, 2, false)).toBe(JSON.stringify(v, null, 2));
  });
});
