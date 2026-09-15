/**
 * Deciding what a response body is, and parsing it exactly once.
 *
 * Everything here is pure (no DOM) so it is unit-tested directly. The content
 * script supplies `document.contentType` and the body text; the viewer page
 * supplies pasted or opened text.
 */
import { hasImpreciseNumbers, parseWithSource } from './lossless';
import { lineColumn, parseText, type JsonSyntaxError } from './parser';

/**
 * - `json`   — declared JSON: always rendered, as a tree or as an error view.
 * - `text`   — plain text or JavaScript: rendered only if the body really is JSON.
 * - `ndjson` — declared newline-delimited JSON.
 */
export type ContentClass = 'json' | 'text' | 'ndjson';

const TEXT_TYPES = new Set([
  'text/plain',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'text/ecmascript',
  'application/ecmascript',
]);

const NDJSON_TYPES = new Set([
  'application/x-ndjson',
  'application/ndjson',
  'application/jsonl',
  'application/x-jsonl',
  'application/jsonlines',
  'application/x-jsonlines',
]);

export function classifyContentType(contentType: string | null | undefined): ContentClass | null {
  if (!contentType || contentType === 'text/html') return null;
  const t = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  if (NDJSON_TYPES.has(t)) return 'ndjson';
  if (t === 'text/json' || t === 'text/x-json') return 'json';
  // application/json, application/*+json (ld+json, problem+json, vnd.api+json…),
  // application/x-amz-json-1.1 and friends.
  if (t.startsWith('application/') && t.includes('json')) return 'json';
  if (TEXT_TYPES.has(t)) return 'text';
  return null;
}

export interface Unwrapped {
  /** The JSON text inside any wrapper. */
  text: string;
  /** Offset of `text` within the raw body. */
  start: number;
  /** JSONP callback name, e.g. `handleData`. */
  jsonp: string | null;
  /** Anti-XSSI guard that was stripped, e.g. `)]}'`. */
  prefix: string | null;
}

