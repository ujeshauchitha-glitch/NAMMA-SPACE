#!/usr/bin/env python3
"""Record reproducible Vite artifact sizes for the current build.

T25: the report now carries an `expectations` block — the initial-entry gzip
budget from the V1 spec (<= 360 KB gzip) plus the per-library lazy-chunk
attribution from scripts/check_chunks.py, so budgets travel with the measured
numbers instead of living only in prose. Missing dist is an error (exit 2)
rather than an empty report, because a budget check against no artifacts
would be a silent lie.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import check_chunks  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=Path("dist"))
    parser.add_argument("--output", type=Path, default=Path("benchmark/build-report.json"))
    args = parser.parse_args()
    if not args.dist.is_dir():
        print(f"[FAIL] dist directory not found: {args.dist} (run `npm run build` first)")
        return 2
    files = [path for path in args.dist.rglob("*") if path.is_file()]
    artifacts = []
    for path in sorted(files):
        data = path.read_bytes()
        artifacts.append({"path": str(path), "bytes": len(data), "gzipBytes": len(gzip.compress(data, compresslevel=9))})
    def matching(fragment: str) -> dict[str, int] | None:
        item = next((artifact for artifact in artifacts if fragment in artifact["path"]), None)
        return {"bytes": item["bytes"], "gzipBytes": item["gzipBytes"]} if item else None

    entry_chunk = check_chunks.find_entry_chunk(args.dist)
    if entry_chunk is None:
        print(f"[FAIL] no entry script found in {args.dist / 'index.html'}")
        return 2
    entry_gzip = check_chunks.gzip_size(args.dist / "assets" / entry_chunk)
    attribution = check_chunks.attribute_libraries(args.dist, entry_chunk)
    expectations = check_chunks.budget_expectations(entry_gzip, attribution)

    report = {
        "schemaVersion": 2,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "dist": str(args.dist),
        "artifacts": artifacts,
        "scopes": {
            "initialJavaScript": matching("/index-"),
            "entryJavaScript": {"path": f"{args.dist}/assets/{entry_chunk}", "gzipBytes": entry_gzip},
            "lazyViewerJavaScript": matching("/PlayCanvasViewer-"),
            "generatedGlbFixture": matching("architectural-fixture.glb"),
        },
        "expectations": expectations,
        "totalBytes": sum(item["bytes"] for item in artifacts),
        "totalGzipBytes": sum(item["gzipBytes"] for item in artifacts),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    status = "PASS" if expectations["entryBudgetMet"] else "FAIL"
    print(f"[{status}] entry chunk {entry_gzip} B gzip vs budget {expectations['entryGzipBudgetBytes']} B gzip")
    for library, holders in expectations["expectedLazyChunkLibraries"].items():
        if holders:
            print(f"  [LAZY]  {library:18} → {', '.join(holders)}")
        else:
            print(f"  [EXCEPT] {library:18} → not imported anywhere in the bundle")
    print(json.dumps(report, indent=2))
    return 0 if expectations["entryBudgetMet"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
