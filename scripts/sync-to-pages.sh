#!/bin/bash
# Regenerate telos-data.json and push to GitHub Pages
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TELOS_DIR="$(dirname "$SCRIPT_DIR")"
cd "$TELOS_DIR"
node src/cli.js viz
cd web
git add telos-data.json
git diff --staged --quiet && echo 'No changes to sync' && exit 0
git commit -m "chore: auto-sync telos data $(date '+%Y-%m-%d %H:%M')"
git push
echo 'Synced to GitHub Pages'
