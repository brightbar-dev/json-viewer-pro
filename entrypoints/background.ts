import { DEFAULT_SETTINGS } from '../lib/settings';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      browser.storage.sync.set({ settings: DEFAULT_SETTINGS });
      // A local page (no network): a sample document, the shortcuts, and how to allow file URLs.
      void browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
    }
  });
});
