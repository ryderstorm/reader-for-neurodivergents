#!/usr/bin/env bash
# One-time setup: virtualenv, Python deps, and the spaCy model misaki needs.
set -euo pipefail
cd "$(dirname "$0")/.."

PY=${PYTHON:-python3}
echo "==> Python: $($PY --version)"
case "$($PY -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')" in
  3.10|3.11|3.12) ;;
  *) echo "!! kokoro 0.9.4 supports Python 3.10-3.12. Set PYTHON=python3.12 and retry."; exit 1 ;;
esac

[ -d .venv ] || $PY -m venv .venv
./.venv/bin/pip install -q -U pip wheel
if [ "${T2S_CPU_ONLY:-0}" = "1" ]; then
  echo "==> Installing the CPU-only PyTorch build (~500 MB instead of ~5 GB)"
  ./.venv/bin/pip install -q torch --index-url https://download.pytorch.org/whl/cpu
fi

echo "==> Installing dependencies (PyTorch pulls ~5 GB of CUDA wheels by default)"
./.venv/bin/pip install -q -r server/requirements.txt

# misaki's English G2P uses spaCy for part-of-speech disambiguation
# ("read" past vs present). Without this it downloads on first use.
echo "==> Installing the spaCy English model"
./.venv/bin/pip install -q \
  "https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"

echo "==> Pre-downloading Kokoro-82M and verifying word timings"
./.venv/bin/python scripts-tools/check_timestamps.py

if command -v npm >/dev/null 2>&1 && [ -f package-lock.json ]; then
  echo "==> Installing Node test and lint dependencies"
  npm ci --no-audit --no-fund
fi

echo
echo "Setup complete.  Start the reader with:  ./scripts-tools/run.sh"
