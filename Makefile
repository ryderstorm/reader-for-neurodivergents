.PHONY: setup run smoke test test-py test-js test-e2e lint format typecheck audit check

PYTHON ?= .venv/bin/python

setup:
	./scripts-tools/setup.sh

run:
	./scripts-tools/run.sh

smoke:
	./scripts-tools/smoke_test.sh

test-py:
	$(PYTHON) -m pytest

test-js:
	npm test

test-e2e:
	npm run test:e2e

test: test-py test-js

lint:
	$(PYTHON) -m ruff check server tests scripts-tools
	npm run lint
	npm run knip
	shellcheck scripts-tools/*.sh

format:
	$(PYTHON) -m ruff format --check server tests scripts-tools
	npm run format:check

typecheck:
	$(PYTHON) -m mypy server tests/python

audit:
	$(PYTHON) -m pip_audit
	npm audit

check: lint format typecheck test smoke test-e2e
