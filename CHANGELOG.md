# Changelog

All notable changes to JSON Viewer Pro will be documented in this file.

## [0.8.0](https://github.com/brightbar-dev/json-viewer-pro/compare/json-viewer-pro-v0.7.0...json-viewer-pro-v0.8.0) (2026-09-24)


### Features

* ask for a store review once, after real use, with a separate link for problems ([#26](https://github.com/brightbar-dev/json-viewer-pro/issues/26)) ([65c9e1e](https://github.com/brightbar-dev/json-viewer-pro/commit/65c9e1eebf374d8a2dc97b43c56fcd035b1be4aa))

## [0.7.0](https://github.com/brightbar-dev/json-viewer-pro/compare/json-viewer-pro-v0.6.0...json-viewer-pro-v0.7.0) (2026-09-23)


### Features

* rename JSON Viewer Pro to Brightbar JSON Viewer ([#22](https://github.com/brightbar-dev/json-viewer-pro/issues/22)) ([3a49ad6](https://github.com/brightbar-dev/json-viewer-pro/commit/3a49ad6e5d50a23aefd94400b121a0fa827ee05a))

## [0.6.0](https://github.com/brightbar-dev/json-viewer-pro/compare/json-viewer-pro-v0.5.0...json-viewer-pro-v0.6.0) (2026-09-19)


### Features

* a viewer page for pasted, opened and dropped JSON, and a CI-enforced no-network check ([#14](https://github.com/brightbar-dev/json-viewer-pro/issues/14)) ([5f7f501](https://github.com/brightbar-dev/json-viewer-pro/commit/5f7f501230db1599f61c195f065f984ad19a62b9))
* design pass, popup tab status and a first-run welcome page ([#15](https://github.com/brightbar-dev/json-viewer-pro/issues/15)) ([2ef6f37](https://github.com/brightbar-dev/json-viewer-pro/commit/2ef6f37d04631628446f2f45a5656ca74f25ce57))
* JSONPath query bar and table view ([#13](https://github.com/brightbar-dev/json-viewer-pro/issues/13)) ([b7a8f36](https://github.com/brightbar-dev/json-viewer-pro/commit/b7a8f36dcdb0e9e75bcfe21231baa2570a14daeb))
* keyboard tree with path bar, copy as valid JSON, levels, sort keys, value hints and live settings ([#12](https://github.com/brightbar-dev/json-viewer-pro/issues/12)) ([621eeb4](https://github.com/brightbar-dev/json-viewer-pro/commit/621eeb403d71474d83b6d1a7bc22e52163314a86))


### Bug Fixes

* drop the retired Tailwind CSS Lookup from the cross-promotion links ([#9](https://github.com/brightbar-dev/json-viewer-pro/issues/9)) ([5db2dea](https://github.com/brightbar-dev/json-viewer-pro/commit/5db2deac9578ffef0b4f1c749ef2f8234e5753ba))


### Performance

* a rendering engine that never hangs — lazy virtualised tree, lossless numbers, error view, wider detection ([#11](https://github.com/brightbar-dev/json-viewer-pro/issues/11)) ([23e391e](https://github.com/brightbar-dev/json-viewer-pro/commit/23e391e5ecd1b0150fca7b24c1354abbb8eef713))

## [0.5.0](https://github.com/brightbar-dev/json-viewer-pro/compare/json-viewer-pro-v0.4.0...json-viewer-pro-v0.5.0) (2026-09-13)


### Features

* add large and marquee promo tiles, update small tile with new icon ([a0c83cc](https://github.com/brightbar-dev/json-viewer-pro/commit/a0c83cc9e51111093367e706ea44036ec6d8dbae))
* add search match count, filter mode, and keyboard shortcuts ([665eb12](https://github.com/brightbar-dev/json-viewer-pro/commit/665eb12ea006bb488baabc978c631c5b68668e8b))


### Bug Fixes

* **deps:** bump vitest to 4.1.11 to fix moderate path-traversal advisory ([#7](https://github.com/brightbar-dev/json-viewer-pro/issues/7)) ([6891896](https://github.com/brightbar-dev/json-viewer-pro/commit/68918968fa7c53a67542507cef4eb6840fd62e66))
* two latent type errors on main, and make CI actually typecheck ([989ef2b](https://github.com/brightbar-dev/json-viewer-pro/commit/989ef2bbd082e22d46ea8573bd2ffcc194251992))

## [0.4.0](https://github.com/brightbar-dev/json-viewer-pro/compare/json-viewer-pro-v0.3.0...json-viewer-pro-v0.4.0) (2026-04-01)


### Features

* add cross-promotion links to popup ([727b1fb](https://github.com/brightbar-dev/json-viewer-pro/commit/727b1fbb066fbabc0e2c6cbde0731b2d8717d89a))
* add store/cws.json for CWS submission metadata ([75a8ca8](https://github.com/brightbar-dev/json-viewer-pro/commit/75a8ca8d735d71756431c7d64d44052e95dee70c))
* redesign icon — JSON tree structure with { brace ([30b838b](https://github.com/brightbar-dev/json-viewer-pro/commit/30b838bd9cacf78796df09e02ebff266e085d525))

## [0.3.0](https://github.com/brightbar-dev/json-viewer-pro/compare/json-viewer-pro-v0.2.0...json-viewer-pro-v0.3.0) (2026-04-01)


### Features

* add 20-locale i18n for CWS discoverability ([222e1d2](https://github.com/brightbar-dev/json-viewer-pro/commit/222e1d280a652ce7391cf7efa1aca3dd1ba4cda2))
* optimize CWS listing title for search discoverability ([91a6e9f](https://github.com/brightbar-dev/json-viewer-pro/commit/91a6e9f817aeb9e5cf4b85fb6f253c23257e46d9))
* update CI for WXT, add separate release workflow ([cfa4b20](https://github.com/brightbar-dev/json-viewer-pro/commit/cfa4b201574dc397ee12dfb094378b61a36201d0))


### Bug Fixes

* update README with CWS install link and correct GitHub org URL ([2b8b805](https://github.com/brightbar-dev/json-viewer-pro/commit/2b8b805ef15101b4aef2820c80c5d07823e7475b))

## [0.2.0](https://github.com/brightbar-dev/json-viewer-pro/compare/v0.1.1...v0.2.0) (2026-03-06)


### Features

* update CI for WXT, add separate release workflow ([cfa4b20](https://github.com/brightbar-dev/json-viewer-pro/commit/cfa4b201574dc397ee12dfb094378b61a36201d0))

## [0.1.0] - 2026-02-24

### Added
- Auto-detect JSON pages using `document.contentType` with fallback heuristics
- Collapsible tree view with syntax highlighting
- Search across keys and values with match highlighting
- Copy individual values or JSONPath-style paths
- Toggle between formatted tree view and raw JSON
- Light, dark, and auto (system) themes
- URL detection — clickable links in string values
- File size display in toolbar
- Popup settings panel (enable/disable, theme selection)
- Options page for advanced settings
