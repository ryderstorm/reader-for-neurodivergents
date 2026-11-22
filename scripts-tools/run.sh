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

# Serve over https when TLS paths are configured or default certificates exist,
# so phones can install the reader as an app. Create defaults with ./scripts-tools/make-cert.sh
TLS_ARGS=()
SCHEME=http
if [ -n "${T2S_SSL_CERT:-}" ] && [ -n "${T2S_SSL_KEY:-}" ]; then
  TLS_ARGS=(--ssl-certfile "$T2S_SSL_CERT" --ssl-keyfile "$T2S_SSL_KEY")
  SCHEME=https
elif [ -f certs/server.crt ] && [ -f certs/server.key ]; then
  TLS_ARGS=(--ssl-certfile certs/server.crt --ssl-keyfile certs/server.key)
  SCHEME=https
fi

if [ "${OPEN:-1}" = "1" ]; then
  ( sleep 2; xdg-open "${SCHEME}://${HOST}:${PORT}" >/dev/null 2>&1 || true ) &
fi

if [ "$HOST" = "0.0.0.0" ]; then
  echo "Reachable from this network at:"
  ip -4 -o addr show scope global 2>/dev/null \
    | awk -v s="$SCHEME" -v p="$PORT" '{split($4,a,"/"); print "  " s "://" a[1] ":" p}'
fi

exec ./.venv/bin/python server/app.py \
  --host "$HOST" --port "$PORT" --device "$DEVICE" "${TLS_ARGS[@]}"
