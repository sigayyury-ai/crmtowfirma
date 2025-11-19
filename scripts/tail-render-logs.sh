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
npx --yes @render/cli logs "${RENDER_SERVICE_ID}" --tail --lines 200 --api-key "${RENDER_API_KEY}"
