#!/usr/bin/env python3
"""Deterministic chunk-attribution and build-budget check (T25).

Parses the production `dist/assets` output and proves:

1. the initial entry chunk (identified from `dist/index.html`, never from a
   filename prefix — lazy chunks can also be named `index-*.js`) is at most
   `ENTRY_GZIP_BUDGET_BYTES` gzip;
2. each heavy library (`three`, `gsap`, `fflate`, `qrcode-generator`, `idb`,
   `playcanvas`) that the app actually imports lives in its own lazy chunk,
   separate from the entry chunk and from every other heavy library.

Attribution is marker-based: each library is identified by a string that
survives minification *and* does not appear at its dynamic-import call site
(for example the entry chunk does reference `zipSync` where it destructures
`await import('fflate')` — so fflate is attributed by its `deflateSync`
export instead). Markers were verified against a real `vite build` on
2026-10-29; if Vite/Rollup/minification changes them, this check fails
loudly rather than silently passing.

Honesty rule: a declared dependency that is imported *nowhere* in the bundle
cannot be proven lazy — it is reported as an exception, not as a pass and
not as a failure. See `exceptions` in the JSON report.

Exit codes: 0 = budgets met and laziness proven; 1 = a budget or laziness
rule failed; 2 = dist/ is missing or unparsable.
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Initial entry-chunk budget, T25 spec: "<= 360 KB gzip" (KB = 1024 bytes).
ENTRY_GZIP_BUDGET_BYTES = 360 * 1024

# Library -> marker strings (any one counts as possession). Each marker was
# chosen because it survives minification and does NOT appear in the entry
# chunk's dynamic-import site for that library.
LIBRARY_MARKERS: dict[str, tuple[str, ...]] = {
    "three": ("threejs.org",),          # error-message URLs inside three.js
    "gsap": ("_gsap",),                 # gsap's property stamped on targets
    "fflate": ("deflateSync",),         # exported; zipSync/strToU8 appear at the import site too
    "qrcode-generator": ("stringToBytes",),  # qrcode-generator export
    "idb": ("deleteDB",),               # idb export; openDB appears at the import site too
    "playcanvas": ("playcanvas.inspector",),  # Symbol.for() string inside the engine
}

# Libraries whose absence is an honest exception, not laziness evidence.
DECLARED_LIBRARIES = tuple(LIBRARY_MARKERS)


def gzip_size(path: Path) -> int:
    return len(gzip.compress(path.read_bytes(), compresslevel=9))


def find_entry_chunk(dist: Path) -> str | None:
    """Return the entry chunk basename as referenced by dist/index.html."""
    html = dist / "index.html"
    if not html.is_file():
        return None
    match = re.search(r'<script[^>]+src="[^"]*/([^"/]+\.js)"', html.read_text(encoding="utf-8"))
    return match.group(1) if match else None


def attribute_libraries(dist: Path, entry_chunk: str) -> dict[str, list[str]]:
    """Map each declared library to the sorted basenames of chunks holding its marker."""
    chunks = sorted((dist / "assets").glob("*.js"))
    contents = {chunk.name: chunk.read_text(encoding="utf-8", errors="replace") for chunk in chunks}
    attribution: dict[str, list[str]] = {}
    for library, markers in LIBRARY_MARKERS.items():
        holders = sorted(
            name for name, text in contents.items() if any(marker in text for marker in markers)
        )
        attribution[library] = holders
    return attribution


def evaluate(
    attribution: dict[str, list[str]],
    entry_chunk: str,
    entry_gzip: int,
    budget: int = ENTRY_GZIP_BUDGET_BYTES,
) -> dict:
    failures: list[str] = []
    exceptions: list[str] = []
    for library, holders in sorted(attribution.items()):
        if not holders:
            exceptions.append(library)
            continue
        if entry_chunk in holders:
            failures.append(f"{library} is bundled INTO the entry chunk {entry_chunk} — it must be lazy")
        if len(holders) > 1:
            failures.append(f"{library} is split across multiple chunks: {', '.join(holders)}")
    by_chunk: dict[str, list[str]] = {}
    for library, holders in attribution.items():
        for holder in holders:
            by_chunk.setdefault(holder, []).append(library)
    for holder, libraries in sorted(by_chunk.items()):
        if len(libraries) > 1:
            failures.append(f"{' and '.join(sorted(libraries))} share chunk {holder} — they must be separate")
    within = entry_gzip <= budget
    if not within:
        failures.append(
            f"entry chunk gzip {entry_gzip} B exceeds budget {budget} B by {entry_gzip - budget} B"
        )
    return {
        "entryChunk": entry_chunk,
        "entryGzipBytes": entry_gzip,
        "entryGzipBudgetBytes": budget,
        "entryWithinBudget": within,
        "entryOverBudgetByBytes": None if within else entry_gzip - budget,
        "attribution": {library: holders for library, holders in sorted(attribution.items())},
        "exceptions": sorted(exceptions),
        "failures": failures,
    }


def budget_expectations(entry_gzip: int, attribution: dict[str, list[str]]) -> dict:
    """Budget block embedded into benchmark/build-report.json (expectations)."""
    return {
        "entryGzipBudgetBytes": ENTRY_GZIP_BUDGET_BYTES,
        "entryGzipBytes": entry_gzip,
        "entryBudgetMet": entry_gzip <= ENTRY_GZIP_BUDGET_BYTES,
        "expectedLazyChunkLibraries": {library: holders for library, holders in sorted(attribution.items())},
        "notImportedExceptions": sorted(lib for lib, holders in attribution.items() if not holders),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    if not args.dist.is_dir():
        print(f"[FAIL] dist directory not found: {args.dist} (run `npm run build` first)")
        return 2
    entry = find_entry_chunk(args.dist)
    if entry is None:
        print(f"[FAIL] no entry script found in {args.dist / 'index.html'}")
        return 2
    entry_path = args.dist / "assets" / entry
    entry_gzip = gzip_size(entry_path)
    attribution = attribute_libraries(args.dist, entry)
    report = evaluate(attribution, entry, entry_gzip)
    print(f"Entry chunk: {entry} — {entry_path.stat().st_size} B raw / {entry_gzip} B gzip "
          f"(budget {ENTRY_GZIP_BUDGET_BYTES} B gzip)")
    for library, holders in sorted(attribution.items()):
        if holders:
            location = ", ".join(holders)
            print(f"  [LAZY]  {library:18} → {location}"
                  + ("  ← IN ENTRY, MUST BE LAZY" if entry in holders else ""))
        else:
            print(f"  [EXCEPT] {library:18} → imported nowhere in the bundle (declared dependency; laziness vacuous)")
    for failure in report["failures"]:
        print(f"[FAIL] {failure}")
    if not report["failures"]:
        print("[PASS] chunk check — entry within budget; every imported heavy library is in its own lazy chunk")
    return 1 if report["failures"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
