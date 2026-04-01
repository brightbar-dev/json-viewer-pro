import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '__MSG_appName__',
    description: '__MSG_appDescription__',
    default_locale: 'en',
    permissions: ['storage'],
    web_accessible_resources: [
      {
        resources: ['/viewer.css'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
