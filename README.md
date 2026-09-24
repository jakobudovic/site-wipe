# Site Wipe

One click to clear cookies, cache storage, IndexedDB, local storage, and session storage - scoped to the exact site you're currently on. Nothing else, nowhere else, and never without asking first.

**Firefox:** _not yet published - link goes here once live on addons.mozilla.org_
**Chrome:** _not yet published - link goes here once live on the Chrome Web Store_

## Why

Browser DevTools can already show you this data, but clearing it site-by-site means digging through Storage panels by hand. Site Wipe puts a single button in the toolbar: open it on any site, pick what to clear, confirm, done.

## Features

- Scoped to the active tab's site only - never touches other domains, even ones with cookies on the same parent domain unless they genuinely apply to the site you're on.
- Shows a live count for each data type before you clear anything (`14 cookies`, `2 databases`, ...), so you know what you're about to delete.
- Always asks for confirmation - "Delete cookies, cache storage, and 3 more for example.com?" - before deleting anything.
- Reports what actually happened, including partial failures (e.g. a database that couldn't be deleted because it's still open in another tab), instead of assuming success.
- No telemetry, no network calls, no accounts. The extension never talks to anything except the tab it's running on.

## Install

### Firefox

Once published, install directly from the [Firefox listing](#) above. To run the current source locally instead:

1. `./build.sh` (see [Building](#building) below)
2. Open `about:debugging#/runtime/this-firefox`
3. **Load Temporary Add-on** → select `dist/firefox/manifest.json`

Temporary add-ons are removed when Firefox restarts. For a permanent local install without going through the add-on store, see [Mozilla's docs on signing an unlisted add-on](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

### Chrome

Once published, install directly from the [Chrome Web Store listing](#) above. To run the current source locally instead:

1. `./build.sh`
2. Open `chrome://extensions`
3. Enable **Developer mode** (top right)
4. **Load unpacked** → select `dist/chrome/`

Unlike Firefox, this stays installed permanently - Chrome doesn't require signing for unpacked/developer-mode extensions.

## Building

This repo has **one shared source** and **two thin per-browser manifests** - not two copies of the extension. `popup.html`, `popup.css`, `popup.js`, `background.js`, and the icons live once, in `src/`, and are identical for both browsers (`popup.js` detects `browser` vs `chrome` at runtime and works either way).

```
site-wipe/
├── src/                 # the actual extension - edit files here, never in dist/
│   ├── popup.html
│   ├── popup.css
│   ├── popup.js
│   ├── background.js
│   └── icons/
├── firefox/
│   └── manifest.json    # Firefox-only: browser_specific_settings, background.scripts
├── chrome/
│   └── manifest.json    # Chrome-only: background.service_worker
├── build.sh
└── dist/                 # generated - gitignored, never edit or commit
```

Run the build:

```bash
./build.sh
```

This copies `src/` into `dist/firefox/` and `dist/chrome/`, overlays each browser's own `manifest.json` on top, and zips both into store-ready packages:

- `dist/firefox/` and `dist/site-wipe-firefox.zip`
- `dist/chrome/` and `dist/site-wipe-chrome.zip`

### Why two manifests instead of one

Firefox and Chrome's Manifest V3 support diverges in exactly one place this extension cares about: how the background script is declared.

|              | Firefox                                                                                                   | Chrome                                                |
| ------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Background   | `"background": { "scripts": ["background.js"] }`                                                          | `"background": { "service_worker": "background.js" }` |
| Extra fields | `browser_specific_settings.gecko` (extension ID, min version, data-collection declaration for AMO review) | not used                                              |

`background.js` itself is written as a plain script with no `import`/module syntax, so the exact same file runs correctly as Firefox's classic background script and as Chrome's service worker - only the manifest key that points to it differs. Everything else in the manifests (`permissions`, `host_permissions`, `action`, `icons`, `description`) is identical and kept in sync by hand between `firefox/manifest.json` and `chrome/manifest.json`.

**If you're editing this project:** change extension behavior in `src/` only. The `dist/` folder is rebuilt from scratch every time you run `build.sh` and is not committed - anything you edit there is silently thrown away on the next build. If you need to change a permission or version number, edit it in _both_ `firefox/manifest.json` and `chrome/manifest.json`.

## Permissions, explained

| Permission                     | Why                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `cookies`                      | Read and remove cookies for the site you're on.                                                                                 |
| `activeTab`                    | Know which tab/site the popup was opened for.                                                                                   |
| `scripting`                    | Inject the small script that clears local storage, session storage, IndexedDB, and cache storage inside the page's own context. |
| `tabs`                         | Read the active tab's URL to determine the site's hostname.                                                                     |
| `host_permissions: <all_urls>` | Required so the above can act on whatever site you happen to be visiting - it is not used to access any site in the background. |

Site Wipe makes no network requests of its own and collects nothing. Its Firefox listing declares `data_collection_permissions: { required: ["none"] }` for exactly this reason.

## Publishing

Both stores require you to be a registered developer and to submit the built zip for review.

- **Firefox (AMO):** [addons.mozilla.org/developers](https://addons.mozilla.org/developers/) → Submit a New Add-on → choose **On your own** for unlisted/private distribution → upload `dist/site-wipe-firefox.zip` → declare no data collection → declare no build-step tooling was used (the source in the zip is exactly what runs).
- **Chrome Web Store:** [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (one-time $5 registration) → New Item → upload `dist/site-wipe-chrome.zip` → fill in the store listing and privacy practices disclosure → choose Public, Unlisted, or Private visibility.

After each is approved, replace the two placeholder links at the top of this README with the live store URLs.

## License

[MIT](./LICENSE)

## Author

Built by [YOUR_GITHUB_USERNAME](https://github.com/YOUR_GITHUB_USERNAME).
