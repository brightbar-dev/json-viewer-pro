/**
 * Arrays of objects as tables: which arrays qualify, their columns, compact
 * cell previews and sorting. Pure and unit-tested; lib/table.ts renders it.
 */
import { compareNumbers, LosslessNumber } from './lossless';
import { compareKeys, isContainerValue } from './tree';

/** The column for elements that are not objects (a number in an array of objects, say). */
export const VALUE_COLUMN = '\u0000value';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return isContainerValue(v) && !Array.isArray(v);
}

/** Worth a table: a non-empty array whose elements are mostly objects. */
export function isTabular(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const sample = Math.min(value.length, 1000);
  let objects = 0;
  for (let i = 0; i < sample; i++) if (isPlainObject(value[i])) objects++;
  return objects > 0 && objects * 2 >= sample;
}

/**
 * Union of keys across all rows, in first-seen order, plus a leading value
 * column when some rows are not objects. Stops adding columns at `limit`.
 */
export function tableColumns(rows: readonly unknown[], limit = 300): { columns: string[]; truncated: boolean } {
  const seen = new Set<string>();
  const columns: string[] = [];
  let needsValue = false;
  let truncated = false;
  for (const row of rows) {
    if (!isPlainObject(row)) {
      needsValue = true;
      continue;
    }
    for (const k of Object.keys(row)) {
      if (seen.has(k)) continue;
      if (columns.length >= limit) {
        truncated = true;
        continue;
      }
      seen.add(k);
      columns.push(k);
    }
  }
  return { columns: needsValue ? [VALUE_COLUMN, ...columns] : columns, truncated };
}

export type CellKind = 'missing' | 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

export interface Cell {
  kind: CellKind;
  value: unknown;
}

export function cellOf(row: unknown, column: string): Cell {
  let value: unknown;
  if (column === VALUE_COLUMN) {
    if (isPlainObject(row)) return { kind: 'missing', value: undefined };
    value = row;
  } else {
    if (!isPlainObject(row) || !Object.prototype.hasOwnProperty.call(row, column)) return { kind: 'missing', value: undefined };
    value = row[column];
  }
  if (value === null) return { kind: 'null', value };
  if (Array.isArray(value)) return { kind: 'array', value };
  if (value instanceof LosslessNumber || typeof value === 'number') return { kind: 'number', value };
  if (typeof value === 'object') return { kind: 'object', value };
  return { kind: typeof value as 'string' | 'boolean', value };
}

/**
 * A one-line preview of any value, at most about `max` characters, built
 * without serialising the whole value: `{"w": 0, "h": 2, …}`, `[1, 2, 3]`.
 */
export function preview(value: unknown, max = 80): string {
  let out = '';
  const push = (s: string) => {
    out += s;
    return out.length < max;
  };
  const walk = (v: unknown, depth: number): boolean => {
    if (v === null) return push('null');
    if (v instanceof LosslessNumber) return push(v.source);
    if (typeof v === 'string') return push(JSON.stringify(v.length > max ? `${v.slice(0, max)}…` : v));
    if (typeof v !== 'object') return push(String(v));
    if (depth > 3) return push(Array.isArray(v) ? '[…]' : '{…}');
    if (Array.isArray(v)) {
      if (!push('[')) return false;
      for (let i = 0; i < v.length; i++) {
        if (i > 0 && !push(', ')) return false;
        if (!walk(v[i], depth + 1)) return false;
      }
      return push(']');
    }
    const keys = Object.keys(v);
    if (!push('{')) return false;
    for (let i = 0; i < keys.length; i++) {
      if (i > 0 && !push(', ')) return false;
      if (!push(`${JSON.stringify(keys[i])}: `)) return false;
      if (!walk((v as Record<string, unknown>)[keys[i]!], depth + 1)) return false;
    }
    return push('}');
  };
  walk(value, 0);
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** Plain display text of a cell: strings without quotes, containers as a preview. */
export function cellText(cell: Cell, max = 80): string {
  switch (cell.kind) {
    case 'missing':
      return '';
    case 'string': {
      const s = cell.value as string;
      return s.length > max ? `${s.slice(0, max - 1)}…` : s;
    }
    case 'number':
      return cell.value instanceof LosslessNumber ? cell.value.source : String(cell.value);
    case 'boolean':
      return String(cell.value);
    case 'null':
      return 'null';
    default:
      return preview(cell.value, max);
  }
}

const KIND_RANK: Record<CellKind, number> = { number: 0, string: 1, boolean: 2, null: 3, object: 4, array: 5, missing: 6 };

/** Order two cells: by kind, then within a kind (numbers exactly, strings naturally). */
export function compareCells(a: Cell, b: Cell): number {
  if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  switch (a.kind) {
    case 'number':
      return compareNumbers(a.value as number | LosslessNumber, b.value as number | LosslessNumber);
    case 'string':
      return compareKeys(a.value as string, b.value as string);
    case 'boolean':
      return Number(a.value) - Number(b.value);
    case 'object':
    case 'array':
      return compareKeys(preview(a.value, 60), preview(b.value, 60));
    default:
      return 0;
  }
}

/**
 * Row order sorted by `column` (`dir` 1 ascending, -1 descending). Stable, and
 * rows without the column stay at the bottom either way.
 */
export function sortedOrder(rows: readonly unknown[], column: string, dir: 1 | -1): number[] {
  const cells = rows.map((r) => cellOf(r, column));
  const order = rows.map((_, i) => i);
  order.sort((i, j) => {
    const a = cells[i]!;
    const b = cells[j]!;
    const am = a.kind === 'missing';
    const bm = b.kind === 'missing';
    if (am || bm) return am === bm ? i - j : am ? 1 : -1;
    return compareCells(a, b) * dir || i - j;
  });
  return order;
}
