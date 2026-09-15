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
