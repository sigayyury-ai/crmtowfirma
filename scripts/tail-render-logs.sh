#!/usr/bin/env bash

set -euo pipefail

# Загружаем переменные окружения из .env, если файл существует
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

if [[ -f "$ENV_FILE" ]]; then
  # Загружаем переменные из .env (игнорируем комментарии и пустые строки)
  export $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs)
fi

if [[ -z "${RENDER_API_KEY:-}" ]]; then
  echo "RENDER_API_KEY is not set" >&2
  echo "Проверьте файл .env в корне проекта" >&2
  exit 1
fi

if [[ -z "${RENDER_SERVICE_ID:-}" ]]; then
  echo "RENDER_SERVICE_ID is not set" >&2
  echo "Проверьте файл .env в корне проекта" >&2
  exit 1
fi

echo "Streaming logs for service ${RENDER_SERVICE_ID}..."
export RENDER_TOKEN="${RENDER_API_KEY}"
# Try full path first, then fallback to PATH
~/Library/Python/3.9/bin/render-cli logs "${RENDER_SERVICE_ID}" --tail --lines 200 2>&1 || \
  /usr/local/bin/render-cli logs "${RENDER_SERVICE_ID}" --tail --lines 200 2>&1 || \
  render-cli logs "${RENDER_SERVICE_ID}" --tail --lines 200 2>&1
