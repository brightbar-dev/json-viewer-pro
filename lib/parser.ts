/**
 * A hand-written JSON parser. The fast path everywhere is native `JSON.parse`;
 * this one exists for what native parsing cannot do:
 *
 * - report WHERE a document is invalid, with a readable message, line and column;
 * - keep imprecise numbers lossless on engines without reviver `context.source`;
 * - accept JSONC (comments and trailing commas) when asked to.
 *
 * It is iterative, so nesting depth is bounded by memory rather than the stack,
 * and it never uses `eval` or `Function`.
 */
import { LosslessNumber, losesPrecision } from './lossless';

export interface ParseOptions {
  /** Allow `// line` and `/* block *\/` comments (JSONC). */
  comments?: boolean;
  /** Allow a trailing comma before `]` or `}` (JSONC). */
  trailingCommas?: boolean;
  /** Keep numbers that would lose precision as `LosslessNumber`. */
  lossless?: boolean;
}

export interface JsonSyntaxError {
  message: string;
  /** UTF-16 offset of the offending character (or of the end of input). */
  offset: number;
  /** 1-based. */
  line: number;
  /** 1-based, in UTF-16 code units. */
  column: number;
}

export type ParseResult =
  | { ok: true; value: unknown; preserved: number }
  | { ok: false; error: JsonSyntaxError };

class Fail {
  constructor(
    readonly message: string,
    readonly offset: number,
  ) {}
}

/** 1-based line and column of `offset` in `text`. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastBreak = -1;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    lastBreak = i;
  }
  return { line, column: offset - lastBreak };
}

function describeAt(text: string, at: number): string {
  if (at >= text.length) return 'end of input';
  const cp = text.codePointAt(at)!;
  const ch = String.fromCodePoint(cp);
  if (cp < 32) return `control character U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  return `character '${ch}'`;
}

function setProperty(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    // Plain assignment would call the prototype setter. JSON.parse defines an
    // own property instead, and so must we.
    Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
  } else {
    obj[key] = value;
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const HEX4 = /^[0-9a-fA-F]{4}$/;

interface Frame {
  arr: unknown[] | null;
  obj: Record<string, unknown> | null;
  key: string;
}

export function parseText(text: string, opts: ParseOptions = {}): ParseResult {
  const n = text.length;
  const allowComments = !!opts.comments;
  const allowTrailing = !!opts.trailingCommas;
  const lossless = !!opts.lossless;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let preserved = 0;

  function ws(): void {
    for (;;) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 10 || c === 13 || c === 9) {
        i++;
      } else if (c === 47) {
        const d = text.charCodeAt(i + 1);
        if (d !== 47 && d !== 42) return;
        if (!allowComments) throw new Fail('Comments are not allowed in JSON', i);
        if (d === 47) {
          const end = text.indexOf('\n', i + 2);
          i = end === -1 ? n : end + 1;
        } else {
          const end = text.indexOf('*/', i + 2);
          if (end === -1) throw new Fail('Unterminated block comment', i);
          i = end + 2;
        }
      } else {
        return;
      }
    }
  }

  function readString(): string {
    const open = i;
    i++;
    let out = '';
    let chunk = i;
    for (;;) {
      if (i >= n) throw new Fail('Unterminated string', open);
      const c = text.charCodeAt(i);
      if (c === 34) {
        out += text.slice(chunk, i);
        i++;
        return out;
      }
      if (c === 92) {
        out += text.slice(chunk, i);
        const e = text.charCodeAt(i + 1);
        switch (e) {
          case 34: out += '"'; break;
          case 92: out += '\\'; break;
          case 47: out += '/'; break;
          case 98: out += '\b'; break;
          case 102: out += '\f'; break;
          case 110: out += '\n'; break;
          case 114: out += '\r'; break;
          case 116: out += '\t'; break;
          case 117: {
            const hex = text.slice(i + 2, i + 6);
            if (!HEX4.test(hex)) throw new Fail('Invalid \\u escape: expected four hex digits', i);
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            if (i + 1 >= n) throw new Fail('Unterminated string', open);
            throw new Fail(`Invalid escape sequence \\${text[i + 1]}`, i);
        }
        i += 2;
        chunk = i;
        continue;
      }
      if (c < 32) {
        throw new Fail(
          c === 10 || c === 13
            ? 'Unterminated string (a line break must be escaped as \\n)'
            : 'Control characters in strings must be escaped',
          i,
        );
      }
      i++;
    }
  }

  function readNumber(): unknown {
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (!m) throw new Fail('Invalid number', i);
    const src = m[0];
    const end = i + src.length;
    const next = text.charCodeAt(end);
    if ((next >= 48 && next <= 57) || next === 46 || next === 101 || next === 69) {
      throw new Fail(src === '0' || src === '-0' ? 'Numbers cannot have leading zeros' : 'Invalid number', i);
    }
    i = end;
    if (lossless && losesPrecision(src)) {
      preserved++;
      return new LosslessNumber(src);
    }
    return Number(src);
  }

  function unexpected(): Fail {
    if (i >= n) return new Fail('Unexpected end of input', i);
    const c = text.charCodeAt(i);
    if (c === 39) return new Fail('Strings must use double quotes', i);
    return new Fail(`Unexpected ${describeAt(text, i)}`, i);
  }

  function readPrimitive(): unknown {
    const c = text.charCodeAt(i);
    if (c === 34) return readString();
    if (c === 45 || (c >= 48 && c <= 57)) return readNumber();
    if (c === 116 && text.startsWith('true', i)) { i += 4; return true; }
    if (c === 102 && text.startsWith('false', i)) { i += 5; return false; }
    if (c === 110 && text.startsWith('null', i)) { i += 4; return null; }
    throw unexpected();
  }

  function readKey(): string {
    const c = text.charCodeAt(i);
    if (c === 34) {
      const key = readString();
      ws();
      if (text.charCodeAt(i) !== 58) {
        throw i >= n ? new Fail('Unexpected end of input', i) : new Fail("Expected ':' after property name", i);
      }
      i++;
      return key;
    }
    if (i >= n) throw new Fail('Unexpected end of input', i);
    if (c === 39) throw new Fail('Property names must use double quotes', i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36) {
      throw new Fail('Property names must be double-quoted strings', i);
    }
    throw new Fail(`Expected a property name but found ${describeAt(text, i)}`, i);
  }

  function parse(): unknown {
    const stack: Frame[] = [];
    let value: unknown;
    for (;;) {
      ws();
      const c = text.charCodeAt(i);
      if (c === 123) {
        i++;
        ws();
        const obj: Record<string, unknown> = {};
        if (text.charCodeAt(i) === 125) {
          i++;
          value = obj;
        } else {
          stack.push({ arr: null, obj, key: readKey() });
          continue;
        }
      } else if (c === 91) {
        i++;
        ws();
        const arr: unknown[] = [];
        if (text.charCodeAt(i) === 93) {
          i++;
          value = arr;
        } else {
          stack.push({ arr, obj: null, key: '' });
          continue;
        }
      } else {
        value = readPrimitive();
      }

      // Attach the finished value to its parent, closing containers as we go.
      for (;;) {
        const top = stack[stack.length - 1];
        if (!top) {
          ws();
          if (i < n) throw new Fail('Unexpected content after the JSON value', i);
          return value;
        }
        if (top.arr) top.arr.push(value);
        else setProperty(top.obj!, top.key, value);

        ws();
        const d = text.charCodeAt(i);
        const close = top.arr ? 93 : 125;
        if (d === 44) {
          const comma = i;
          i++;
          ws();
          if (text.charCodeAt(i) === close) {
            if (!allowTrailing) throw new Fail('Trailing comma is not allowed in JSON', comma);
            i++;
            value = top.arr ?? top.obj;
            stack.pop();
            continue;
          }
          if (!top.arr) top.key = readKey();
          break;
        }
        if (d === close) {
          i++;
          value = top.arr ?? top.obj;
          stack.pop();
          continue;
        }
        if (i >= n) throw new Fail('Unexpected end of input', i);
        throw new Fail(
          top.arr
            ? `Expected ',' or ']' after an array element but found ${describeAt(text, i)}`
            : `Expected ',' or '}' after a property value but found ${describeAt(text, i)}`,
          i,
        );
      }
    }
  }

  try {
    const value = parse();
    return { ok: true, value, preserved };
  } catch (e) {
    if (e instanceof Fail) {
      const { line, column } = lineColumn(text, e.offset);
      return { ok: false, error: { message: e.message, offset: e.offset, line, column } };
    }
    throw e;
  }
}

