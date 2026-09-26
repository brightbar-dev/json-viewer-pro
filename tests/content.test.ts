import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS, normalizeSettings } from '../lib/settings';

// The content script runs on every page the user opens. The viewer and the stylesheet need a real
// DOM, so they are stubbed here: what is tested is the decision-making around them — when the
// script leaves, what it hides and always shows again, which settings it reads, what it hands to
// the viewer, and the two listeners it leaves behind.
const mountViewer = vi.fn();
const applySettings = vi.fn();
const reveal = vi.fn();
const addStyleSheet = vi.fn((_css: string) => reveal);
vi.mock('../lib/viewer', () => ({ mountViewer }));
vi.mock('../lib/dom', () => ({ addStyleSheet }));

const { default: content } = await import('../entrypoints/content');
/** The script ignores its context argument. */
const runScript = () => content.main({} as NonNullable<Parameters<typeof content.main>[0]>);

class FakeText {
  constructor(public data: string) {}
}

interface FakeElement {
  tagName: string;
  classList: { contains: (c: string) => boolean };
  firstChild: FakeText | null;
  textContent: string;
}

function element(tagName: string, text = '', className = ''): FakeElement {
  return { tagName, classList: { contains: (c) => c === className }, firstChild: text ? new FakeText(text) : null, textContent: text };
}

/** What a browser builds for a raw response: a lone <pre>, plus Chrome's container for JSON types. */
function rawBody(text: string, chromeJson = true): { children: FakeElement[]; textContent: string } {
  const children = [element('PRE', text)];
  if (chromeJson) children.push(element('DIV', '', 'json-formatter-container'));
  return { children, textContent: text };
}

/**
 * Install a page. Every property read on `document` is recorded, so a test can prove an ordinary
 * page costs one `contentType` read and nothing else.
 */
function page(contentType: string, body: unknown, readyState: DocumentReadyState = 'loading') {
  const reads: string[] = [];
  const listeners: Record<string, () => void> = {};
  const target = {
    contentType,
    readyState,
    body,
    addEventListener: (type: string, fn: () => void) => (listeners[type] = fn),
  };
  const doc = new Proxy(target, {
    get(t, key) {
      reads.push(String(key));
      return t[key as keyof typeof t];
    },
  });
  vi.stubGlobal('document', doc);
  const win = { top: undefined as unknown };
  win.top = win;
  vi.stubGlobal('window', win);
  vi.stubGlobal('location', { href: 'https://api.example.com/users' });
  vi.stubGlobal('Text', FakeText);
  return {
    reads,
    win,
    loaded: async () => {
      listeners.DOMContentLoaded?.();
      await settle();
    },
  };
}

