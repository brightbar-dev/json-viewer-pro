# JSON Viewer Pro — Browser Extension

## What This Is
A browser extension that auto-detects JSON responses and renders them as an interactive tree view with search, syntax highlighting, and theme support. Privacy-first: no tracking, no ads, no donation popups.

Built with [WXT](https://wxt.dev/) — builds for Chrome (MV3) and Firefox (MV2) from one codebase.

## Architecture
- **entrypoints/content.ts** — Content script on all pages at `document_start`. On an ordinary page it exits after one `document.contentType` comparison (no storage read, no DOM access). For JSON-like types it hides the raw body, reads settings, and at DOMContentLoaded hands the body text to `lib/`.
- **entrypoints/background.ts** — Service worker for extension lifecycle (sets defaults on install).
- **entrypoints/popup/** — Browser action popup with enable/disable toggle and theme selector (merges into stored settings; never overwrites fields it does not show).
- **entrypoints/options/** — Options page: theme, font, text size, indentation, initial expansion, image previews. Saves on every change; no Save button.
- **lib/** — the viewer engine. Pure modules (unit-tested, no DOM):
  - `document.ts` — content-type classification, JSONP / anti-XSSI unwrapping, NDJSON, and `analyze()`, which parses a body exactly once
  - `lossless.ts` — `LosslessNumber`, the pre-scan deciding whether a lossless parse is needed, reviver `context.source` detection
  - `parser.ts` — hand-written iterative parser (error message + line/column, JSONC, lossless fallback) and `errorExcerpt`
  - `tree.ts` — `TreeModel`: lazily materialised `TNode`s and the flat list of visible rows; `expandByBudget`; `formatPath`
  - `search.ts` — time-sliceable search over the parsed value, match paths, the filter predicate; `resultFromPaths`/`matchLookup` turn JSONPath matches into the same result shape
  - `jsonpath.ts` — the JSONPath subset: hand-written parser and evaluator (no `eval`/`Function`), positioned errors, match limit
  - `tabular.ts` — table view logic: `isTabular`, column union, cell previews, exact sorting
  - `serialize.ts`, `raw.ts`, `format.ts` (incl. timestamp/colour/image detection, download names), `settings.ts`, `shortcuts.ts` (global keys and the tree keymap), `contrast.ts` — small helpers
- **lib/** DOM modules: `view.ts` (row rendering, full vs virtual layout, selection, keyboard, ARIA, image preview), `viewer.ts` (header with toolbar/path bar/notices, search wiring, menus, levels, sort, live settings, error and empty states), `rawview.ts` (raw body with lazy line numbering), `table.ts` (virtualised table in its own scroll box), `menu.ts` (popover menu), `dom.ts` (stylesheet injection, clipboard), `viewer.css`.
- **public/icon-{16,48,128}.png** — Extension icons.

## Key Implementation Details
- All DOM elements use `jvp-` prefix to avoid conflicts with page styles
- **Detection** (`classifyContentType`): `application/json`, `text/json`, `application/*json*` are always rendered (tree, error view, or empty state); `text/plain`, `text/javascript`, `application/javascript` only when the body actually parses (optionally JSONP-wrapped) or is NDJSON of objects. `text/html` is never taken over. What Chrome 153 actually builds: JSON types → `<pre>` + `<div class="json-formatter-container">`; text types → a lone `<pre>`; `application/x-ndjson` is **downloaded**, not rendered, so no content script ever sees it.
- **Parse once**: `parseFast` uses native `JSON.parse` unless `hasImpreciseNumbers` finds a number that would lose precision; then a reviver with `context.source` (Chrome 114+, Firefox 135+), else the hand-written parser. Lossless numbers are `LosslessNumber` and are displayed, searched and copied (`stringifyJson`) from their source text.
- **Rendering never scales with document size**: `TreeModel.rows` is a flat array of node rows and closing-bracket rows; a node's children are created on first expand. `TreeView` puts every row in the DOM up to `FULL_RENDER_LIMIT` (3,000, rows wrap naturally) and beyond that renders only the viewport window (fixed 20 px rows; the spacer is capped at 8,000,000 px and scrolling is compressed past it). One delegated click listener; no per-row listeners.
- Initial expansion is breadth-first within `INITIAL_ROW_BUDGET` (1,500 rows), not a fixed depth.
- **Never cap silently**: anything held back to stay responsive says so on screen with a one-click override — strings over 10,000 characters ("show N more characters"), and Expand all / Alt+click past `EXPAND_LIMIT` (2,000,000 child nodes; the toolbar notice's "Expand everything").
- The error view offers "Try a lenient parse" (`analyze(raw, 'json', { jsonc: true })`): comments and trailing commas accepted, shown with a JSONC badge.
- Collapsed rows show item counts. The toggle arrow is CSS generated content (`.jvp-open`), so it never lands in copied text.
- **Search** walks the parsed value (not the DOM) in slices of at most 12 ms, debounced. It reveals and scrolls to the current match (Enter / Shift+Enter, Ctrl/Cmd+G); filter mode keeps matches, their ancestors and their descendants. Array indices never match.
- **JSONPath** uses the same search box: a query starting with `$` (`looksLikeJsonPath`) is compiled by `lib/jsonpath.ts`, capped at 100,000 matches (the count says so), converted with `resultFromPaths`, and shown with filter mode switched on automatically (`autoFilter`, undone when the box goes back to plain text).
- **Table view** (`lib/table.ts`) opens for the selected array of objects (or its nearest such ancestor, or the document). It has its own scroll box so the header can stick; Escape or *Back to tree* closes it, and a row number or *Show in tree* reveals that element.
- **No raw control characters in source**: the Write tool turns `\u0000`-style escapes into the characters themselves, and a NUL byte makes git treat a file as binary. Keep escapes as escapes (this repo had NUL bytes in `serialize.ts`/`viewer.ts` until PR 3a).
- Keyboard shortcuts are plain in-page `keydown` listeners — deliberately NOT the `commands` manifest key, which would add a permission
- **Selection and keyboard**: the tree container is `role="tree"` with `tabindex=0` and keeps focus itself, pointing `aria-activedescendant` at the selected row (`id="jvp-r<TNode.id>"`), so virtual re-rendering never drops focus. Rows are `treeitem`s with `aria-level`/`aria-setsize`/`aria-posinset`/`aria-expanded`; closing-bracket rows are `aria-hidden`. Clicking a row selects it; clicking its label (arrow, key, bracket, count) also toggles it.
- **Copy is always valid JSON**: row menus and Ctrl/Cmd+C copy `stringifyJson(node.value)` (lossless); paths come from `formatPath` / `formatJsPath` / `formatJsonPointer`. Downloads use an `<a download>` blob link — no `downloads` permission.
- **Settings apply live**: `mountViewer` returns a controller; the content script calls `applySettings` from `storage.onChanged`. Theme/font/size/indent are CSS custom properties on `<body>`; row height follows the font size (`rowHeightFor`). `expandBudget` and `enabled` apply to pages opened afterwards.
- **Contrast is tested**: `tests/contrast.test.ts` reads `lib/viewer.css` and requires 4.5:1 for every text colour on every row/highlight background in both themes. Change a colour, run the test.
- Image previews load the hovered URL in an `<img referrerpolicy=no-referrer>` (setting `imagePreview`); PRIVACY_POLICY.md says so — keep it true.
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
