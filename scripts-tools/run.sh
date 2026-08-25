#!/usr/bin/env bash
# Start the local reader and open it in the browser.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8765}
HOST=${HOST:-127.0.0.1}
DEVICE=${T2S_DEVICE:-auto}

if [ ! -x .venv/bin/python ]; then
  echo "!! No virtualenv found. Run ./scripts-tools/setup.sh first."; exit 1
fi

if [ "${OPEN:-1}" = "1" ]; then
  ( sleep 2; xdg-open "http://${HOST}:${PORT}" >/dev/null 2>&1 || true ) &
fi

exec ./.venv/bin/python server/app.py --host "$HOST" --port "$PORT" --device "$DEVICE"
