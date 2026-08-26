# JSON Viewer Pro

Clean, fast JSON viewer for Chrome. Automatically detects and formats JSON responses with a collapsible tree view, search, and syntax highlighting. No ads, no tracking, no donation popups.

## Features

- Auto-detect JSON pages in Chrome
- Collapsible tree view with syntax highlighting
- Search across keys and values, with a live match count
- Filter mode — hide every row that does not match the search
- Keyboard shortcuts — `/` or `Ctrl/Cmd+F` to search, `Esc` to clear, `e`/`c` to expand/collapse all
- Copy individual values or JSONPath-style paths
- Toggle between formatted tree view and the raw response body
- Light, dark, and auto (system) themes
- URL detection — clickable links in string values
- File size display

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `/` or `Ctrl/Cmd+F` | Focus the search box |
| `Esc` | Clear the search and unfocus |
| `e` | Expand all nodes |
| `c` | Collapse all nodes |

`Ctrl/Cmd+F` is handled by the viewer on purpose: the browser's own find cannot
reach text inside collapsed nodes, and the built-in search expands matches.

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

Tests run under Vitest with the WXT testing plugin. They live in
`tests/core.test.ts` and cover the exported pure helpers: JSON parsing, URL
detection, path generation, size formatting, search matching, filter
visibility, and keyboard-shortcut resolution.

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