export interface ExcerptLine {
  /** 1-based line number. */
  number: number;
  /** Text before the highlighted character (possibly clipped, with a leading ellipsis). */
  before: string;
  /** The offending character; '' when the error is at the end of a line or of input. */
  mark: string;
  after: string;
  isErrorLine: boolean;
}

/**
 * Lines around `offset` for an error excerpt. Long lines (a minified document
 * is one line) are clipped to a window of `width` characters around the error.
 */
export function errorExcerpt(text: string, offset: number, context = 2, width = 120): ExcerptLine[] {
  const at = Math.max(0, Math.min(offset, text.length));
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  const col = at - lineStart;
  const winStart = Math.max(0, col - Math.floor(width / 2));

  const clip = (line: string): [string, number] => {
    const clean = line.endsWith('\r') ? line.slice(0, -1) : line;
    const head = winStart > 0 ? '…' : '';
    const body = clean.slice(winStart, winStart + width);
    const tail = clean.length > winStart + width ? '…' : '';
    return [head + body + tail, head.length];
  };

  // Walk back `context` lines.
  let first = lineStart;
  for (let k = 0; k < context && first > 0; k++) first = first >= 2 ? text.lastIndexOf('\n', first - 2) + 1 : 0;
  const { line: firstNumber } = lineColumn(text, first);

  const out: ExcerptLine[] = [];
  let pos = first;
  let number = firstNumber;
  let after = 0;
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(pos, end);
    if (pos === lineStart) {
      const [clipped, headLen] = clip(line);
      const markAt = headLen + (col - winStart);
      const hasChar = at < end && text[at] !== '\r';
      out.push({
        number,
        before: clipped.slice(0, markAt),
        mark: hasChar ? clipped.slice(markAt, markAt + 1) : '',
        after: clipped.slice(markAt + (hasChar ? 1 : 0)),
        isErrorLine: true,
      });
    } else {
      out.push({ number, before: clip(line)[0], mark: '', after: '', isErrorLine: false });
      if (pos > lineStart && ++after >= context) break;
    }
    if (nl === -1) break;
    pos = nl + 1;
    number++;
  }
  return out;
}
