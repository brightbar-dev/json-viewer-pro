import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { analyze } from '../lib/document';
import { DEFAULT_SETTINGS, type Settings } from '../lib/settings';
import { tabStatus } from '../lib/status';

// The popup is what a user opens to check a tab or switch formatting off. Its script runs on
// import against the popup's elements, stubbed here with just the properties it touches.

type Handler = (e: { preventDefault: () => void }) => void;

function control(props: Record<string, unknown> = {}) {
  const handlers: Record<string, Handler> = {};
  return {
    ...props,
    handlers,
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
  };
}

let els: {
  enabled: ReturnType<typeof control> & { checked: boolean };
  theme: ReturnType<typeof control> & { value: string };
  'options-link': ReturnType<typeof control>;
  'tab-status': { textContent: string; className: string };
  version: { textContent: string };
  'review-nudge': { dataset: Record<string, string> };
};

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

async function openPopup(): Promise<void> {
  vi.resetModules();
  await import('../entrypoints/popup/main');
  await settle();
}

async function change(el: 'enabled' | 'theme', value: boolean | string): Promise<void> {
  if (el === 'enabled') els.enabled.checked = value as boolean;
  else els.theme.value = value as string;
  els[el].handlers.change!({ preventDefault() {} });
  await settle();
}

const stored = async (): Promise<Settings> => (await fakeBrowser.storage.sync.get('settings')).settings as Settings;

describe('popup', () => {
  const sendMessage = vi.fn();
  const openOptionsPage = vi.fn();

  beforeEach(() => {
    fakeBrowser.reset();
    els = {
      enabled: control({ checked: false }) as typeof els.enabled,
      theme: control({ value: '' }) as typeof els.theme,
      'options-link': control(),
      'tab-status': { textContent: '', className: '' },
      version: { textContent: '' },
      'review-nudge': { dataset: {} },
    };
    vi.stubGlobal('document', { getElementById: (id: keyof typeof els) => els[id] ?? null });
    sendMessage.mockReset().mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
    openOptionsPage.mockReset();
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 7 }] as never);
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockImplementation(sendMessage);
    vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({ version: '0.8.0' } as ReturnType<typeof fakeBrowser.runtime.getManifest>);
    vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockImplementation(openOptionsPage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the stored switch and theme, and the defaults when nothing is stored', async () => {
    await openPopup();
    expect(els.enabled.checked).toBe(true);
    expect(els.theme.value).toBe('auto');

    await fakeBrowser.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, enabled: false, theme: 'dark' } });
    await openPopup();
    expect(els.enabled.checked).toBe(false);
    expect(els.theme.value).toBe('dark');
  });

  it('merges into stored settings, never wiping the ones it does not show', async () => {
    const mine: Settings = { ...DEFAULT_SETTINGS, fontFamily: 'Menlo', fontSize: 16, indent: 24, expandBudget: 300, imagePreview: false };
    await fakeBrowser.storage.sync.set({ settings: mine });
    await openPopup();

    await change('enabled', false);
    expect(await stored()).toEqual({ ...mine, enabled: false });

    await change('theme', 'light');
    expect(await stored()).toEqual({ ...mine, enabled: false, theme: 'light' });
  });

  it('never saves a theme it does not know', async () => {
    await openPopup();
    await change('theme', 'solarized');
    expect((await stored()).theme).toBe('auto');
  });

  it('asks the active tab what it is showing, and says so', async () => {
    sendMessage.mockResolvedValue(tabStatus(analyze('{"id": 149883901923910003}', 'json')!, 2048));
    await openPopup();
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'jvp-status' });
    expect(els['tab-status']).toEqual({ textContent: 'Showing this tab as JSON · 2.0 KB · 1 exact big number', className: 'tab-status ok' });
  });

  it('reads a tab that does not answer as “not JSON”, or “off” when formatting is switched off', async () => {
    await openPopup();
    expect(els['tab-status']).toEqual({ textContent: 'This tab is not a JSON response.', className: 'tab-status idle' });

    await fakeBrowser.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, enabled: false } });
    await openPopup();
    expect(els['tab-status'].textContent).toMatch(/^Formatting is off/);
  });

  it('copes with no active tab', async () => {
    vi.mocked(fakeBrowser.tabs.query).mockResolvedValue([] as never);
    await openPopup();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(els['tab-status'].className).toBe('tab-status idle');
  });

  it('opens the options page and shows the version', async () => {
    await openPopup();
    const preventDefault = vi.fn();
    els['options-link'].handlers.click!({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(openOptionsPage).toHaveBeenCalledTimes(1);
    expect(els.version.textContent).toBe('v0.8.0');
  });
});
