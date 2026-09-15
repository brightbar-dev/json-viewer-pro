/**
 * The Raw view: the untouched body with optional line numbers and wrapping.
 *
 * The text is split into chunks (lib/raw.ts) that the browser skips laying out
 * while off screen (`content-visibility: auto`). A chunk starts as a single
 * text node and is broken into numbered lines only when it comes near the
 * viewport, so a million-line body costs what is actually looked at.
 */
import { el } from './dom';
import { chunkLines, estimateLines, splitChunks, type ChunkLines } from './raw';

export interface RawViewOptions {
  /** A character range to highlight (the error line in the error view). */
  mark?: { start: number; end: number };
  wrap?: boolean;
  lineNumbers?: boolean;
}

export class RawView {
  readonly el: HTMLElement;
  private readonly chunks: string[];
  private readonly lines: ChunkLines[];
  private readonly pres: HTMLPreElement[] = [];
  private readonly offsets: number[] = [];
  private readonly observer: IntersectionObserver | null;
  private wrap: boolean;
  private numbers: boolean;
  private fontSize = 13;
  private rowHeight = 20;

  constructor(
    raw: string,
    private readonly opts: RawViewOptions = {},
  ) {
    this.wrap = opts.wrap ?? true;
    this.numbers = opts.lineNumbers ?? true;
    this.el = el('div', 'jvp-raw');
    this.chunks = splitChunks(raw);
    this.lines = chunkLines(this.chunks);
    const last = this.chunks.length - 1;
    const total = last < 0 ? 1 : this.lines[last]!.firstLine + (this.chunks[last]!.match(/\n/g)?.length ?? 0);
    this.el.style.setProperty('--jvp-gutter', `${String(total).length}ch`);

    this.observer =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) if (entry.isIntersecting) this.fill(entry.target as HTMLPreElement);
            },
            { rootMargin: '1500px 0px' },
          )
        : null;

    let offset = 0;
    this.chunks.forEach((chunk, i) => {
      const pre = el('pre', 'jvp-raw-chunk', chunk);
      pre.dataset.i = String(i);
      this.pres.push(pre);
      this.offsets.push(offset);
      this.el.append(pre);
      offset += chunk.length;
      if (this.observer) this.observer.observe(pre);
      else this.fill(pre);
    });
    this.applyClasses();
  }

  get wrapping(): boolean {
    return this.wrap;
  }

  get numbered(): boolean {
    return this.numbers;
  }

  setWrap(on: boolean): void {
    this.wrap = on;
    this.applyClasses();
  }

  setLineNumbers(on: boolean): void {
    this.numbers = on;
    this.applyClasses();
  }

  /** Font metrics, for the size estimates of chunks not yet laid out. */
  setMetrics(fontSize: number, rowHeight: number): void {
    this.fontSize = fontSize;
    this.rowHeight = rowHeight;
    this.updateSizes();
  }

  private applyClasses(): void {
    this.el.classList.toggle('jvp-raw-nowrap', !this.wrap);
    this.el.classList.toggle('jvp-raw-numbered', this.numbers);
    this.updateSizes();
  }

  private updateSizes(): void {
    const charWidth = this.fontSize * 0.6;
    const width = (this.el.clientWidth || window.innerWidth) - 32 - (this.numbers ? 80 : 0);
    const columns = this.wrap ? Math.max(20, Math.floor(width / charWidth)) : Infinity;
    this.pres.forEach((pre, i) => {
      pre.style.setProperty('contain-intrinsic-size', `auto ${estimateLines(this.chunks[i]!, columns) * this.rowHeight}px`);
    });
  }

  /** Break a chunk into line elements (once). */
  private fill(pre: HTMLPreElement): void {
    if (pre.dataset.filled) return;
    pre.dataset.filled = '1';
    this.observer?.unobserve(pre);
    const i = Number(pre.dataset.i);
    const chunk = this.chunks[i]!;
    const base = this.offsets[i]!;
    const { firstLine, continues } = this.lines[i]!;
    const frag = document.createDocumentFragment();
    let pos = 0;
    let n = firstLine;
    for (;;) {
      const nl = chunk.indexOf('\n', pos);
      const end = nl === -1 ? chunk.length : nl;
      if (nl === -1 && pos === chunk.length && pos > 0) break; // the chunk ended with a line break
      const line = el('span', 'jvp-raw-line');
      if (!(pos === 0 && continues)) line.dataset.n = String(n);
      this.appendLine(line, chunk, pos, end, base);
      frag.append(line);
      if (nl === -1) break;
      pos = nl + 1;
      n++;
    }
    pre.replaceChildren(frag);
  }

  private appendLine(line: HTMLElement, chunk: string, a: number, b: number, base: number): void {
    const m = this.opts.mark;
    // `b + 1` so a mark on an empty line (sitting on its line break) still shows.
    if (m && m.start < base + b + 1 && m.end > base + a) {
      const s = Math.max(m.start - base, a);
      const e = Math.max(s, Math.min(m.end - base, b));
      line.append(chunk.slice(a, s), el('mark', 'jvp-raw-error', chunk.slice(s, e) || ' '), chunk.slice(e, b));
    } else {
      line.textContent = chunk.slice(a, b);
    }
  }
}
