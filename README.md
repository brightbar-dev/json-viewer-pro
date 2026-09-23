# Brightbar JSON Viewer

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
- A popup that tells you whether the current tab is being shown as JSON (and its size, or why it is invalid), plus a first-run welcome page with a live sample, the shortcuts, and how to allow local files
- A viewer page of its own, opened from the toolbar popup: paste JSON, open a file or drop one (JSON, JSONC with comments and trailing commas, NDJSON). It validates as you type, gives the line and column of any error, and formats or minifies, then shows the same tree. Local files work without granting file:// access
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
[Install Brightbar JSON Viewer](https://chromewebstore.google.com/detail/json-viewer-pro/iodhhjpjemdfmmfffmejfnbbjbfafoac) — free, no account required.

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
- Asks for one API permission, `storage`. Chrome still shows "Read and change all your data on all websites", because the content script has to run on every page to recognise JSON; on ordinary pages it checks the content type and stops without reading the page
- Shows image thumbnails only when you hover an image URL, loading the image from its own address (with no referrer); this can be turned off in the options
- See our full [Privacy Policy](PRIVACY_POLICY.md)

### Verified, not just promised

Every CI run scans both built extensions with `scripts/check-privacy.mjs` and fails the build if the shipped code contains:
- a network API: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, WebRTC;
- a remote address;
- code built from strings: `eval`, `new Function`, string timers;
- a manifest that asks for more than the `storage` permission (no host or optional permissions, nothing web-accessible, no external messaging).

The only exceptions are listed in the script with the reason they are safe. Today those are the popup's links to our other extensions on the Chrome Web Store and the welcome page's link to this repository (ordinary links you can click, never loaded), and the SVG namespace string used to draw icons. Check it yourself:

```bash
npx wxt build && npx wxt build --browser firefox && npm run check:privacy
```

The rules are unit-tested in `tests/privacy.test.ts`.

## Store Listing Copy

> `store/cws.json` holds the listing fields. The Title and Short Description are
> `appName` / `appDescription` in `public/_locales/en/messages.json`, which is what
> the store renders, so change them there first and copy the result here. Uploading
> listing text and images in the Chrome Web Store dashboard is a manual step.

### Title
Brightbar JSON Viewer - Formatter, Beautifier & API Response Viewer

### Short Description
JSON viewer and formatter: fast tree view for huge files, dark mode, JSONPath search, exact big numbers. No tracking. Open source.

### Detailed Description
```text
Brightbar JSON Viewer turns any JSON response into a fast, readable tree. It is a JSON formatter and viewer that stays quick on huge files, keeps big numbers exact, and never tracks you. Free, with no account.

TREE VIEW AND FORMATTER
- Formats JSON automatically: application/json, the +json types, and JSON sent as text/plain or JavaScript (JSONP included)
- Collapsible tree with syntax colours, item counts, clickable links, readable dates and colour swatches
- Light, dark and system themes; pick the font, text size and indentation, applied instantly without reloading
- Raw view of the untouched response, with line numbers and wrapping

BIG FILES WITHOUT FREEZING
- Opens a 16 MB, 60,000-object document in well under a second and stays responsive while you scroll, search and expand everything
- Only the rows on screen are drawn, so a bigger file does not mean a slower page

FIND ANYTHING
- Search keys and values with a live match count; Enter jumps to each match
- Filter mode shows just the matches and the structure around them
- JSONPath queries in the same box: $.data[*].email, $..price, $.items[?(@.price < 10)]
- Table view turns an array of objects into a sortable table

EXACT AND CORRECT
- Big numbers stay exact: IDs like 149883901923910003 are shown, searched and copied as sent, never rounded
- Invalid JSON gets an error view with the message, line and column, plus an option to parse leniently (comments and trailing commas)
- Copy any value as valid JSON, copy its path as JSONPath, a JS accessor or a JSON Pointer, or download the document

KEYBOARD AND ACCESSIBILITY
- Full keyboard navigation of the tree (arrow keys, Home and End, Enter, *), built as an accessible tree for screen readers
- Shortcuts: / to search, e and c to expand and collapse everything, 1 to 3 to show that many levels

A VIEWER PAGE OF ITS OWN
- Paste JSON, open a file or drop one: JSON, JSON with comments and NDJSON, validated as you type, with Format and Minify

PRIVATE, AND YOU CAN CHECK
- No tracking, analytics, ads or donation popups, and no network requests of its own
- Open source: https://github.com/brightbar-dev/json-viewer-pro
- Every build runs an automated check that fails if the code contains a network API, a remote address or code built from strings
- One API permission, storage, for your settings
- Hovering an image URL shows a thumbnail loaded from that address; you can turn previews off in the options

WHY CHROME SAYS "READ AND CHANGE ALL YOUR DATA ON ALL WEBSITES"
To recognise a JSON response, the extension has to look at every page you open. On ordinary pages it checks the page's content type and stops, without reading the page. On a JSON response it reads the response in order to display it. Nothing is sent anywhere.
```

### Screenshots and promo tiles
- `store/screenshots/01-tree-view.png` … `05-exact-big-numbers.png`: 1280×800, RGB, no alpha
- `store/promo/small-440x280.png` and `store/promo/marquee-1400x560.png`: RGB, no alpha
- All are captured from the real built extension by `store/capture/capture.mjs`, using fictional data in `store/capture/fixtures/`. Re-run it after any visible change to the viewer and commit what it writes:

```bash
npx wxt build
PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs CHROME="/path/to/Google Chrome for Testing" node store/capture/capture.mjs
```

### Category
Developer Tools

### Search Keywords
json viewer, json formatter, json tree view, json beautifier, pretty print json, jsonpath, json table, large json files, dark mode, api response viewer, developer tools
