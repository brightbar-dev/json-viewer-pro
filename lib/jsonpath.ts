/**
 * A safe JSONPath subset, parsed and evaluated by hand — never `eval` or
 * `Function`. Pure and unit-tested.
 *
 *   $                    the document
 *   .key  ['key']        a member ("double" or 'single' quotes)
 *   .*  [*]              every child
 *   [n]  [-1]            an array element (negative counts from the end)
 *   [start:end:step]     an array slice
 *   ['a','b']  [0,2]     several selectors at once
 *   ..key  ..*  ..[0]    the same, at any depth
 *   [?(@.k == v)]        children for which a filter holds:
 *                        == != < <= > >=, && || !, parentheses, and a bare
 *                        @.path to test that a member exists
 *
 * Operands are @ (the child being tested) or $ followed by .key / ['key'] /
 * [n], or a literal: a JSON number, 'string', "string", true, false, null.
 * Numbers compare exactly, including integers too big for a float.
 */
import { compareNumbers, LosslessNumber, losesPrecision } from './lossless';
import { isContainerValue } from './tree';

type Key = string | number;

type Selector =
  | { t: 'name'; name: string }
  | { t: 'wild' }
  | { t: 'index'; index: number }
  | { t: 'slice'; start: number | null; end: number | null; step: number | null }
  | { t: 'filter'; expr: Expr };

interface Segment {
  descendant: boolean;
  selectors: Selector[];
}

type Op = '==' | '!=' | '<' | '<=' | '>' | '>=';

type Operand = { t: 'lit'; value: unknown } | { t: 'path'; absolute: boolean; keys: Key[] };

type Expr =
  | { t: 'or'; a: Expr; b: Expr }
  | { t: 'and'; a: Expr; b: Expr }
  | { t: 'not'; e: Expr }
  | { t: 'cmp'; op: Op; a: Operand; b: Operand }
  | { t: 'exists'; path: Operand & { t: 'path' } };

export interface JsonPathError {
  message: string;
  /** Offset in the query of the problem. */
  offset: number;
}

class Fail {
  constructor(
    readonly message: string,
    readonly offset: number,
  ) {}
}

const IDENT_START = /[A-Za-z_$\u0080-\uffff]/;
const IDENT_PART = /[\w$\u0080-\uffff]/;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const INT = /-?\d+/y;

