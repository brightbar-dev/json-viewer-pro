/**
 * The Raw view's text, split into chunks the browser can skip laying out while
 * they are off screen (`content-visibility: auto`). One 16 MB <pre> costs a
 * sub-second layout every time it is shown or hidden; chunks cost only what is
 * visible. Pure and unit-tested.
 */

/**
 * Split `text` into pieces of about `size` characters. A cut goes just after
 * a line break in the second half of the window if there is one, otherwise just
 * after a comma, otherwise at the window edge — never inside a surrogate pair.
 * Joining the pieces gives back `text` exactly.
 */
export function splitChunks(text: string, size = 50_000): string[] {
  if (text.length <= size) return [text];
  const half = Math.floor(size / 2);
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const tail = text.slice(start + half, end);
      const nl = tail.lastIndexOf('\n');
      const comma = nl === -1 ? tail.lastIndexOf(',') : -1;
      if (nl !== -1) end = start + half + nl + 1;
      else if (comma !== -1) end = start + half + comma + 1;
      const c = text.charCodeAt(end - 1);
      if (c >= 0xd800 && c <= 0xdbff) end++;
    }
    out.push(text.slice(start, end));
    start = end;
  }
  return out;
}

export interface ChunkLines {
  /** 1-based number of the first line that starts in or continues into this chunk. */
  firstLine: number;
  /** True when the chunk begins partway through a line (the previous chunk did not end with a line break). */
  continues: boolean;
}

/** Line numbering for each chunk from splitChunks. */
export function chunkLines(chunks: readonly string[]): ChunkLines[] {
  const out: ChunkLines[] = [];
  let line = 1;
  let continues = false;
  for (const chunk of chunks) {
    out.push({ firstLine: line, continues });
    let n = 0;
    for (let i = chunk.indexOf('\n'); i !== -1; i = chunk.indexOf('\n', i + 1)) n++;
    line += n;
    continues = chunk.length > 0 && !chunk.endsWith('\n');
  }
  return out;
}

/** Rough number of wrapped lines `text` occupies at `columns` characters per line. */
export function estimateLines(text: string, columns: number): number {
  const cols = Math.max(1, columns);
  let lines = 0;
  let pos = 0;
  for (;;) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    if (nl === -1 && end === pos && lines > 0) break;
    lines += Math.max(1, Math.ceil((end - pos) / cols));
    if (nl === -1) break;
    pos = nl + 1;
  }
  return lines;
}
