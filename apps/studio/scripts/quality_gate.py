#!/usr/bin/env python3
"""Run the local quality gate and distinguish pass, failure, and blockers."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def run(label: str, command: list[str]) -> str:
    completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False)
    if completed.stdout:
        print(completed.stdout, end="")
    if completed.stderr:
        print(completed.stderr, end="", file=sys.stderr)
    if completed.returncode == 0:
        print(f"[PASS] {label}")
        return "passed"
    combined = f"{completed.stdout}\n{completed.stderr}"
    if label == "browser E2E" and ("Executable doesn't exist" in combined or "Please run the following command to download new browsers" in combined):
        print(f"[BLOCKED] {label} — Playwright Chromium is not installed.")
        return "blocked"
    print(f"[FAIL] {label} — exit code {completed.returncode}")
    return "failed"


def main() -> int:
    checks: list[tuple[str, list[str]]] = [
        ("typecheck", ["npm", "run", "typecheck"]),
        ("lint", ["npm", "run", "lint"]),
        ("unit/integration tests", ["npm", "test"]),
        ("scene validation", ["npm", "run", "validate:scenes"]),
        ("production build", ["npm", "run", "build"]),
        ("build benchmark", ["npm", "run", "benchmark:build"]),
    ]
    results: dict[str, str] = {}
    for label, command in checks:
        results[label] = run(label, command)

    preflight = subprocess.run(["python3", "scripts/reconstruct_colmap.py", "preflight", "--json"], cwd=ROOT, text=True, capture_output=True, check=False)
    if preflight.stdout:
        print(preflight.stdout, end="")
    if preflight.stderr:
        print(preflight.stderr, end="", file=sys.stderr)
    if preflight.returncode != 0:
        results["reconstruction preflight"] = "failed"
        print(f"[FAIL] reconstruction preflight — exit code {preflight.returncode}")
    else:
        report = json.loads(preflight.stdout)
        missing_required = [name for name in ("colmap",) if not report["tools"][name]["available"]]
        missing_optional = [name for name in ("nvidia-smi",) if not report["tools"][name]["available"]]
        results["reconstruction preflight"] = "blocked" if missing_required else "passed"
        if missing_required:
            suffix = f"; optional diagnostics missing: {', '.join(missing_optional)}" if missing_optional else ""
            print(f"[BLOCKED] reconstruction preflight — missing required tools: {', '.join(missing_required)}{suffix}")
        elif missing_optional:
            print(f"[PASS] reconstruction preflight — optional diagnostics missing: {', '.join(missing_optional)}")
        else:
            print("[PASS] reconstruction preflight")

    results["browser E2E"] = run("browser E2E", ["npm", "run", "test:e2e"])
    print("\nQuality gate summary:")
    for label, status in results.items():
        print(f"- {status.upper():8} {label}")
    return 1 if "failed" in results.values() else 0


if __name__ == "__main__":
    raise SystemExit(main())
