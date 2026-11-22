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

# Reject an already-occupied port so probes always verify the child we launch.
if "$PY" -c "import socket, sys; s = socket.socket(); s.settimeout(0.5); rc = s.connect_ex(('127.0.0.1', int(sys.argv[1]))); s.close(); sys.exit(0 if rc == 0 else 1)" "$PORT"; then
  echo "Smoke test port ${PORT} is already in use; set SMOKE_PORT to an unused port." >&2
  exit 1
fi

env -u T2S_SSL_CERT -u T2S_SSL_KEY HF_HUB_OFFLINE=1 "$PY" server/app.py --host 127.0.0.1 --port "$PORT" --no-warm &
PID=$!
cleanup() {
  kill "$PID" >/dev/null 2>&1 || true
  wait "$PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 40); do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Smoke test server exited before becoming healthy." >&2
    exit 1
  fi
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done

if [ "$ready" -ne 1 ] || ! kill -0 "$PID" 2>/dev/null; then
  echo "Smoke test server did not become healthy on http://127.0.0.1:${PORT}." >&2
  exit 1
fi

curl -fsS "http://127.0.0.1:${PORT}/api/health" | grep -q '"ok":true'
curl -fsS "http://127.0.0.1:${PORT}/api/metrics" | grep -q 'read_aloud_speak_requests_total'
curl -fsS "http://127.0.0.1:${PORT}/" | grep -q 'manifest.webmanifest'
kill -0 "$PID" 2>/dev/null
echo "Smoke test passed on http://127.0.0.1:${PORT}"
