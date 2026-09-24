#!/usr/bin/env bash
# Builds loadable extension folders and store-ready zips for both browsers
# from the single shared source in src/. Run this after any change to
# src/ or to firefox/manifest.json / chrome/manifest.json.
#
# Usage: ./build.sh
# Output: dist/firefox/  dist/chrome/  dist/site-wipe-firefox.zip  dist/site-wipe-chrome.zip

set -euo pipefail
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist/firefox dist/chrome

for browser in firefox chrome; do
  # shared source first...
  cp -R src/. "dist/$browser/"
  # ...then this browser's own manifest.json on top, since it's the one
  # file that legitimately differs (see README > "Why two manifests").
  cp "$browser/manifest.json" "dist/$browser/manifest.json"
done

( cd dist/firefox && zip -r -X -q "../site-wipe-firefox.zip" . -x '.*' )
( cd dist/chrome  && zip -r -X -q "../site-wipe-chrome.zip"  . -x '.*' )

echo "Built:"
echo "  dist/firefox/               (unpacked, for about:debugging or AMO upload)"
echo "  dist/chrome/                (unpacked, for chrome://extensions 'Load unpacked')"
echo "  dist/site-wipe-firefox.zip  (upload this to addons.mozilla.org)"
echo "  dist/site-wipe-chrome.zip   (upload this to the Chrome Web Store)"
