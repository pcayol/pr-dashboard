#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
APP="src-tauri/target/release/bundle/macos/PR Dashboard.app"
DEST="/Applications/PR Dashboard.app"

npm run app:build
osascript -e 'quit app "PR Dashboard"' 2>/dev/null || true
while pgrep -f "PR Dashboard.app/Contents/MacOS/node" >/dev/null; do sleep 0.5; done
rm -rf "$DEST"
ditto "$APP" "$DEST"
echo "Installed $DEST"