function parse(query: string): Segment[] {
  let i = 0;
  const n = query.length;
  const peek = (s: string) => query.startsWith(s, i);
  const ws = () => {
    while (i < n && /\s/.test(query[i]!)) i++;
  };
  const describe = () => (i >= n ? 'the end of the query' : `'${query[i]}'`);
  const expect = (s: string) => {
    ws();
    if (!peek(s)) throw new Fail(`Expected '${s}' but found ${describe()}`, i);
    i += s.length;
  };

  const identifier = (): string => {
    const start = i;
    if (i >= n || !IDENT_START.test(query[i]!)) throw new Fail(`Expected a member name but found ${describe()}`, i);
    while (i < n && IDENT_PART.test(query[i]!)) i++;
    return query.slice(start, i);
  };

  const quoted = (): string => {
    const q = query[i]!;
    const start = i++;
    let out = '';
    while (i < n && query[i] !== q) {
      if (query[i] === '\\') {
        const e = query[i + 1];
        if (e === 'u') {
          const hex = query.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Fail('Invalid \\u escape', i);
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '/': '/', '\\': '\\', "'": "'", '"': '"' };
        if (e === undefined || !(e in map)) throw new Fail('Invalid escape in string', i);
        out += map[e];
        i += 2;
      } else {
        out += query[i++];
      }
    }
    if (i >= n) throw new Fail('Unterminated string', start);
    i++;
    return out;
  };

  const int = (): number | null => {
    INT.lastIndex = i;
    const m = INT.exec(query);
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };

  const literal = (): unknown => {
    const c = query[i];
    if (c === "'" || c === '"') return quoted();
    if (peek('true')) return (i += 4), true;
    if (peek('false')) return (i += 5), false;
    if (peek('null')) return (i += 4), null;
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(query);
    if (!m) throw new Fail(`Expected a value but found ${describe()}`, i);
    i += m[0].length;
    return losesPrecision(m[0]) ? new LosslessNumber(m[0]) : Number(m[0]);
  };

  /** @ or $ followed by .name / ['name'] / [n] only. */
  const operandPath = (): Operand & { t: 'path' } => {
    const absolute = query[i] === '$';
    i++;
    const keys: Key[] = [];
    for (;;) {
      if (peek('..')) throw new Fail("'..' is not allowed inside a filter", i);
      if (peek('.')) {
        i++;
        keys.push(identifier());
      } else if (peek('[')) {
        i++;
        ws();
        const c = query[i];
        if (c === "'" || c === '"') keys.push(quoted());
        else {
          const k = int();
          if (k === null) throw new Fail('Inside a filter, use a name or an index here', i);
          keys.push(k);
        }
        expect(']');
      } else {
        return { t: 'path', absolute, keys };
      }
    }
  };

  const operand = (): Operand => {
    ws();
    if (query[i] === '@' || query[i] === '$') return operandPath();
    return { t: 'lit', value: literal() };
  };

  const OPS: Op[] = ['==', '!=', '<=', '>=', '<', '>'];

  function expr(): Expr {
    let left = and();
    for (;;) {
      ws();
      if (!peek('||')) return left;
      i += 2;
      left = { t: 'or', a: left, b: and() };
    }
  }
  function and(): Expr {
    let left = unary();
    for (;;) {
      ws();
      if (!peek('&&')) return left;
      i += 2;
      left = { t: 'and', a: left, b: unary() };
    }
  }
  function unary(): Expr {
    ws();
    if (peek('!') && !peek('!=')) {
      i++;
      return { t: 'not', e: unary() };
    }
    if (peek('(')) {
      i++;
      const e = expr();
      expect(')');
      return e;
    }
    const start = i;
    const a = operand();
    ws();
    const op = OPS.find((o) => peek(o));
    if (!op) {
      if (a.t !== 'path') throw new Fail('A value on its own is not a condition; compare it with == != < <= > >=', start);
      return { t: 'exists', path: a };
    }
    i += op.length;
    return { t: 'cmp', op, a, b: operand() };
  }

  const bracket = (): Selector[] => {
    i++; // [
    ws();
    if (peek('?')) {
      i++;
      const e = expr();
      expect(']');
      return [{ t: 'filter', expr: e }];
    }
    const out: Selector[] = [];
    for (;;) {
      ws();
      const c = query[i];
      if (c === '*') {
        i++;
        out.push({ t: 'wild' });
      } else if (c === "'" || c === '"') {
        out.push({ t: 'name', name: quoted() });
      } else {
        const start = int();
        ws();
        if (peek(':')) {
          i++;
          ws();
          const end = int();
          ws();
          let step: number | null = null;
          if (peek(':')) {
            i++;
            ws();
            step = int();
          }
          if (step === 0) throw new Fail('A slice step cannot be 0', i);
          out.push({ t: 'slice', start, end, step });
        } else if (start !== null) {
          out.push({ t: 'index', index: start });
        } else {
          throw new Fail(`Expected a name, index, slice, * or ?filter but found ${describe()}`, i);
        }
      }
      ws();
      if (peek(',')) {
        i++;
        continue;
      }
      expect(']');
      return out;
    }
  };

  ws();
  if (!peek('$')) throw new Fail('A JSONPath starts with $', i);
  i++;
  const segments: Segment[] = [];
  for (;;) {
    ws();
    if (i >= n) break;
    if (peek('..')) {
      i += 2;
      if (peek('[')) segments.push({ descendant: true, selectors: bracket() });
      else if (peek('*')) {
        i++;
        segments.push({ descendant: true, selectors: [{ t: 'wild' }] });
      } else segments.push({ descendant: true, selectors: [{ t: 'name', name: identifier() }] });
    } else if (peek('.')) {
      i++;
      if (peek('*')) {
        i++;
        segments.push({ descendant: false, selectors: [{ t: 'wild' }] });
      } else segments.push({ descendant: false, selectors: [{ t: 'name', name: identifier() }] });
    } else if (peek('[')) {
      segments.push({ descendant: false, selectors: bracket() });
    } else {
      throw new Fail(`Unexpected ${describe()}`, i);
    }
  }
  return segments;
}

// ---------- evaluation ----------

interface Node {
  value: unknown;
  key: Key | null;
  parent: Node | null;
}

function pathOfNode(node: Node): Key[] {
  const out: Key[] = [];
  for (let n: Node | null = node; n && n.parent; n = n.parent) out.push(n.key as Key);
  return out.reverse();
}

function childNodes(node: Node, visit: (child: Node) => void): void {
  const v = node.value;
  if (Array.isArray(v)) {
    for (let k = 0; k < v.length; k++) visit({ value: v[k], key: k, parent: node });
  } else if (isContainerValue(v)) {
    for (const k of Object.keys(v)) visit({ value: (v as Record<string, unknown>)[k], key: k, parent: node });
  }
}

function resolve(start: unknown, keys: Key[]): { found: boolean; value: unknown } {
  let v = start;
  for (const k of keys) {
    if (typeof k === 'number') {
      if (!Array.isArray(v)) return { found: false, value: undefined };
      const idx = k < 0 ? v.length + k : k;
      if (idx < 0 || idx >= v.length) return { found: false, value: undefined };
      v = v[idx];
    } else {
      if (!isContainerValue(v) || Array.isArray(v) || !Object.prototype.hasOwnProperty.call(v, k)) return { found: false, value: undefined };
      v = (v as Record<string, unknown>)[k];
    }
  }
  return { found: true, value: v };
}

function isNumeric(v: unknown): v is number | LosslessNumber {
  return typeof v === 'number' || v instanceof LosslessNumber;
}

