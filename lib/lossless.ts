/**
 * Lossless numbers.
 *
 * A float64 holds about 15–17 significant decimal digits, so `JSON.parse`
 * silently rounds integers beyond 2^53 (snowflake IDs, 64-bit database keys)
 * and long decimals. A number whose source text would not survive that trip is
 * kept as a `LosslessNumber` carrying its exact source, so the viewer can
 * display, search and copy it verbatim.
 */
export class LosslessNumber {
  readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  valueOf(): number {
    return Number(this.source);
  }

  toString(): string {
    return this.source;
  }
}

/**
 * Reduce a JSON number token to `[-]<digits>e<exp>` with no leading or
 * trailing zeros, so `1.50`, `15e-1` and `1.5` all compare equal. Zero of
 * either sign is `0`.
 */
function canonical(src: string): string {
  let s = 0;
  const negative = src.charCodeAt(0) === 45; // '-'
  if (negative || src.charCodeAt(0) === 43) s = 1; // '+' (String(n) never emits it; harmless)

  let e = src.indexOf('e', s);
  if (e === -1) e = src.indexOf('E', s);
  const mantissa = e === -1 ? src.slice(s) : src.slice(s, e);
  let exp = e === -1 ? 0 : parseInt(src.slice(e + 1), 10);

  const dot = mantissa.indexOf('.');
  let digits = dot === -1 ? mantissa : mantissa.slice(0, dot) + mantissa.slice(dot + 1);
  if (dot !== -1) exp -= mantissa.length - dot - 1;

  let a = 0;
  while (a < digits.length && digits.charCodeAt(a) === 48) a++;
  if (a === digits.length) return '0';
  let b = digits.length;
  while (digits.charCodeAt(b - 1) === 48) {
    b--;
    exp++;
  }
  digits = digits.slice(a, b);
  return `${negative ? '-' : ''}${digits}e${exp}`;
}

/**
 * True when the JSON number token `src` would change value if parsed into a
 * float64 and printed back — i.e. when displaying `Number(src)` would lie.
 * Cosmetic differences (`1.0` vs `1`, `1e3` vs `1000`) do not count.
 */
export function losesPrecision(src: string): boolean {
  // Up to 15 significant digits always round-trip through a double, unless the
  // exponent overflows or underflows — only possible when there is an exponent.
  if (src.length <= 15 && src.indexOf('e') === -1 && src.indexOf('E') === -1) return false;
  const n = Number(src);
  if (!Number.isFinite(n)) return true;
  return canonical(src) !== canonical(String(n));
}

// A run long enough to hold 16+ significant digits, or a 3-digit exponent.
const SUSPECT = /\d[\d.]{15,}|[eE][+-]?\d{3,}/g;
const NUMBER_TOKEN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

function isNumberChar(c: number): boolean {
  return (c >= 48 && c <= 57) || c === 46 || c === 45 || c === 43 || c === 101 || c === 69;
}

// What may sit immediately before / after a number token in valid JSON.
function isBoundaryBefore(c: number): boolean {
  return Number.isNaN(c) || c === 58 || c === 44 || c === 91 || c === 32 || c === 10 || c === 13 || c === 9;
}
function isBoundaryAfter(c: number): boolean {
  return Number.isNaN(c) || c === 44 || c === 93 || c === 125 || c === 32 || c === 10 || c === 13 || c === 9;
}

/**
 * Cheap pre-scan: does `text` contain at least one number token that would
 * lose precision? Only when it does is the (several times slower) lossless
 * parse worth paying for. False positives only cost speed; a number token that
 * sits inside a string is skipped by the boundary checks.
 */
export function hasImpreciseNumbers(text: string): boolean {
  SUSPECT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SUSPECT.exec(text)) !== null) {
    let start = m.index;
    while (start > 0 && isNumberChar(text.charCodeAt(start - 1))) start--;
    NUMBER_TOKEN.lastIndex = start;
    const tok = NUMBER_TOKEN.exec(text);
    if (tok) {
      const end = start + tok[0].length;
      if (
        end >= m.index + 1 &&
        isBoundaryBefore(start === 0 ? NaN : text.charCodeAt(start - 1)) &&
        isBoundaryAfter(text.charCodeAt(end)) &&
        losesPrecision(tok[0])
      ) {
        return true;
      }
      if (end > SUSPECT.lastIndex) SUSPECT.lastIndex = end;
    }
  }
  return false;
}

type ReviverWithSource = (key: string, value: unknown, context?: { source?: string }) => unknown;

let reviverSourceSupport: boolean | undefined;

/** `JSON.parse` reviver `context.source` — Chrome 114+, Firefox 135+. */
export function reviverHasSource(): boolean {
  if (reviverSourceSupport === undefined) {
    let seen: string | undefined;
    try {
      const reviver: ReviverWithSource = (_k, v, ctx) => {
        seen = ctx?.source;
        return v;
      };
      JSON.parse('7', reviver as (k: string, v: unknown) => unknown);
    } catch {
      seen = undefined;
    }
    reviverSourceSupport = seen === '7';
  }
  return reviverSourceSupport;
}

/**
 * `JSON.parse` that keeps imprecise numbers as `LosslessNumber`. Returns null
 * when the engine cannot report number source text (the caller then falls back
 * to the hand-written parser). Throws `SyntaxError` like `JSON.parse`.
 */
export function parseWithSource(text: string): { value: unknown; preserved: number } | null {
  if (!reviverHasSource()) return null;
  let preserved = 0;
  const reviver: ReviverWithSource = (_k, v, ctx) => {
    if (typeof v === 'number' && ctx?.source !== undefined && losesPrecision(ctx.source)) {
      preserved++;
      return new LosslessNumber(ctx.source);
    }
    return v;
  };
  const value: unknown = JSON.parse(text, reviver as (k: string, v: unknown) => unknown);
  return { value, preserved };
}

const INTEGER = /^-?\d+$/;

/** Compare two numbers exactly, including integers beyond 2^53 kept as LosslessNumber. */
export function compareNumbers(a: number | LosslessNumber, b: number | LosslessNumber): number {
  const sa = a instanceof LosslessNumber ? a.source : String(a);
  const sb = b instanceof LosslessNumber ? b.source : String(b);
  if ((a instanceof LosslessNumber || b instanceof LosslessNumber) && INTEGER.test(sa) && INTEGER.test(sb)) {
    const x = BigInt(sa);
    const y = BigInt(sb);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = Number(sa);
  const y = Number(sb);
  return x < y ? -1 : x > y ? 1 : 0;
}
