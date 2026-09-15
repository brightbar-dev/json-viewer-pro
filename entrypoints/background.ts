import { DEFAULT_SETTINGS } from '../lib/settings';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      browser.storage.sync.set({ settings: DEFAULT_SETTINGS });
    }
  });
});
