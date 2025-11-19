#!/usr/bin/env bash

# Simple helper to start the dev server on a configurable port/host.
# Usage:
#   ./scripts/start-server.sh               # defaults PORT=3000 HOST=0.0.0.0
#   PORT=4000 ./scripts/start-server.sh
#   PORT=4000 HOST=127.0.0.1 ./scripts/start-server.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PORT="${PORT:-3000}"
export HOST="${HOST:-0.0.0.0}"

echo "🚀 Starting dev server (HOST=$HOST PORT=$PORT)..."
npm run dev
