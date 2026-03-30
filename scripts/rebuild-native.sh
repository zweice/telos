#!/bin/bash
# Run after any Node.js upgrade to recompile native modules
set -e
BREW_NODE=/home/linuxbrew/.linuxbrew/bin/node
BREW_GYUP=/home/linuxbrew/.linuxbrew/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js

echo "Rebuilding better-sqlite3 for Node $($BREW_NODE --version)..."
cd "$(dirname "$0")/.."
$BREW_NODE $BREW_GYUP rebuild --directory node_modules/better-sqlite3
echo "Done. Testing..."
$BREW_NODE -e "require('better-sqlite3'); console.log('better-sqlite3 OK')"
