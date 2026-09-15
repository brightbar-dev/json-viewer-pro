# JSON Viewer Pro

Clean, fast JSON viewer for Chrome. Automatically detects and formats JSON responses with a collapsible tree view, search, and syntax highlighting. No ads, no tracking, no donation popups.

## Features

- Auto-detects JSON responses: `application/json`, `text/json`, and the `application/*+json` family (JSON-LD, problem+json, JSON:API…)
- Also handles JSON served with the wrong content type (`text/plain`, `text/javascript`, `application/javascript`) — but only when the body really parses
- Unwraps JSONP (`callback({...})`, callback name shown) and anti-XSSI prefixes (`)]}'`, `while(1);`)
- NDJSON / JSON Lines served as text is shown as an array of its lines
- Large documents stay fast: a 16.7 MB, 60,000-object file renders in about a tenth of a second and stays responsive while you scroll, search and expand everything, because only the rows on screen are ever put in the page
- Exact big numbers — integers beyond 2^53 (snowflake IDs, 64-bit keys) and long decimals are shown, searched and copied exactly as sent, never rounded
- Invalid JSON gets an error view: the parser message, line and column, a highlighted excerpt, the raw body with the error line marked, and a one-click lenient parse (comments and trailing commas allowed) to view it anyway
- Nothing is capped silently — a very long string or a multi-million-node Expand all stops with an on-screen notice and a one-click way past it
- Collapsible tree view with syntax highlighting and item counts on collapsed nodes; opens as much of the document as fits in about 1,500 rows
- Search across keys and values with a live match count; Enter / Shift+Enter step through matches, opening the tree to each one
- Filter mode — hide every row that does not match the search
- JSONPath queries in the same box — start with `$`: `$.data[*].email`, `$..price`, `$.items[?(@.price < 10 && @.inStock)]`. Results show as a filtered tree with a count, Enter steps through them. A small hand-written evaluator (members, `*`, indices, slices, `..`, unions, filters with `== != < <= > >= && || !`), never `eval`; big integers compare exactly
- Table view for arrays of objects — one column per key, sortable (numbers numerically, big integers exactly), nested values as compact previews that open into formatted JSON, 60,000 rows without slowing down; open it from the toolbar or a row's menu
- Full keyboard control of the tree — arrow keys move and open/close, Home/End jump, Enter toggles, `*` opens a whole subtree — built as a proper WAI-ARIA tree for screen readers
- Path bar — the selected node's path as clickable breadcrumbs; copy it as JSONPath (`$.data[3].email`), a JS accessor (`data[3].email`) or a JSON Pointer (`/data/3/email`)
- Copy any node as valid JSON — never a "3 items" placeholder, never stripped quotes — or copy/download the whole document formatted, minified or raw
- Show 1, 2 or 3 levels, expand all, collapse all; `Alt`+click a node to expand or collapse its whole subtree
- Sort keys alphabetically (view only — copies keep the original order)
- Raw view of the untouched response, with line numbers and a wrap toggle
- Value hints: clickable links, thumbnails for image URLs on hover, readable dates for ISO timestamps and epoch values, swatches for `#rrggbb` colours
- Light, dark and system themes (following the system live), font, text size and indentation settings — all applied to open tabs instantly, no reload; both themes meet WCAG AA contrast, checked by a test
- Keyboard shortcuts — `/` or `Ctrl/Cmd+F` to search, `Enter` or `Ctrl/Cmd+G` for the next match, `Esc` to clear, `e`/`c` to expand/collapse all, `1`–`3` for levels
- File size display

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `/` or `Ctrl/Cmd+F` | Focus the search box |
| `Enter` / `Shift+Enter` (in the search box) | Next / previous match |
| `Ctrl/Cmd+G` / `Shift+Ctrl/Cmd+G` | Next / previous match |
| `Esc` | Clear the search and unfocus |
| `e` | Expand all nodes |
| `c` | Collapse all nodes |
| `1` / `2` / `3` | Show that many levels |
| `Alt`+click | Expand or collapse a whole subtree |

In the tree (click a row, or Tab to it):

