import { describe, it, expect } from 'vitest';
import { analyze, classifyContentType, mightBeJson, unwrap, type JsonDoc, type ErrorDoc } from '../lib/document';
import { LosslessNumber } from '../lib/lossless';

describe('classifyContentType', () => {
  const cases: [string | undefined, string | null][] = [
    ['application/json', 'json'], ['application/json; charset=utf-8', 'json'], ['APPLICATION/JSON', 'json'],
    ['text/json', 'json'], ['application/problem+json', 'json'], ['application/ld+json', 'json'],
    ['application/vnd.api+json', 'json'], ['application/x-amz-json-1.1', 'json'],
    ['application/x-ndjson', 'ndjson'], ['application/jsonl', 'ndjson'],
    ['text/plain', 'text'], ['text/javascript', 'text'], ['application/javascript', 'text'],
    ['text/html', null], ['image/png', null], ['text/css', null], ['application/xml', null], ['', null], [undefined, null],
  ];
  for (const [ct, want] of cases) it(`${ct} → ${want}`, () => expect(classifyContentType(ct)).toBe(want));
});

describe('unwrap', () => {
  it('plain JSON is returned untouched (same string)', () => {
    const raw = '{"a":1}';
    const u = unwrap(raw);
    expect(u.text).toBe(raw);
    expect([u.start, u.jsonp, u.prefix]).toEqual([0, null, null]);
  });
  it('simple JSONP', () => expect(unwrap('cb({"a":1});')).toMatchObject({ text: '{"a":1}', jsonp: 'cb', start: 3 }));
  it('Google-style guarded JSONP', () =>
    expect(unwrap('/**/ typeof handleData === "function" && handleData({"x":1});')).toMatchObject({ text: '{"x":1}', jsonp: 'handleData' }));
  it('jQuery-style callback names', () => expect(unwrap('jQuery3310_1600000000({"a":1})').jsonp).toBe('jQuery3310_1600000000'));
  it('dotted callback names', () => expect(unwrap('a.b.c([1])')).toMatchObject({ text: '[1]', jsonp: 'a.b.c' }));
  it('XSSI prefix )]}\'', () => expect(unwrap(")]}'\n{\"a\":1}")).toMatchObject({ prefix: ")]}'", text: '\n{"a":1}' }));
  it("XSSI prefix )]}',", () => expect(unwrap(")]}',\n[1]").prefix).toBe(")]}',"));
  it('while(1); prefix', () => expect(unwrap('while(1);{"a":1}')).toMatchObject({ prefix: 'while(1);', text: '{"a":1}' }));
  it('for(;;); prefix', () => expect(unwrap('for(;;);[1]').prefix).toBe('for(;;);'));
  it('a literal is not a callback', () => expect(unwrap('true').jsonp).toBeNull());
  it('an unclosed call is not JSONP', () => expect(unwrap('foo({"a":1}').jsonp).toBeNull());
});

describe('mightBeJson', () => {
  it('object', () => expect(mightBeJson('  {"a"')).toBe(true));
  it('array', () => expect(mightBeJson('[')).toBe(true));
  it('JSONP', () => expect(mightBeJson('cb({')).toBe(true));
  it('XSSI', () => expect(mightBeJson(")]}'\n")).toBe(true));
  it('prose', () => expect(mightBeJson('hello world')).toBe(false));
  it('a log file', () => expect(mightBeJson('2026-09-15 03:00:00 INFO started')).toBe(false));
  it('JavaScript source', () => expect(mightBeJson('function hello() {')).toBe(false));
  it('empty', () => expect(mightBeJson('')).toBe(false));
});

const json = (d: ReturnType<typeof analyze>) => d as JsonDoc;
const error = (d: ReturnType<typeof analyze>) => d as ErrorDoc;

