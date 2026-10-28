#!/usr/bin/env python3
"""Run the local quality gate and distinguish pass, failure, and blockers.

T25 additions (additive taxonomy — the original check list and pass/fail/
blocked meanings are unchanged):

- `source heuristics`: four heuristic lint rules over `src/` (accepted
  tradeoff per the T25 contract — these are greps, not a type system):
    R1 legacy token grep hits (the pre-MERIDIAN identity: palette hexes and
       font names that tests/tokens.test.ts also bans);
    R2 `%`-style coverage strings ("92 % complete") in TS/TSX — comments and
       CSS are excluded because docs that describe the ban and layout
       percentages must not trip it;
    R3 un-revoked object-URL pattern (a file creates object URLs but never
       revokes any — the registry in src/lib/objectUrls.ts holds both halves
       so it passes by construction);
    R4 missing `SIMULATED` chip derivation (the chip literal appears in
       `src/` but nothing derives it from `manifest.sceneKind`).
- `bundle chunk budgets`: scripts/check_chunks.py — entry gzip budget and
  separate-lazy-chunk attribution for heavy libraries (run after a build).
- `vitest suite inventory`: ADVISORY only — prints which of the 17 spec-listed
  unit suites are absent. It never affects the exit code because those files
  are owned by other tasks; `npm test` below always runs every suite that
  exists, so new suites are included automatically the moment they land.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------- T25 heuristics

# R1 — pre-MERIDIAN identity, banned in the token layer (mirrors tests/tokens.test.ts).
LEGACY_TOKEN_PATTERN = re.compile(r"0d100f|e9a54f|manrope|dm mono", re.IGNORECASE)

# R2 — "%"-style coverage strings. Only the pairs below are banned; a bare
# percentage (CSS, modulo arithmetic) is fine.
PERCENT_COVERAGE_PATTERN = re.compile(
    r"\d{1,3}\s?%\s*(complete|coverage)\b|(?i:\b(?:coverage|completeness)\b[^\n]{0,30}?\d{1,3}\s?%)"
)

SOURCE_SUFFIXES = (".ts", ".tsx")


def _source_files(src_root: Path) -> list[Path]:
    return sorted(path for path in src_root.rglob("*") if path.suffix in SOURCE_SUFFIXES)


def _strip_comments(line: str) -> str:
    """Remove `//` and trailing comment fragments (heuristic; see module doc)."""
    if line.lstrip().startswith(("//", "/*", "*")):
        return ""
    return re.split(r"//", line, maxsplit=1)[0]


def scan_legacy_tokens(src_root: Path) -> list[str]:
    """R1 — hit list for the banned pre-MERIDIAN palette/font tokens."""
    hits: list[str] = []
    for path in sorted(src_root.rglob("*")):
        if not path.is_file() or path.suffix not in (*SOURCE_SUFFIXES, ".css"):
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if LEGACY_TOKEN_PATTERN.search(line):
                hits.append(f"{path.relative_to(src_root)}:{number}: {line.strip()[:120]}")
    return hits


def scan_percent_coverage_strings(src_root: Path) -> list[str]:
    """R2 — "%"-style coverage strings in TS/TSX, excluding comments."""
    hits: list[str] = []
    for path in _source_files(src_root):
        for number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if PERCENT_COVERAGE_PATTERN.search(_strip_comments(line)):
                hits.append(f"{path.relative_to(src_root)}:{number}: {line.strip()[:120]}")
    return hits


def scan_unrevoked_object_urls(src_root: Path) -> list[str]:
    """R3 — files that create object URLs but never revoke one."""
    hits: list[str] = []
    for path in _source_files(src_root):
        text = path.read_text(encoding="utf-8", errors="replace")
        creates = ("URL.createObjectURL", "createObjectUrl(")
        revokes = ("URL.revokeObjectURL", "revokeObjectUrl", "revokeAllObjectUrls")
        if any(marker in text for marker in creates) and not any(marker in text for marker in revokes):
            hits.append(f"{path.relative_to(src_root)}: creates object URLs but never revokes")
    return hits


def scan_simulated_derivation(src_root: Path) -> list[str]:
    """R4 — the SIMULATED chip literal must be derived from manifest.sceneKind."""
    chip_files: list[Path] = []
    derived = False
    for path in _source_files(src_root):
        text = path.read_text(encoding="utf-8", errors="replace")
        if re.search(r"[>\"']\s*◇?\s*SIMULATED", text):
            chip_files.append(path)
        if re.search(r"sceneKind\s*===|manifest\.sceneKind|provenance\.source", text):
            derived = True
    if chip_files and not derived:
        return [f"{path.relative_to(src_root)}: SIMULATED chip present but no sceneKind/provenance derivation in src/"]
    return []


# Spec-listed V1 unit suites (V1_SPEC.md §5). Advisory inventory only.
EXPECTED_VITEST_SUITES = (
    "tokens", "icons", "ui-primitives", "coverage", "state-machine", "rooms-viewgroups",
    "storage", "capture-ingest", "bundle-integrity", "engine-tween", "poi-search",
    "pairing-protocol", "signalling-relay", "qr", "scan-capture", "scan-visualizer", "motion-reduced",
)


def missing_expected_suites(tests_dir: Path) -> list[str]:
    present = {path.name.removesuffix(".test.tsx").removesuffix(".test.ts") for path in tests_dir.glob("*.test.ts*")}
    return [suite for suite in EXPECTED_VITEST_SUITES if suite not in present]


HEURISTIC_SCANS = (
    ("R1 legacy token grep", scan_legacy_tokens),
    ("R2 %-style coverage strings", scan_percent_coverage_strings),
    ("R3 un-revoked object URLs", scan_unrevoked_object_urls),
    ("R4 SIMULATED chip derivation", scan_simulated_derivation),
)


def run_source_heuristics() -> str:
    src_root = ROOT / "src"
    status = "passed"
    for label, scanner in HEURISTIC_SCANS:
        hits = scanner(src_root)
        if hits:
            status = "failed"
            print(f"[FAIL] {label} — {len(hits)} hit(s)")
            for hit in hits[:20]:
                print(f"       {hit}")
        else:
            print(f"[PASS] {label}")
    return status


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
        ("bundle chunk budgets", ["python3", "scripts/check_chunks.py"]),
    ]
    results: dict[str, str] = {}
    results["source heuristics"] = run_source_heuristics()
    for label, command in checks:
        results[label] = run(label, command)

    # Advisory: spec-listed suite inventory. Never affects the exit code.
    missing = missing_expected_suites(ROOT / "tests")
    if missing:
        print(f"[ADVISORY] vitest suite inventory — not yet present (owned by other tasks): {', '.join(missing)}")
    else:
        print("[PASS] vitest suite inventory — all 17 spec-listed suites present")

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
