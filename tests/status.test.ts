import { describe, it, expect } from 'vitest';
import { analyze } from '../lib/document';
import { describeTabStatus, tabStatus } from '../lib/status';

describe('popup tab status', () => {
  it('no viewer in the tab', () => expect(describeTabStatus(null, true)).toEqual({ tone: 'idle', text: 'This tab is not a JSON response.' }));
  it('formatting switched off', () => expect(describeTabStatus(null, false).text).toMatch(/^Formatting is off/));
  it('a JSON tab', () => {
    const s = tabStatus(analyze('{"id": 149883901923910003}', 'json')!, 16_700_000);
    expect(describeTabStatus(s, true)).toEqual({ tone: 'ok', text: 'Showing this tab as JSON · 15.9 MB · 1 exact big number' });
  });
  it('JSONP and NDJSON are named', () => {
    expect(describeTabStatus(tabStatus(analyze('cb({"a":1})', 'text')!, 11), true).text).toBe('Showing this tab as JSONP · 11 B');
    expect(describeTabStatus(tabStatus(analyze('{"a":1}\n{"a":2}', 'text')!, 15), true).text).toBe('Showing this tab as NDJSON · 15 B');
  });
  it('an invalid JSON tab', () => {
    const s = tabStatus(analyze('{"a": 1,}', 'json')!, 9);
    expect(describeTabStatus(s, true)).toEqual({ tone: 'error', text: "This tab's JSON is invalid: Trailing comma is not allowed in JSON (line 1, column 8)." });
  });
  it('an empty JSON tab', () => expect(describeTabStatus(tabStatus(analyze('', 'json')!, 0), true).text).toBe('This tab is an empty JSON response.'));
});