const XSSI_PREFIX = /^\s*(\)\]\}'?,?|while\s*\(\s*1\s*\)\s*;|for\s*\(\s*;\s*;\s*\)\s*;)/;
const JSONP_HEAD =
  /^\s*(?:\/\*\*\/\s*)?(?:typeof\s+[A-Za-z_$][\w$.]*\s*===?\s*(['"])function\1\s*&&\s*)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/;

function isWs(c: number): boolean {
  return c === 32 || c === 10 || c === 13 || c === 9 || c === 0xfeff;
}

function firstNonWs(text: string, from = 0): number {
  let i = from;
  while (i < text.length && isWs(text.charCodeAt(i))) i++;
  return i;
}

/** Strip an anti-XSSI guard prefix and/or a JSONP `callback( … )` wrapper. */
export function unwrap(raw: string): Unwrapped {
  let start = 0;
  let end = raw.length;
  let prefix: string | null = null;
  let jsonp: string | null = null;

  const guard = XSSI_PREFIX.exec(raw.slice(0, 64));
  if (guard) {
    prefix = guard[1]!.replace(/\s+/g, '');
    start = guard[0].length;
  }

  const first = raw.charCodeAt(firstNonWs(raw, start));
  const identStart = (first >= 65 && first <= 90) || (first >= 97 && first <= 122) || first === 95 || first === 36;
  if (identStart || first === 47) {
    const head = JSONP_HEAD.exec(raw.slice(start, start + 512));
    if (head) {
      let e = end;
      while (e > start && isWs(raw.charCodeAt(e - 1))) e--;
      if (raw.charCodeAt(e - 1) === 59) e--; // ;
      while (e > start && isWs(raw.charCodeAt(e - 1))) e--;
      const name = head[2]!;
      if (raw.charCodeAt(e - 1) === 41 && name !== 'true' && name !== 'false' && name !== 'null') {
        jsonp = name;
        start += head[0].length;
        end = e - 1;
      }
    }
  }

  const text = start === 0 && end === raw.length ? raw : raw.slice(start, end);
  return { text, start, jsonp, prefix };
}

/**
 * Could a body starting with `head` be JSON (possibly wrapped)? Lets the
 * content script reject a large plain-text page from its first kilobyte
 * instead of reading the whole body.
 */
export function mightBeJson(head: string): boolean {
  const i = firstNonWs(head);
  if (i >= head.length) return false;
  const c = head.charCodeAt(i);
  if (c === 123 || c === 91) return true;
  return XSSI_PREFIX.test(head.slice(0, 64)) || JSONP_HEAD.test(head.slice(0, 512));
}

export type DocFormat = 'json' | 'ndjson' | 'jsonc';

export interface JsonDoc {
  kind: 'json';
  format: DocFormat;
  value: unknown;
  /** The untouched body, for the Raw view. */
  raw: string;
  /** How many numbers were kept as `LosslessNumber`. */
  preserved: number;
  jsonp: string | null;
  prefix: string | null;
}

export interface ErrorDoc {
  kind: 'error';
  format: DocFormat;
  raw: string;
  /** Offset, line and column are positions in `raw`. */
  error: JsonSyntaxError;
}

export interface EmptyDoc {
  kind: 'empty';
  raw: string;
}

export type ViewerDoc = JsonDoc | ErrorDoc | EmptyDoc;

/**
 * Parse once, as fast as possible: native `JSON.parse`, switching to a
 * lossless parse only when a cheap scan finds a number that would lose
 * precision. Returns null when the text is not valid JSON.
 */
export function parseFast(text: string): { value: unknown; preserved: number } | null {
  try {
    if (hasImpreciseNumbers(text)) {
      const withSource = parseWithSource(text);
      if (withSource) return withSource;
      const r = parseText(text, { lossless: true });
      return r.ok ? { value: r.value, preserved: r.preserved } : null;
    }
    return { value: JSON.parse(text), preserved: 0 };
  } catch {
    return null;
  }
}

interface LinesResult {
  values: unknown[];
  preserved: number;
  error: JsonSyntaxError | null;
}

/**
 * Parse newline-delimited JSON. Stops at the first bad line, reporting its
 * position in `text`. With `objectsOnly`, a line that is not an object or an
 * array counts as bad (so plain text is never mistaken for NDJSON).
 */
export function parseLines(text: string, objectsOnly: boolean): LinesResult {
  const values: unknown[] = [];
  let preserved = 0;
  let pos = 0;
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    const s = firstNonWs(text, pos);
    if (s < end) {
      const line = text.slice(pos, end);
      const c = text.charCodeAt(s);
      const shapeOk = !objectsOnly || c === 123 || c === 91;
      const parsed = shapeOk ? parseFast(line) : null;
      if (!parsed) {
        const r = shapeOk ? parseText(line) : null;
        const offset = pos + (r && !r.ok ? r.error.offset : s - pos);
        const message = r && !r.ok ? r.error.message : 'Expected a JSON object or array on this line';
        return { values, preserved, error: { message, offset, ...lineColumn(text, offset) } };
      }
      values.push(parsed.value);
      preserved += parsed.preserved;
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  return { values, preserved, error: null };
}

export interface AnalyzeOptions {
  /** Accept comments and trailing commas (the viewer page's paste/open box). */
  jsonc?: boolean;
}

/**
 * Turn a body into something to show, or null to leave the page alone.
 *
 * - declared JSON always yields a doc: a tree, an NDJSON tree, an empty-body
 *   notice, or an error view with the parser's position;
 * - text/JavaScript yields a doc only if the body really is JSON (optionally
 *   JSONP- or XSSI-wrapped) or NDJSON of objects;
 * - declared NDJSON yields a tree of lines or an error view.
 */
export function analyze(raw: string, cls: ContentClass, opts: AnalyzeOptions = {}): ViewerDoc | null {
  const firstIdx = firstNonWs(raw);
  if (firstIdx >= raw.length) return cls === 'text' ? null : { kind: 'empty', raw };

  if (cls !== 'ndjson') {
    const u = unwrap(raw);
    const c = u.text.charCodeAt(firstNonWs(u.text));
    const plausible = cls === 'json' || c === 123 || c === 91;
    if (plausible) {
      const parsed = parseFast(u.text);
      if (parsed) {
        return { kind: 'json', format: 'json', value: parsed.value, raw, preserved: parsed.preserved, jsonp: u.jsonp, prefix: u.prefix };
      }
    }

    // Several JSON values, one per line? (Only worth trying if there is a second line.)
    const firstChar = raw.charCodeAt(firstIdx);
    const firstBreak = raw.indexOf('\n', firstIdx);
    const multiline = firstBreak !== -1 && firstNonWs(raw, firstBreak) < raw.length;
    if (multiline && !u.jsonp && (cls === 'json' || firstChar === 123 || firstChar === 91)) {
      const lines = parseLines(raw, cls === 'text');
      if (!lines.error && lines.values.length >= 2) {
        return { kind: 'json', format: 'ndjson', value: lines.values, raw, preserved: lines.preserved, jsonp: null, prefix: null };
      }
    }

    if (!plausible) return null;

    const r = parseText(u.text, { comments: opts.jsonc, trailingCommas: opts.jsonc, lossless: true });
    if (r.ok) {
      // Only reachable for JSONC (native parsing already succeeded otherwise).
      return { kind: 'json', format: 'jsonc', value: r.value, raw, preserved: r.preserved, jsonp: u.jsonp, prefix: u.prefix };
    }
    if (cls === 'text') return null;
    const offset = u.start + r.error.offset;
    return { kind: 'error', format: 'json', raw, error: { message: r.error.message, offset, ...lineColumn(raw, offset) } };
  }

  const lines = parseLines(raw, false);
  if (lines.error) return { kind: 'error', format: 'ndjson', raw, error: lines.error };
  return { kind: 'json', format: 'ndjson', value: lines.values, raw, preserved: lines.preserved, jsonp: null, prefix: null };
}
