/** Small display helpers. Pure and unit-tested. */

export function formatSize(bytes: number): string {
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** 1234567 → "1,234,567" (locale-independent, so tests are deterministic). */
export function formatNumber(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "3 items", "1 key". */
export function formatCount(kind: 'object' | 'array', n: number): string {
  const noun = kind === 'array' ? 'item' : 'key';
  return `${formatNumber(n)} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * Toolbar match count. `current` is the 0-based index of the selected match
 * (-1 for none); `done` is false while a search is still running.
 */
export function formatMatchCount(count: number, current = -1, done = true): string {
  if (!done) return `${formatNumber(count)}${count ? '+' : ''} …`;
  if (count === 0) return 'No matches';
  if (current >= 0) return `${formatNumber(current + 1)} of ${formatNumber(count)}`;
  return `${formatNumber(count)} match${count === 1 ? '' : 'es'}`;
}

export function isUrl(str: string): boolean {
  return /^https?:\/\//.test(str);
}

/** Byte length of `s` encoded as UTF-8, without allocating the encoding. */
export function utf8Length(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. */
export function isHexColor(s: string): boolean {
  return HEX_COLOR.test(s);
}

const IMAGE_URL = /^https?:\/\/[^\s?#]+\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp)(?:[?#]\S*)?$/i;
const IMAGE_DATA = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon);base64,[A-Za-z0-9+/=]+$/;

/** An http(s) URL ending in an image extension, or a base64 image data URI. */
export function isImageUrl(s: string): boolean {
  return s.length < 1_000_000 && (IMAGE_URL.test(s) || IMAGE_DATA.test(s));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const TIME_WORD = /time|date|stamp|created|updated|modified|expire|deleted|since|until|seen|born/i;
const TIME_SUFFIX = /^(?:exp|iat|nbf|ts|at|on)$|_(?:at|ts|on)$|[a-z](?:At|On|Ts)$/;
const EPOCH_S = [946684800, 4102444800] as const; // 2000-01-01 .. 2100-01-01
const EPOCH_MS = [946684800000, 4102444800000] as const;

/**
 * When `value` looks like a point in time, its epoch milliseconds. ISO-8601
 * strings always qualify. Integer numbers qualify only in a plausible epoch
 * range (2000–2100, seconds or milliseconds) AND under a time-like key
 * (`createdAt`, `updated_at`, `exp`, `timestamp`…), so ordinary IDs do not.
 */
export function timestampMillis(key: string | number | null, value: unknown): number | null {
  if (typeof value === 'string') {
    if (value.length > 40 || !ISO_DATE.test(value)) return null;
    const t = Date.parse(value.length > 10 && value[10] === ' ' ? `${value.slice(0, 10)}T${value.slice(11)}` : value);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || typeof key !== 'string') return null;
  if (!TIME_WORD.test(key) && !TIME_SUFFIX.test(key)) return null;
  if (value >= EPOCH_S[0] && value <= EPOCH_S[1]) return value * 1000;
  if (value >= EPOCH_MS[0] && value <= EPOCH_MS[1]) return value;
  return null;
}

/** `2023-11-14 22:13:20 UTC` (milliseconds shown only when present). */
export function formatUtc(ms: number): string {
  const iso = new Date(ms).toISOString();
  const frac = iso.slice(19, 23);
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}${frac === '.000' ? '' : frac} UTC`;
}

/** "3 days ago", "in 2 hours", "just now". */
export function relativeTime(ms: number, now: number): string {
  const diff = ms - now;
  const abs = Math.abs(diff) / 1000;
  if (abs < 45) return 'just now';
  const units: [number, string][] = [
    [31536000, 'year'],
    [2592000, 'month'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [secs, name] of units) {
    if (abs >= secs * 0.95 || name === 'minute') {
      const n = Math.max(1, Math.round(abs / secs));
      const phrase = `${n} ${name}${n === 1 ? '' : 's'}`;
      return diff < 0 ? `${phrase} ago` : `in ${phrase}`;
    }
  }
  return 'just now';
}

/** A download file name for the document at `url`: its last path segment, ending in `.json`. */
export function downloadName(url: string, ext = 'json'): string {
  let segment = '';
  try {
    segment = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
  } catch {
    segment = '';
  }
  const base = segment.replace(/\.(?:json|jsonc|ndjson|jsonl|txt|js)$/i, '').replace(/[^\w.-]+/g, '_').replace(/^[._]+|[._]+$/g, '');
  return `${base || 'response'}.${ext}`;
}