/** Let the script's async work (storage read, render) finish. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const storedSettings = async () => (await fakeBrowser.storage.sync.get('settings')).settings;

describe('content script', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.clearAllMocks();
    mountViewer.mockImplementation(() => ({ applySettings }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('leaves an ordinary page after reading contentType once: no storage read, no DOM access', async () => {
    const get = vi.spyOn(fakeBrowser.storage.sync, 'get');
    const { reads } = page('text/html', rawBody('{"a":1}'));
    runScript();
    await settle();
    expect(reads).toEqual(['contentType']);
    expect(get).not.toHaveBeenCalled();
    expect(addStyleSheet).not.toHaveBeenCalled();
    expect(mountViewer).not.toHaveBeenCalled();
  });

  it('leaves frames alone, even JSON ones', async () => {
    const { reads, win } = page('application/json', rawBody('{"a":1}'));
    win.top = {};
    runScript();
    await settle();
    expect(reads).toEqual([]);
    expect(mountViewer).not.toHaveBeenCalled();
  });

  it('hides a declared JSON body at once and shows it again after rendering', async () => {
    await fakeBrowser.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, theme: 'dark', fontSize: 15 } });
    const p = page('application/json', rawBody('{"users":[{"id":1}]}'));
    runScript();
    // document_start: the raw text must be hidden before the body is even parsed by the browser.
    expect(addStyleSheet).toHaveBeenCalledTimes(1);
    expect(addStyleSheet.mock.calls[0]![0]).toMatch(/html > body > pre.*display: none/);
    expect(mountViewer).not.toHaveBeenCalled();

    await p.loaded();
    expect(mountViewer).toHaveBeenCalledTimes(1);
    const [doc, opts] = mountViewer.mock.calls[0]!;
    expect(doc).toMatchObject({ kind: 'json', value: { users: [{ id: 1 }] } });
    expect(opts).toMatchObject({ contentType: 'application/json', url: 'https://api.example.com/users' });
    expect(opts.settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark', fontSize: 15 });
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('renders at once when the document has already loaded', async () => {
    page('application/json', rawBody('[1,2]'), 'complete');
    runScript();
    await settle();
    expect(mountViewer.mock.calls[0]![0]).toMatchObject({ kind: 'json', value: [1, 2] });
  });

  it('uses the defaults when nothing is stored or storage fails', async () => {
    vi.spyOn(fakeBrowser.storage.sync, 'get').mockRejectedValueOnce(new Error('sync unavailable'));
    const p = page('application/json', rawBody('{}'));
    runScript();
    await p.loaded();
    expect(mountViewer.mock.calls[0]![1].settings).toEqual(DEFAULT_SETTINGS);
  });

  it('shows the raw body again, untouched, when formatting is switched off', async () => {
    await fakeBrowser.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, enabled: false } });
    const p = page('application/json', rawBody('{"a":1}'));
    runScript();
    await p.loaded();
    expect(mountViewer).not.toHaveBeenCalled();
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('shows the body again when the page is not shaped like a raw response', async () => {
    const p = page('application/json', { children: [element('DIV', '{"a":1}')], textContent: '{"a":1}' });
    runScript();
    await p.loaded();
    expect(mountViewer).not.toHaveBeenCalled();
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('always renders declared JSON, as an error view when it does not parse', async () => {
    const p = page('application/json', rawBody('{"a": 1,}'));
    runScript();
    await p.loaded();
    expect(mountViewer.mock.calls[0]![0]).toMatchObject({ kind: 'error' });
  });

  it('takes over plain text only when it is JSON, and never hides it first', async () => {
    const get = vi.spyOn(fakeBrowser.storage.sync, 'get');
    const prose = page('text/plain', rawBody('Hello, world', false));
    runScript();
    await prose.loaded();
    expect(addStyleSheet).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled(); // the first kilobyte already rules it out
    expect(mountViewer).not.toHaveBeenCalled();

    const json = page('text/plain', rawBody('{"ok":true}', false));
    runScript();
    await json.loaded();
    expect(addStyleSheet).not.toHaveBeenCalled();
    expect(mountViewer.mock.calls[0]![0]).toMatchObject({ kind: 'json', value: { ok: true } });
  });

  it('counts a document towards the review request only when it is shown as JSON', async () => {
    const bad = page('application/json', rawBody('{oops'));
    runScript();
    await bad.loaded();
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});

    const good = page('application/json', rawBody('{"a":1}'));
    runScript();
    await good.loaded();
    await settle();
    expect(Object.keys(await fakeBrowser.storage.local.get(null))).toEqual(['reviewNudge']);
  });

  it('answers the popup’s status question, and only that question', async () => {
    const p = page('application/json', rawBody('{"id": 149883901923910003}'));
    runScript();
    await p.loaded();
    const sendResponse = vi.fn();
    await fakeBrowser.runtime.onMessage.trigger({ type: 'something-else' }, {}, sendResponse);
    await fakeBrowser.runtime.onMessage.trigger(null, {}, sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
    await fakeBrowser.runtime.onMessage.trigger({ type: 'jvp-status' }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ kind: 'json', format: 'json', preserved: 1, bytes: 26 }));
  });

  it('applies settings changed in the popup or options page live, normalised', async () => {
    const p = page('application/json', rawBody('{}'));
    runScript();
    await p.loaded();
    await fakeBrowser.storage.local.set({ settings: { theme: 'light' } });
    expect(applySettings).not.toHaveBeenCalled();
    await fakeBrowser.storage.sync.set({ settings: { theme: 'light', fontSize: 999 } });
    expect(applySettings).toHaveBeenCalledWith(normalizeSettings({ theme: 'light', fontSize: 999 }));
    expect(await storedSettings()).toEqual({ theme: 'light', fontSize: 999 });
  });
});
