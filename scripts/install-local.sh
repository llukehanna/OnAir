#!/bin/sh
# Builds OnAir and installs it into /Applications, replacing the old copy.
# Ad-hoc signed (no keychain prompt); built locally, so Gatekeeper doesn't
# quarantine it.
set -e
cd "$(dirname "$0")/.."

# Replacing a running bundle can leave it half-updated.
osascript -e 'quit app "OnAir"' 2>/dev/null || true

npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --arm64

# Replace the bundle outright: ditto merges into an existing one and would
# leave files from the old build behind. User data lives in
# ~/Library/Application Support/onair, not in the bundle.
rm -rf /Applications/OnAir.app
ditto dist/mac-arm64/OnAir.app /Applications/OnAir.app
open -a /Applications/OnAir.app
echo "installed /Applications/OnAir.app"
