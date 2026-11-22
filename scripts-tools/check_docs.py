#!/usr/bin/env python3
"""Verify that relative links in AGENTS.md, README.md, and docs/ resolve on disk."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
SKIP_PREFIXES = ("http://", "https://", "mailto:", "#")


def check_file(doc: Path) -> list[str]:
    """Return missing relative link targets referenced from a Markdown file."""
    errors: list[str] = []
    in_fence = False
    for lineno, line in enumerate(doc.read_text(encoding="utf-8").splitlines(), start=1):
        if line.strip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        for raw_target in LINK_RE.findall(line):
            cleaned = raw_target.strip()
            if cleaned.startswith("<") and ">" in cleaned:
                dest = cleaned[1 : cleaned.index(">")].strip()
            else:
                dest = cleaned.split(None, 1)[0] if cleaned else ""
            target = dest.split("#", 1)[0]
            if not target or target.startswith(SKIP_PREFIXES):
                continue
            resolved = (doc.parent / target).resolve()
            if not resolved.exists():
                rel = doc.relative_to(ROOT)
                errors.append(f"{rel}:{lineno} broken link -> {target}")
    return errors


def main() -> int:
    docs: list[Path] = []
    for name in ("AGENTS.md", "README.md"):
        candidate = ROOT / name
        if candidate.is_file():
            docs.append(candidate)
    docs_dir = ROOT / "docs"
    if docs_dir.is_dir():
        for md in sorted(docs_dir.glob("*.md")):
            docs.append(md)

    failures: list[str] = []
    for doc in docs:
        failures.extend(check_file(doc))

    if failures:
        for err in failures:
            print(err, file=sys.stderr)
        return 1

    print(f"Verified relative links across {len(docs)} documentation file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
