#!/usr/bin/env bash
# push-pages.sh — Push latest telos-data.json to GitHub Pages (zweice/telos)
# Called automatically by `node src/cli.js viz`
# docs/ is part of the main telos repo — just commit + push from root

set -euo pipefail

REPO_DIR="$(dirname "$0")"

cd "$REPO_DIR"

# Only push if telos-data.json actually changed
if git diff --quiet docs/telos-data.json 2>/dev/null; then
  echo "📊 telos-data.json unchanged — skipping push"
  exit 0
fi

git add docs/telos-data.json
git commit -m "data: $(date '+%Y-%m-%d %H:%M') — auto-sync from viz"
git push origin main

echo "🚀 Pushed to https://zweice.github.io/telos/"