| Key | Action |
|-----|--------|
| `↑` / `↓` | Previous / next row |
| `→` | Open a node, or move to its first child |
| `←` | Close a node, or move to its parent |
| `Home` / `End` | First / last row |
| `Page Up` / `Page Down` | Move a screenful |
| `Enter` or `Space` | Open or close |
| `*` | Open everything below |
| `Ctrl/Cmd+C` | Copy the selected value as JSON (when no text is selected) |
| `Ctrl/Cmd+Shift+C` | Copy the selected value's JSONPath |
| `Shift+F10` or the menu key | Copy options for the selected row |

`Ctrl/Cmd+F` is handled by the viewer on purpose: the browser's own find cannot
reach text inside collapsed or off-screen nodes, and the built-in search opens
the tree to each match.

## Installation

### From Chrome Web Store
[Install JSON Viewer Pro](https://chromewebstore.google.com/detail/json-viewer-pro/iodhhjpjemdfmmfffmejfnbbjbfafoac) — free, no account required.

### From GitHub Release
1. Download the latest `json-viewer-pro.zip` from [Releases](https://github.com/brightbar-dev/json-viewer-pro/releases)
2. Unzip into a folder
3. Open `chrome://extensions/` and enable "Developer mode"
4. Click "Load unpacked" and select the unzipped folder
5. Navigate to any JSON URL — it's automatically formatted

### From Source
1. Clone this repo
2. Open `chrome://extensions/` and enable "Developer mode"
3. Click "Load unpacked" and select the repo directory
4. Navigate to any JSON URL to test

## Testing

```bash
npm test          # Vitest, one run
npm run test:watch
```

Tests run under Vitest with the WXT testing plugin, in Node with no DOM. The
logic lives in pure modules under `lib/` — the parser, lossless numbers,
content-type detection, the tree model, search, serialisation — and each has a
test file in `tests/`.

### Performance check (local, not in CI)

`tests/e2e/perf.mjs` loads the built extension into Chrome for Testing,
generates its own fixtures (including a 16.7 MB, 60,000-object document) and
prints markdown tables: first render, long tasks, JS heap and DOM size per
fixture; scroll, search, filter and expand-all timings on the large document;
and the extension's cost on an ordinary HTML page. CI has no browser, so it is a
local script:

```bash
npm run build
PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs \
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
node tests/e2e/perf.mjs                      # or: node tests/e2e/perf.mjs main=/path/to/old-build new=.output/chrome-mv3
```

Chrome-branded builds ignore `--load-extension`, so it has to be Chrome for
Testing (`npx playwright install chromium` downloads one).

<!-- Deliberately no test COUNT here. Both branches merged into this file had
     independently rewritten this section, and one of them wrote "77 unit
     tests" — a number that is wrong the first time anyone adds a test and
     that nothing regenerates. `npm test` prints the real count on every run,
     which is the only place it stays true. -->

## Privacy

This extension:
- Does NOT collect personal data
- Does NOT track your browsing
- Does NOT inject ads, donation popups, or promotional content
- Stores settings locally using Chrome's storage API
- Makes no network requests of its own
- Exposes no web-accessible resources, so web pages cannot probe for it
- Shows image thumbnails only when you hover an image URL, loading the image from its own address (with no referrer); this can be turned off in the options
- See our full [Privacy Policy](PRIVACY_POLICY.md)

## Store Listing Copy

> Title and Short Description below mirror `public/_locales/en/messages.json`
> (`appName` / `appDescription`) — that file is what the store actually renders,
> so change it there first and copy the result here.

### Title
JSON Viewer Pro - Formatter, Beautifier & API Response Viewer

### Short Description
Fast, private JSON viewer with tree view, search, and syntax highlighting. No tracking, no ads, no popups. Open source.

### Detailed Description
JSON Viewer Pro automatically detects and formats JSON responses in your browser.

Features:
- Collapsible tree view with syntax highlighting
- Search across keys and values with highlighting and a live match count
- Filter mode — show only the rows that match your search
- Keyboard shortcuts for search, expand all, and collapse all
- Copy individual values or full JSON paths
- Toggle between formatted tree view and the raw response
- Light, dark, and auto themes (follows your system preference)
- URL detection — clickable links in string values
- File size display in the toolbar

Why JSON Viewer Pro?
- Zero tracking or analytics — your data stays on your device
- No ads, donation popups, or injected content
- Fast and lightweight
- Clean, modern UI with dark mode support
- Open source

### Category
Developer Tools

### Search Keywords
json, json viewer, json formatter, json editor, json tree, json pretty print, api response viewer, developer tools
