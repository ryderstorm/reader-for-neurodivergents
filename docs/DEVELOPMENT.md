# Development Guide

Exact commands for setting up, running, testing, linting, and type-checking this repository locally without Docker.

## Prerequisites

- Python 3.12 (Kokoro 0.9.4 supports 3.10–3.12; `Dockerfile` targets 3.12)
- `uv` (or `python3.12 -m venv` + `pip`)
- Node.js 22+ and `npm`
- `shellcheck` (for shell script linting)

## Setup

Fast headless dev/test setup (no PyTorch/Kokoro download required for unit, smoke, and e2e tests):

```bash
uv sync --python 3.12
npm ci
.venv/bin/pre-commit install --hook-type pre-commit --hook-type commit-msg
```

Full host setup including PyTorch, Kokoro-82M weights (~330 MB), spaCy model, and Node dependencies:

```bash
make setup
```

For CPU-only PyTorch on the host (~500 MB instead of ~5 GB CUDA wheels):

```bash
T2S_CPU_ONLY=1 ./scripts-tools/setup.sh
```

## Run Locally

Start the server on `http://127.0.0.1:8765`:

```bash
make run
```

Start without warming Kokoro (useful for UI, metrics, or API contract checks):

```bash
HF_HUB_OFFLINE=1 .venv/bin/python server/app.py --host 127.0.0.1 --port 8765 --no-warm
```

## Tests

Run all offline unit tests with ≥75% coverage enforcement (Python + JavaScript):

```bash
make test
```

Run a single suite or a single test case:

```bash
make test-py
.venv/bin/pytest tests/python/test_app_api.py -k health

make test-js
node --test --test-name-pattern "splitSentences" tests/js/document_and_player.test.mjs
```

Run the smoke test (starts the server, probes `/api/health`, `/api/metrics`, and `/`, then shuts down):

```bash
make smoke
```

Run the headless live-server end-to-end test:

```bash
make test-e2e
```

Run hardware TTS alignment verification (requires full `make setup` with Kokoro installed):

```bash
.venv/bin/python scripts-tools/check_timestamps.py
node scripts-tools/test_frontend.mjs http://127.0.0.1:8765
```

## Lint, Format, Typecheck, and Security Audit

```bash
make lint
make format
make typecheck
make audit
make check
```

Run all pre-commit hooks across the repository:

```bash
.venv/bin/pre-commit run --all-files
```
