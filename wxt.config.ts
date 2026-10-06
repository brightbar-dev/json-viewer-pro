import { defineConfig } from 'wxt';

export default defineConfig({
  // Vite's module-preload polyfill calls fetch(). The extension's pages load
  // their own chunks without it, and the privacy check (scripts/check-privacy.mjs)
  // fails the build on any fetch in shipped code.
  vite: () => ({ build: { modulePreload: { polyfill: false } } }),
  manifest: ({ browser }) => ({
    // AMO refuses a name over 50 characters; the en Chrome name is 67. Every other locale's name is
    // already just the brand, so Firefox gets the brand in every locale.
    name: browser === 'firefox' ? 'Brightbar JSON Viewer' : '__MSG_appName__',
    description: '__MSG_appDescription__',
    default_locale: 'en',
    permissions: ['storage'],
    // Firefox only. The add-on ID is permanent once a version is on AMO, and AMO refuses a new
    // add-on without data_collection_permissions (required since 2025-11-03; read by Firefox 140+).
    // This extension collects and transmits nothing, so it declares 'none'.
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'json-viewer-pro@brightbar.dev',
          strict_min_version: '140.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
  // AMO reviewers rebuild the add-on from the -sources.zip without access to GitHub Packages, so the
  // private @brightbar-dev package rides along inside it as a tarball (.wxt/local_modules).
  zip: { downloadPackages: ['@brightbar-dev/review-nudge'] },
});
