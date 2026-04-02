#!/bin/bash
# Ensure better-sqlite3 native module matches the running Node version.
set -e

NODE="/home/linuxbrew/.linuxbrew/bin/node"
NPX="/home/linuxbrew/.linuxbrew/bin/npx"
TELOS_DIR="/home/jared/code/macrohard/telos"
RELEASE_DIR="$TELOS_DIR/node_modules/better-sqlite3/build/Release"

# Quick check: does the module load?
if $NODE -e "require('$TELOS_DIR/node_modules/better-sqlite3')" 2>/dev/null; then
    exit 0
fi

echo "better-sqlite3 ABI mismatch — rebuilding for $($NODE --version)..."

# Delete old binaries (hardlinks cause rebuild to silently fail)
rm -f "$RELEASE_DIR/better_sqlite3.node"
rm -f "$RELEASE_DIR/obj.target/better_sqlite3.node"

cd "$TELOS_DIR/node_modules/better-sqlite3"
PATH="/home/linuxbrew/.linuxbrew/bin:$PATH" $NODE $NPX --yes node-gyp rebuild 2>&1

# Verify
$NODE -e "require('$TELOS_DIR/node_modules/better-sqlite3')" 2>/dev/null \
    && echo "✅ better-sqlite3 OK" \
    || { echo "❌ Rebuild failed"; exit 1; }
