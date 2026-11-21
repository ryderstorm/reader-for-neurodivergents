#!/usr/bin/env bash
# Smoke test: start the FastAPI server, probe /api/health, /api/metrics, and /,
# then stop the server cleanly.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${SMOKE_PORT:-18766}"
PY=".venv/bin/python"
if [ ! -x "$PY" ]; then
  PY="python3"
fi

HF_HUB_OFFLINE=1 "$PY" server/app.py --host 127.0.0.1 --port "$PORT" --no-warm &
PID=$!
trap 'kill "$PID" >/dev/null 2>&1 || true; wait "$PID" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

curl -fsS "http://127.0.0.1:${PORT}/api/health" | grep -q '"ok":true'
curl -fsS "http://127.0.0.1:${PORT}/api/metrics" | grep -q 'read_aloud_speak_requests_total'
curl -fsS "http://127.0.0.1:${PORT}/" | grep -q 'manifest.webmanifest'
echo "Smoke test passed on http://127.0.0.1:${PORT}"
