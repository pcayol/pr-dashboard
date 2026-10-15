#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npx tauri icon assets/icon.png -o src-tauri/icons
cd src-tauri/icons
rm -rf android ios Square*.png StoreLogo.png icon.ico 64x64.png
