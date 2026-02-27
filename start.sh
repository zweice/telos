#!/bin/bash
# start.sh — Initialize DB (if needed) and start server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Initialize DB if it doesn't exist
if [ ! -f telos.db ]; then
  echo "🔨 Initializing Telos database..."
  node src/cli.js init
fi

# Check if port 8088 is in use
if lsof -Pi :8088 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "⚠️  Port 8088 is already in use. Stopping existing process..."
  pkill -f "node server.js" || true
  sleep 1
fi

echo "🚀 Starting Telos dashboard server on http://localhost:8088..."
echo "🔍 View at: http://localhost:8088"
exec node server.js
