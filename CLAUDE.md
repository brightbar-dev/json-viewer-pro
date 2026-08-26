# JSON Viewer Pro — Browser Extension

## What This Is
A browser extension that auto-detects JSON responses and renders them as an interactive tree view with search, syntax highlighting, and theme support. Privacy-first: no tracking, no ads, no donation popups.

Built with [WXT](https://wxt.dev/) — builds for Chrome (MV3) and Firefox (MV2) from one codebase.

## Architecture
- **entrypoints/content.ts** — Content script injected on all pages. Detects JSON via `document.contentType` with fallback heuristics. Renders the tree UI.
- **entrypoints/background.ts** — Service worker for extension lifecycle (sets defaults on install).
- **entrypoints/popup/** — Browser action popup with enable/disable toggle and theme selector.
- **entrypoints/options/** — Full options page for advanced settings.
- **public/viewer.css** — Styles for the tree view, toolbar, search, and themes (light/dark/auto). Web-accessible resource.
- **public/icon-{16,48,128}.png** — Extension icons.

## Key Implementation Details
- All DOM elements use `jvp-` prefix to avoid conflicts with page styles
- JSON detection: `document.contentType === 'application/json'` is the primary check. Fallback accepts Chrome's `json-formatter-container` sibling element.
- Uses `browser.*` API (WXT polyfill) — works in both Chrome and Firefox
- Tree nodes are collapsible. Toggle state uses `jvp-collapsed` class.
- Search highlights matches with `jvp-search-match` class.
- Themes stored in `browser.storage.sync`.
- Search highlights matches with `jvp-search-match`; filter mode adds `jvp-search-hidden` to every row that is not a match, an ancestor of one, or a descendant of one
- Keyboard shortcuts are plain in-page `keydown` listeners — deliberately NOT the `commands` manifest key, which would add a permission
- The Raw view shows the original response body verbatim, not a re-serialisation of the parsed value; Copy copies whichever view is on screen
- Utility functions `formatSize`, `generatePath`, `isUrl`, `matchesQuery`, `formatMatchCount`, `computeVisibleNodes`, `resolveShortcut` are exported for testing.

## Commands
```bash
npm run dev          # Dev mode with HMR (Chrome)
npm run dev:firefox  # Dev mode (Firefox)
npm run build        # Production build (Chrome)
npm run build:firefox # Production build (Firefox)
npm run zip          # Build + zip for store submission
npm run test         # Run Vitest tests
npm run test:watch   # Watch mode
```

## Testing
```bash
npm test
```
- 77 unit tests via Vitest + WXT testing plugin
- Tests cover: JSON parsing, URL detection, path generation, size formatting, search matching, filter visibility, keyboard shortcuts
- The test environment is Node, with **no DOM** — logic that needs testing must be extracted into a pure exported function (this is why `computeVisibleNodes` takes parent/match arrays rather than elements). Adding jsdom/happy-dom would mean a new devDependency.
- `fakeBrowser` from `wxt/testing` provides in-memory browser API mocks

## Conventions
- WXT framework with vanilla TypeScript (no UI framework)
- Version: semver, 0.2.x (WXT rewrite), 1.x = production-ready
- All user-facing strings in HTML, not TS
- Privacy policy must be kept current with any permission changes
- Do NOT add Claude/AI as co-author or contributor in commits, PRs, or code
