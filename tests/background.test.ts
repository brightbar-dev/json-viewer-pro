import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import background from '../entrypoints/background';
import { DEFAULT_SETTINGS } from '../lib/settings';

// The service worker's only job: defaults and the welcome page on first install, and nothing
// on an update — an update that rewrote `settings` would wipe every user's choices.
describe('background: install and update', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    background.main();
  });

  it('stores the default settings and opens the welcome page on install', async () => {
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' } as Parameters<typeof fakeBrowser.runtime.onInstalled.trigger>[0]);
    expect(await fakeBrowser.storage.sync.get('settings')).toEqual({ settings: DEFAULT_SETTINGS });
    const tabs = await fakeBrowser.tabs.query({});
    expect(tabs.map((t) => t.url)).toContain(fakeBrowser.runtime.getURL('/welcome.html'));
  });

  it('leaves stored settings and tabs alone on an update', async () => {
    const mine = { ...DEFAULT_SETTINGS, theme: 'dark', fontSize: 16, enabled: false };
    await fakeBrowser.storage.sync.set({ settings: mine });
    const before = (await fakeBrowser.tabs.query({})).length;
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.7.0' } as Parameters<typeof fakeBrowser.runtime.onInstalled.trigger>[0]);
    expect(await fakeBrowser.storage.sync.get('settings')).toEqual({ settings: mine });
    expect((await fakeBrowser.tabs.query({})).length).toBe(before);
  });
});
