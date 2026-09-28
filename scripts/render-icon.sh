#!/bin/sh
# Renders resources/icon.svg to the 1024px PNG electron-builder turns into the
# app's .icns. Uses headless Chrome for accurate filters and a transparent
# background. Only needed after editing the SVG.
set -e
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

printf '<html><body style="margin:0;background:transparent">%s</body></html>' \
  "$(cat resources/icon.svg)" > "$TMP/icon.html"

"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --default-background-color=00000000 --window-size=1024,1024 \
  --screenshot="$TMP/icon.png" "file://$TMP/icon.html" >/dev/null 2>&1

cp "$TMP/icon.png" resources/icon.png
echo "wrote resources/icon.png"
