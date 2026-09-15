# JSON Viewer Pro — Browser Extension

## What This Is
A browser extension that auto-detects JSON responses and renders them as an interactive tree view with search, syntax highlighting, and theme support. Privacy-first: no tracking, no ads, no donation popups.

Built with [WXT](https://wxt.dev/) — builds for Chrome (MV3) and Firefox (MV2) from one codebase.

## Architecture
- **entrypoints/content.ts** — Content script on all pages at `document_start`. On an ordinary page it exits after one `document.contentType` comparison (no storage read, no DOM access). For JSON-like types it hides the raw body, reads settings, and at DOMContentLoaded hands the body text to `lib/`.
- **entrypoints/background.ts** — Service worker for extension lifecycle (sets defaults on install).
- **entrypoints/popup/** — Browser action popup with enable/disable toggle and theme selector.
- **entrypoints/options/** — Full options page for advanced settings.
- **lib/** — the viewer engine. Pure modules (unit-tested, no DOM):
  - `document.ts` — content-type classification, JSONP / anti-XSSI unwrapping, NDJSON, and `analyze()`, which parses a body exactly once
  - `lossless.ts` — `LosslessNumber`, the pre-scan deciding whether a lossless parse is needed, reviver `context.source` detection
  - `parser.ts` — hand-written iterative parser (error message + line/column, JSONC, lossless fallback) and `errorExcerpt`
  - `tree.ts` — `TreeModel`: lazily materialised `TNode`s and the flat list of visible rows; `expandByBudget`; `formatPath`
  - `search.ts` — time-sliceable search over the parsed value, match paths, the filter predicate
  - `serialize.ts`, `raw.ts`, `format.ts`, `settings.ts`, `shortcuts.ts` — small helpers
- **lib/** DOM modules: `view.ts` (row rendering, full vs virtual layout), `viewer.ts` (toolbar, search wiring, raw view, error and empty states), `dom.ts` (stylesheet injection, clipboard), `viewer.css`.
- **public/icon-{16,48,128}.png** — Extension icons.

## Key Implementation Details
- All DOM elements use `jvp-` prefix to avoid conflicts with page styles
- **Detection** (`classifyContentType`): `application/json`, `text/json`, `application/*json*` are always rendered (tree, error view, or empty state); `text/plain`, `text/javascript`, `application/javascript` only when the body actually parses (optionally JSONP-wrapped) or is NDJSON of objects. `text/html` is never taken over. What Chrome 153 actually builds: JSON types → `<pre>` + `<div class="json-formatter-container">`; text types → a lone `<pre>`; `application/x-ndjson` is **downloaded**, not rendered, so no content script ever sees it.
- **Parse once**: `parseFast` uses native `JSON.parse` unless `hasImpreciseNumbers` finds a number that would lose precision; then a reviver with `context.source` (Chrome 114+, Firefox 135+), else the hand-written parser. Lossless numbers are `LosslessNumber` and are displayed, searched and copied (`stringifyJson`) from their source text.
- **Rendering never scales with document size**: `TreeModel.rows` is a flat array of node rows and closing-bracket rows; a node's children are created on first expand. `TreeView` puts every row in the DOM up to `FULL_RENDER_LIMIT` (3,000, rows wrap naturally) and beyond that renders only the viewport window (fixed 20 px rows; the spacer is capped at 8,000,000 px and scrolling is compressed past it). One delegated click listener; no per-row listeners.
- Initial expansion is breadth-first within `INITIAL_ROW_BUDGET` (1,500 rows), not a fixed depth.
- Collapsed rows show item counts. The toggle arrow is CSS generated content (`.jvp-open`), so it never lands in copied text.
- **Search** walks the parsed value (not the DOM) in slices of at most 12 ms, debounced. It reveals and scrolls to the current match (Enter / Shift+Enter, Ctrl/Cmd+G); filter mode keeps matches, their ancestors and their descendants. Array indices never match.
- Keyboard shortcuts are plain in-page `keydown` listeners — deliberately NOT the `commands` manifest key, which would add a permission
- The Raw view shows the original response body verbatim, not a re-serialisation of the parsed value; Copy copies whichever view is on screen. Raw text is split into `content-visibility: auto` chunks so a 16 MB body is not laid out all at once.
- **No web-accessible resources**: `viewer.css` is imported as a string (`?inline`) and adopted as a constructable stylesheet — pages cannot probe for the extension, and a response's CSP (`default-src 'none'`, `sandbox`) does not block the styles.
- Uses `browser.*` API (WXT polyfill) — works in both Chrome and Firefox
- Themes stored in `browser.storage.sync`.

## Commands
```bash
npm run dev          # Dev mode with HMR (Chrome)
npm run dev:firefox  # Dev mode (Firefox)
npm run build        # Production build (Chrome)
npm run build:firefox # Production build (Firefox)
npm run zip          # Build + zip for store submission
npm run test         # Run Vitest tests
npm run test:watch   # Watch mode
node tests/e2e/perf.mjs  # Local perf check in Chrome for Testing (see file header; not in CI)
```

## Testing
```bash
npm test
```
- Unit tests via Vitest + WXT testing plugin (`npm test` prints the count — do not write it here, it goes stale)
- Tests cover: the parser (messages, line/column, JSONC, lossless), the lossless pre-scan, detection and JSONP/XSSI/NDJSON handling, the tree model and initial expansion, search and filter, serialisation, raw chunking, formatting, settings, keyboard shortcuts
- The test environment is Node, with **no DOM** — logic that needs testing must be extracted into a pure module under `lib/` (this is why `TreeModel` and search know nothing about elements). Adding jsdom/happy-dom would mean a new devDependency.
- `tests/e2e/perf.mjs` is a LOCAL end-to-end check (Chrome for Testing via Playwright, both from env vars): first render, long tasks, heap and DOM size per fixture, interaction timings on a 16.7 MB document, and plain-page cost. CI has no browser, so it is not wired into CI.
- `fakeBrowser` from `wxt/testing` provides in-memory browser API mocks

## Conventions
- WXT framework with vanilla TypeScript (no UI framework)
- Version: semver, 0.2.x (WXT rewrite), 1.x = production-ready
- All user-facing strings in HTML, not TS
- Privacy policy must be kept current with any permission changes
- Do NOT add Claude/AI as co-author or contributor in commits, PRs, or code
