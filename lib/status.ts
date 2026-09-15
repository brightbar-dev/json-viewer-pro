/** What the popup says about the current tab. Pure and unit-tested. */
import type { ViewerDoc } from './document';
import { formatNumber, formatSize } from './format';

/** What a rendering tab reports when the popup asks. */
export interface TabStatus {
  kind: 'json' | 'error' | 'empty';
  format: 'json' | 'ndjson' | 'jsonc' | null;
  jsonp: string | null;
  preserved: number;
  bytes: number;
  message: string | null;
  line: number | null;
  column: number | null;
}

export function tabStatus(doc: ViewerDoc, bytes: number): TabStatus {
  return {
    kind: doc.kind,
    format: doc.kind === 'empty' ? null : doc.format,
    jsonp: doc.kind === 'json' ? doc.jsonp : null,
    preserved: doc.kind === 'json' ? doc.preserved : 0,
    bytes,
    message: doc.kind === 'error' ? doc.error.message : null,
    line: doc.kind === 'error' ? doc.error.line : null,
    column: doc.kind === 'error' ? doc.error.column : null,
  };
}

/** `null` status: no rendering viewer answered in this tab. */
export function describeTabStatus(status: TabStatus | null, enabled: boolean): { tone: 'ok' | 'error' | 'idle'; text: string } {
  if (!status) {
    return { tone: 'idle', text: enabled ? 'This tab is not a JSON response.' : 'Formatting is off. Turn it on, then reload a JSON tab.' };
  }
  if (status.kind === 'empty') return { tone: 'idle', text: 'This tab is an empty JSON response.' };
  if (status.kind === 'error') {
    return { tone: 'error', text: `This tab's JSON is invalid: ${status.message} (line ${formatNumber(status.line ?? 0)}, column ${formatNumber(status.column ?? 0)}).` };
  }
  const what = status.jsonp ? 'JSONP' : status.format === 'ndjson' ? 'NDJSON' : 'JSON';
  const extras = status.preserved ? ` · ${formatNumber(status.preserved)} exact big number${status.preserved === 1 ? '' : 's'}` : '';
  return { tone: 'ok', text: `Showing this tab as ${what} · ${formatSize(status.bytes)}${extras}` };
}
