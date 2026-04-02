#!/bin/bash
# Ensure better-sqlite3 native module matches the running Node version.
# Called as ExecStartPre by telos-dashboard and telos-api services.
set -e

NODE="/home/linuxbrew/.linuxbrew/bin/node"
NPX="/home/linuxbrew/.linuxbrew/bin/npx"
TELOS_DIR="/home/jared/code/macrohard/telos"

# Quick check: does the module load?
if $NODE -e "require('$TELOS_DIR/node_modules/better-sqlite3')" 2>/dev/null; then
    exit 0
fi

echo "better-sqlite3 ABI mismatch — rebuilding with node-gyp for $($NODE --version)..."
cd "$TELOS_DIR/node_modules/better-sqlite3"
PATH="/home/linuxbrew/.linuxbrew/bin:$PATH" $NODE $NPX --yes node-gyp rebuild 2>&1
echo "Rebuild complete."

# Verify
$NODE -e "require('$TELOS_DIR/node_modules/better-sqlite3')" 2>/dev/null \
    && echo "✅ better-sqlite3 OK" \
    || { echo "❌ Rebuild failed"; exit 1; }
