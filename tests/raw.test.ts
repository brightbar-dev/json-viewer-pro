import { describe, it, expect } from 'vitest';
import { chunkLines, estimateLines, splitChunks } from '../lib/raw';

describe('splitChunks', () => {
  it('leaves short text whole', () => expect(splitChunks('{"a":1}', 100)).toEqual(['{"a":1}']));

  it('always joins back to the original text', () => {
    const samples = [
      JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ id: i, t: 'x'.repeat(i % 13) }))),
      JSON.stringify(Array.from({ length: 800 }, (_, i) => ({ id: i })), null, 2),
      'a'.repeat(12345),
      '😀'.repeat(3000),
    ];
    for (const s of samples) expect(splitChunks(s, 1000).join('')).toBe(s);
  });

  it('prefers to cut just after a line break', () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    for (const chunk of splitChunks(text, 100).slice(0, -1)) expect(chunk.endsWith('\n')).toBe(true);
  });

  it('cuts minified JSON just after a comma', () => {
    const text = JSON.stringify(Array.from({ length: 2000 }, (_, i) => i));
    for (const chunk of splitChunks(text, 500).slice(0, -1)) expect(chunk.endsWith(',')).toBe(true);
  });

  it('never splits a surrogate pair', () => {
    const chunks = splitChunks('😀'.repeat(3000), 1001);
    for (const chunk of chunks) {
      const last = chunk.charCodeAt(chunk.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });

  it('keeps chunks near the requested size', () => {
    const chunks = splitChunks('x'.repeat(10000), 1000);
    expect(chunks).toHaveLength(10);
    expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(1001);
  });
});

describe('estimateLines', () => {
  it('a short line', () => expect(estimateLines('abc', 10)).toBe(1));
  it('wraps a long line', () => expect(estimateLines('a'.repeat(25), 10)).toBe(3));
  it('counts line breaks', () => expect(estimateLines('ab\ncd', 10)).toBe(2));
  it('empty text is one line', () => expect(estimateLines('', 10)).toBe(1));
  it('a trailing line break adds no line', () => expect(estimateLines('a\n', 10)).toBe(1));
  it('blank lines count', () => expect(estimateLines('\n\n', 10)).toBe(2));
});

describe('chunkLines', () => {
  it('numbers lines across chunks', () => {
    expect(chunkLines(['a\nb\n', 'c\nd', 'e\nf'])).toEqual([
      { firstLine: 1, continues: false },
      { firstLine: 3, continues: false },
      { firstLine: 4, continues: true },
    ]);
  });
  it('agrees with splitChunks on a real document', () => {
    const text = JSON.stringify(Array.from({ length: 300 }, (_, i) => ({ i })), null, 2);
    const chunks = splitChunks(text, 500);
    const lines = chunkLines(chunks);
    const last = chunks.length - 1;
    const total = lines[last]!.firstLine + (chunks[last]!.match(/\n/g)?.length ?? 0);
    expect(total).toBe(text.split('\n').length);
  });
});
