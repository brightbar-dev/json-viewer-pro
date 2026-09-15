import { defineConfig } from 'wxt';

export default defineConfig({
  // Vite's module-preload polyfill calls fetch(). The extension's pages load
  // their own chunks without it, and the privacy check (scripts/check-privacy.mjs)
  // fails the build on any fetch in shipped code.
  vite: () => ({ build: { modulePreload: { polyfill: false } } }),
  manifest: {
    name: '__MSG_appName__',
    description: '__MSG_appDescription__',
    default_locale: 'en',
    permissions: ['storage'],
  },
});
