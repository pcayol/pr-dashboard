#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for skill in pr-brief deep-review; do
  rm -rf "claude-plugin/skills/$skill"
  cp -R "$HOME/.claude/skills/$skill" "claude-plugin/skills/$skill"
done
echo "Skills copied into claude-plugin/skills"
