#!/usr/bin/env python3
"""Retain the existing Python/JavaScript parity command's deterministic summary for paper evidence."""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESULTS = Path(__file__).resolve().parent / "results"
PATTERN = re.compile(r"^(?P<compared>\d+) cases compared, (?P<mismatches>\d+) mismatches, (?P<certified>\d+) certified$")


def main() -> None:
    completed = subprocess.run(
        [str(ROOT / ".venv/bin/python"), str(ROOT / "tools/refine-c/parity.py")],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    line = completed.stdout.strip()
    match = PATTERN.fullmatch(line)
    if not match:
        raise SystemExit(f"unexpected parity output: {line!r}")
    row = {key: int(value) for key, value in match.groupdict().items()}
    artifact = {
        "command": ".venv/bin/python tools/refine-c/parity.py",
        "stdout": line,
        "scope": "Historical case/draft corpus across claims versions; implementation conformance, not a claims-v2 generation rate.",
        **row,
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "parity.json").write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    (RESULTS / "parity.md").write_text(
        "# Python/JavaScript parity\n\n"
        f"`{line}`\n\n"
        "This is a historical mixed-version artifact corpus. It measures implementation conformance and is not a "
        "claims-version-2 generation success rate.\n",
        encoding="utf-8",
    )
    print(line)


if __name__ == "__main__":
    main()
