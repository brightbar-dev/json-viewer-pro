# Compare view (two-pane JSON diff) — report

Branch `claude/jvp-diff-1007-j1oof0`. This file is harvested and should be removed before merge, together with `report-assets/`.

## What was built

A **Compare** screen on the extension's own viewer page (`viewer.html`).

- **Entry points:** *Compare…* on the editor screen (left starts with whatever is in the box) and *Compare with…* while a document is shown in the viewer (left starts with that document). Close compare returns to where you were.
- **Inputs:** two text boxes. Each side takes pasted text, *Open file…*, or a file dropped on it. JSON, JSONC and NDJSON work, with live validation and the line and column of any error. Files over 2 MB skip the text box, as in the main editor. *Swap sides* is there too.
- **Result:** one aligned list. Each row has a left cell and a right cell, so added and removed items leave a hatched gap on the other side, and the two sides scroll together by construction.
  - Changes are marked with `+`, `−` and `~` glyphs as well as colour. Key-order-only differences are marked `⇅`.
  - The tree is collapsible. Changed containers open first, up to about 1,500 rows, and unchanged ones stay closed, with item counts and a "N changes" badge when collapsed.
  - Strings over 300 characters are cut in the cell, and the cell says how many characters are missing.
- **Options:** *Ignore key order* (on by default), *Arrays as unordered sets* (off by default; array order by index otherwise), and *Changes only*. The first two re-run the diff, and *Changes only* is a view filter.
- **Navigation:** `N` / `F3` / `Alt+↓` for the next difference and `P` / `Shift+F3` / `Alt+↑` for the previous one. They wrap and announce "Difference 3 of 8: …" in a live region. The usual tree keys also work (arrows, Home/End, PageUp/PageDown, `*`, Enter/Space), and Previous/Next buttons are provided.
- **JSON Patch:** *Copy JSON Patch* copies an RFC 6902 patch (`add` / `remove` / `replace`, JSON Pointer paths with `~0` / `~1` escaping) that turns the left document into the right one. Exact big numbers are written verbatim.

### How it works (`lib/`)

- `diff.ts` — pure diff engine. It keeps nodes only for what differs. Equal and added/removed subtrees are expanded lazily from their values, so memory and the patch walk scale with the number of changes. Numbers compare by exact value (`1` equals `1.0`; `…890` does not equal `…891`).
  - Unordered mode cancels equal items using a canonical string, pairs the leftovers in order as "changed", and reports any surplus as added or removed.
  - `toPatch` orders operations so indexes stay valid: edits, then removals from the end, then additions.
- `diffmodel.ts` — pure row model: flat visible rows, expand/collapse patched in place, changes-only filter, and `step()` for next/previous (works from any selected row, including collapsed and closing rows).
- `compare.ts` + `compare.css` + markup in `entrypoints/viewer/index.html` — DOM. The list is virtualised with a fixed row height and the same compressed-scroll approach as the tree view for very tall lists.
- `lossless.ts`: one word changed (`canonical` is now exported).

## Against the competitors

I could not browse the competitors in this sandbox (offline), so this is a design comparison from what such tools are known to offer. It is not a measured side-by-side.

- **Typical diff sites and editor "compare" views:** side-by-side text diff of two textareas, often needing both sides formatted, with key sorting as an option. Many compare only line text.
- **This view** is structural. Formatting and key order are irrelevant, and the real object paths are known, which is what makes the patch and the "unordered set" mode possible. Arrays can be compared by index or as sets, big integers compare exactly, only visible rows are rendered, there is a keyboard-driven next/previous with announcements, and the result is exportable as a patch.
- **Accessibility:**
  - Native labelled checkboxes and buttons, and a `tree` / `treeitem` list with `aria-activedescendant`.
  - Each row has a sentence `aria-label` such as "key role changed from "admin" to "owner"".
  - Colour is never the only signal: there are glyphs and hatched gaps.
  - Visible focus rings, and a forced-colors fallback.
  - `tests/contrast.test.ts` now also holds every text colour to 4.5:1 on the new added/removed backgrounds in both themes, and the +/− marker colours on theirs.
- **Free:** no tier, trial, badge or upsell.

## Validation (exact commands, results)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | OK (lockfile and `package.json` untouched) |
| `pnpm test` | 22 files, **569 tests passed**. New: `tests/diff.test.ts` (42), `tests/diffmodel.test.ts` (15), and the contrast additions. |
| `pnpm exec tsc --noEmit` | pass |
| `pnpm exec wxt build` and `pnpm exec wxt build --browser firefox` | both succeed. The Chrome manifest is unchanged: permissions `["storage"]` only, no host permissions. |
| `node scripts/check-privacy.mjs .output/chrome-mv3 .output/firefox-mv2` | "Privacy check passed". `ALLOW` is unchanged. |
| `PLAYWRIGHT=/opt/node22/lib/node_modules/playwright/index.mjs CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node tests/e2e/compare.mjs .output/chrome-mv3 report-assets` | **30 of 30 expectations passed** (Chromium with the unpacked extension) |

The e2e case (`tests/e2e/compare.mjs`) is local only, like `perf.mjs`, because CI has no browser. It covers the main path (paste, Ctrl+Enter, summary, N/P/F3 with wrap, aria-activedescendant, exact big numbers, Changes only, unordered arrays, patch copy, both themes, and Compare from the editor and from the viewer) and a large pair.

**Large pair:** two 11.4 MB files (40,000 records each, 6 differences) loaded from files.

- First result in about 3.0 s, including parsing both files, validating them, diffing and rendering.
- Longest main-thread block about 250 ms.
- 41 row elements in the DOM for about 40,000 rows.
- Next-difference in about 120 ms, and 20 PageDowns in about 30 ms.

Screenshots: `report-assets/compare-light.png`, `report-assets/compare-dark.png`.

## Choices made (unattended run)

- **Where it lives:** the viewer page only. The content script on ordinary JSON tabs is unchanged, so no permission is needed.
- **Defaults:** key order ignored and arrays compared by index, which matches what most people expect from a JSON diff.
- **Unordered mode pairing:** leftovers are paired in order, so an edited record in a set reads as one change. This is a heuristic, not a similarity match, and the patch is always a correct transformation.
- **Unordered-array patches:** they make the array equal to the right one *as a collection*. Surplus items are appended with `/-`, so positions can differ from the right document. This is stated in the code.
- **Key order and patches:** with *Ignore key order* off, a pure reorder counts as a difference but produces no patch operation, because RFC 6902 object members are unordered.
- **Equal subtrees:** both sides show the left document's value.
- **Strings:** no i18n files were touched. The repo keeps UI strings in HTML, and only the store name and description are in `_locales`.

## Not done, and why

- **"Another open viewer tab's document":** skipped. The brief said "if simple", and it is not simple without a cross-tab protocol and a picker. A document from an ordinary JSON tab (content script) cannot be passed without extra plumbing (messaging or `storage.session`, which Firefox MV2 lacks).
- **Comparing straight from a JSON tab's toolbar:** not built, for the same reason. Use the viewer page, or paste.
- **Nesting limit:** documents nested deeper than the JS stack (on the order of 10⁴ levels) report "nested too deeply to compare" instead of crashing. The tree view itself has no such limit, and the diff is recursive.
- **Browsers:** the e2e ran in Chromium only. Firefox MV2 builds and passes the privacy check, but it was not run in a browser.
- **Docs:** `CLAUDE.md` was not edited, because this brief did not ask for it. It should get an architecture note about `lib/diff.ts`, `diffmodel.ts` and `compare.ts`.