function compare(op: Op, a: { found: boolean; value: unknown }, b: { found: boolean; value: unknown }): boolean {
  if (!a.found || !b.found) return op === '!=' ? a.found !== b.found : false;
  const x = a.value;
  const y = b.value;
  if (isNumeric(x) && isNumeric(y)) {
    const c = compareNumbers(x, y);
    return op === '==' ? c === 0 : op === '!=' ? c !== 0 : op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
  }
  if (typeof x === 'string' && typeof y === 'string') {
    return op === '==' ? x === y : op === '!=' ? x !== y : op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
  }
  if (op === '==' || op === '!=') {
    const same = x === y || (isContainerValue(x) && isContainerValue(y) && JSON.stringify(x) === JSON.stringify(y));
    return op === '==' ? same : !same;
  }
  return false;
}

function test(e: Expr, current: unknown, root: unknown): boolean {
  switch (e.t) {
    case 'or':
      return test(e.a, current, root) || test(e.b, current, root);
    case 'and':
      return test(e.a, current, root) && test(e.b, current, root);
    case 'not':
      return !test(e.e, current, root);
    case 'exists':
      return resolve(e.path.absolute ? root : current, e.path.keys).found;
    case 'cmp': {
      const val = (o: Operand) => (o.t === 'lit' ? { found: true, value: o.value } : resolve(o.absolute ? root : current, o.keys));
      return compare(e.op, val(e.a), val(e.b));
    }
  }
}

function select(node: Node, sel: Selector, root: unknown, out: Node[]): void {
  const v = node.value;
  switch (sel.t) {
    case 'name':
      if (isContainerValue(v) && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, sel.name)) {
        out.push({ value: (v as Record<string, unknown>)[sel.name], key: sel.name, parent: node });
      }
      return;
    case 'wild':
      childNodes(node, (c) => out.push(c));
      return;
    case 'index':
      if (Array.isArray(v)) {
        const idx = sel.index < 0 ? v.length + sel.index : sel.index;
        if (idx >= 0 && idx < v.length) out.push({ value: v[idx], key: idx, parent: node });
      }
      return;
    case 'slice': {
      if (!Array.isArray(v)) return;
      const len = v.length;
      const step = sel.step ?? 1;
      const norm = (x: number) => (x < 0 ? Math.max(len + x, step > 0 ? 0 : -1) : Math.min(x, step > 0 ? len : len - 1));
      if (step > 0) {
        const start = sel.start === null ? 0 : norm(sel.start);
        const end = sel.end === null ? len : norm(sel.end);
        for (let k = start; k < end; k += step) out.push({ value: v[k], key: k, parent: node });
      } else {
        const start = sel.start === null ? len - 1 : norm(sel.start);
        const end = sel.end === null ? -1 : norm(sel.end);
        for (let k = start; k > end; k += step) out.push({ value: v[k], key: k, parent: node });
      }
      return;
    }
    case 'filter':
      childNodes(node, (c) => {
        if (test(sel.expr, c.value, root)) out.push(c);
      });
      return;
  }
}

export interface JsonPathResult {
  /** Paths of the matched values, in match order. */
  paths: Key[][];
  /** True when evaluation stopped at `limit` matches. */
  truncated: boolean;
}

export type CompiledJsonPath = { ok: true; run(root: unknown, limit?: number): JsonPathResult } | { ok: false; error: JsonPathError };

/** Is this query meant as JSONPath (rather than a plain text search)? */
export function looksLikeJsonPath(query: string): boolean {
  return /^\s*\$(?:$|[.[\s])/.test(query);
}

export function compileJsonPath(query: string): CompiledJsonPath {
  let segments: Segment[];
  try {
    segments = parse(query);
  } catch (e) {
    if (e instanceof Fail) return { ok: false, error: { message: e.message, offset: e.offset } };
    throw e;
  }
  return {
    ok: true,
    run(root, limit = Infinity) {
      let nodes: Node[] = [{ value: root, key: null, parent: null }];
      let truncated = false;
      for (let s = 0; s < segments.length; s++) {
        const seg = segments[s]!;
        const last = s === segments.length - 1;
        const next: Node[] = [];
        const apply = (node: Node) => {
          for (const sel of seg.selectors) {
            select(node, sel, root, next);
            if (last && next.length >= limit) {
              truncated = true;
              return false;
            }
          }
          return true;
        };
        outer: for (const node of nodes) {
          if (!seg.descendant) {
            if (!apply(node)) break;
            continue;
          }
          // The node itself, then every descendant, in document order.
          const stack: Node[] = [node];
          while (stack.length) {
            const cur = stack.pop()!;
            if (!apply(cur)) break outer;
            const kids: Node[] = [];
            childNodes(cur, (c) => {
              if (isContainerValue(c.value)) kids.push(c);
            });
            for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]!);
          }
        }
        nodes = last && next.length > limit ? next.slice(0, limit) : next;
        if (truncated) break;
      }
      return { paths: nodes.map(pathOfNode), truncated };
    },
  };
}
