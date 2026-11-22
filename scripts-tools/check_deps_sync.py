#!/usr/bin/env python3
"""Verify production pins in server/requirements.txt match uv.lock for Python 3.12."""

from __future__ import annotations

import re
import sys
from pathlib import Path

import tomllib
from packaging.markers import Marker
from packaging.utils import canonicalize_name

ROOT = Path(__file__).resolve().parents[1]
REQ_FILE = ROOT / "server" / "requirements.txt"
LOCK_FILE = ROOT / "uv.lock"

PIN_RE = re.compile(r"^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?==([^\s;#]+)")
TARGET_ENV = {
    "python_version": "3.12",
    "python_full_version": "3.12.0",
    "sys_platform": "linux",
}


def _matches_target_env(pkg: dict[str, object]) -> bool:
    markers = pkg.get("resolution-markers")
    if not isinstance(markers, list) or not markers:
        return True
    return any(isinstance(m, str) and Marker(m).evaluate(TARGET_ENV) for m in markers)


def load_lock_versions(lock_path: Path) -> dict[str, set[str]]:
    data = tomllib.loads(lock_path.read_text(encoding="utf-8"))
    packages = data.get("package", [])
    versions: dict[str, set[str]] = {}
    if isinstance(packages, list):
        for pkg in packages:
            if not isinstance(pkg, dict) or not _matches_target_env(pkg):
                continue
            name = pkg.get("name")
            version = pkg.get("version")
            if isinstance(name, str) and isinstance(version, str):
                versions.setdefault(canonicalize_name(name), set()).add(version)
    return versions


def main() -> int:
    lock_versions = load_lock_versions(LOCK_FILE)
    mismatches: list[str] = []
    checked = 0

    for lineno, raw_line in enumerate(REQ_FILE.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue

        req_part, _, marker_part = line.partition(";")
        if marker_part.strip():
            marker = Marker(marker_part.strip())
            if not marker.evaluate(TARGET_ENV):
                continue

        match = PIN_RE.match(req_part.strip())
        if not match:
            mismatches.append(f"server/requirements.txt:{lineno}: unpinned requirement {line!r}")
            continue

        pkg_name = canonicalize_name(match.group(1))
        pinned = match.group(2)
        checked += 1
        locked = lock_versions.get(pkg_name, set())
        if pinned not in locked:
            mismatches.append(
                f"server/requirements.txt:{lineno}: {pkg_name}=={pinned} does not match "
                f"uv.lock ({sorted(locked) or ['missing']})"
            )

    if mismatches:
        for err in mismatches:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1

    print(f"Verified {checked} production pin(s) in server/requirements.txt match uv.lock.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
