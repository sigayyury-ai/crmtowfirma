#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${RENDER_API_KEY:-}" ]]; then
  echo "RENDER_API_KEY is not set" >&2
  exit 1
fi

if [[ -z "${RENDER_SERVICE_ID:-}" ]]; then
  echo "RENDER_SERVICE_ID is not set" >&2
  exit 1
fi

echo "Streaming logs for service ${RENDER_SERVICE_ID}..."
export RENDER_TOKEN="${RENDER_API_KEY}"
# Try full path first, then fallback to PATH
~/Library/Python/3.9/bin/render-cli logs "${RENDER_SERVICE_ID}" --tail --lines 200 2>&1 || \
  /usr/local/bin/render-cli logs "${RENDER_SERVICE_ID}" --tail --lines 200 2>&1 || \
  render-cli logs "${RENDER_SERVICE_ID}" --tail --lines 200 2>&1