describe('analyze', () => {
  it('declared JSON', () => expect(json(analyze('{"a":1}', 'json'))).toMatchObject({ kind: 'json', format: 'json', value: { a: 1 }, preserved: 0 }));
  it('JSON served as text', () => expect(json(analyze('{"a":1}', 'text')).value).toEqual({ a: 1 }));
  it('a top-level scalar is fine when declared JSON', () => expect(json(analyze('42', 'json')).value).toBe(42));
  it('but a scalar served as text is left alone', () => expect(analyze('42', 'text')).toBeNull());
  it('prose served as text is left alone', () => expect(analyze('hello', 'text')).toBeNull());
  it('JavaScript served as text is left alone', () => expect(analyze('[1,2].forEach(x => x)', 'text')).toBeNull());
  it('braces in a text file are left alone', () => expect(analyze('{not json}\n{also not}', 'text')).toBeNull());
  it('empty declared JSON gets the empty state', () => expect(analyze('', 'json')).toEqual({ kind: 'empty', raw: '' }));
  it('whitespace-only declared JSON gets the empty state', () => expect(analyze('  \n', 'json')!.kind).toBe('empty'));
  it('empty text is left alone', () => expect(analyze('', 'text')).toBeNull());

  it('unwraps JSONP and names the callback', () => {
    const d = json(analyze('cb({"a": 1});', 'text'));
    expect(d).toMatchObject({ kind: 'json', jsonp: 'cb', value: { a: 1 }, raw: 'cb({"a": 1});' });
  });
  it('strips an XSSI guard', () => expect(json(analyze(")]}'\n{\"a\": 1}", 'json'))).toMatchObject({ prefix: ")]}'", value: { a: 1 } }));

  it('NDJSON served as text becomes an array of lines', () => {
    expect(json(analyze('{"a":1}\n{"a":2}\n', 'text'))).toMatchObject({ format: 'ndjson', value: [{ a: 1 }, { a: 2 }] });
  });
  it('NDJSON with CRLF line endings', () => expect(json(analyze('{"a":1}\r\n{"a":2}\r\n', 'json')).value).toEqual([{ a: 1 }, { a: 2 }]));
  it('declared NDJSON with a single line', () => expect(json(analyze('{"a":1}', 'ndjson'))).toMatchObject({ format: 'ndjson', value: [{ a: 1 }] }));
  it('declared NDJSON reports the bad line', () => {
    const d = error(analyze('{"a":1}\n{bad}\n', 'ndjson'));
    expect(d).toMatchObject({ kind: 'error', format: 'ndjson' });
    expect([d.error.line, d.error.column]).toEqual([2, 2]);
  });

  it('invalid declared JSON gets an error with position in the raw body', () => {
    const raw = '{\n  "ok": true,\n  "items": [1, 2, 3,],\n  bad: "unquoted key"\n}\n';
    const d = error(analyze(raw, 'json'));
    expect(d.kind).toBe('error');
    expect(d.error).toMatchObject({ line: 3, column: 20, message: 'Trailing comma is not allowed in JSON' });
  });
  it('an error inside JSONP is positioned in the raw body, not the unwrapped text', () => {
    const raw = 'cb({"a": 1,});';
    const d = error(analyze(raw, 'json'));
    expect(raw[d.error.offset]).toBe(',');
    expect(d.error.column).toBe(d.error.offset + 1);
  });
  it('invalid JSON served as text is left alone', () => expect(analyze('{"a": 1,}', 'text')).toBeNull());

  it('keeps big integers exact', () => {
    const d = json(analyze('{"id": 149883901923910003, "n": 1}', 'json'));
    const v = d.value as { id: LosslessNumber; n: number };
    expect(v.id).toBeInstanceOf(LosslessNumber);
    expect(v.id.source).toBe('149883901923910003');
    expect(v.n).toBe(1);
    expect(d.preserved).toBe(1);
  });

  it('JSONC when asked', () => {
    expect(json(analyze('{\n // c\n "a": [1,],\n}', 'json', { jsonc: true }))).toMatchObject({ format: 'jsonc', value: { a: [1] } });
  });
  it('but not by default', () => expect(analyze('{\n // c\n "a": 1\n}', 'json')!.kind).toBe('error'));
});
