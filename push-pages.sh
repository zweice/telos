#!/usr/bin/env bash
# push-pages.sh — Push latest telos-data.json to GitHub Pages (zweice/telos)
# Called automatically by `node src/cli.js viz`
# The web/ directory is a standalone git repo → zweice/telos on GitHub Pages

set -euo pipefail

WEB_DIR="$(dirname "$0")/web"

cd "$WEB_DIR"

# Only push if telos-data.json actually changed
if git diff --quiet telos-data.json 2>/dev/null; then
  echo "📊 telos-data.json unchanged — skipping push"
  exit 0
fi

git add telos-data.json
git commit -m "data: $(date '+%Y-%m-%d %H:%M') — auto-sync from viz"
git push origin main

echo "🚀 Pushed to https://zweice.github.io/telos/"
