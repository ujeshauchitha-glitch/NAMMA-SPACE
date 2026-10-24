#!/usr/bin/env python3
"""Record reproducible Vite artifact sizes for the current build."""

from __future__ import annotations

import argparse
import gzip
import json
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, default=Path("dist"))
    parser.add_argument("--output", type=Path, default=Path("benchmark/build-report.json"))
    args = parser.parse_args()
    files = [path for path in args.dist.rglob("*") if path.is_file()]
    artifacts = []
    for path in sorted(files):
        data = path.read_bytes()
        artifacts.append({"path": str(path), "bytes": len(data), "gzipBytes": len(gzip.compress(data, compresslevel=9))})
    def matching(fragment: str) -> dict[str, int] | None:
        item = next((artifact for artifact in artifacts if fragment in artifact["path"]), None)
        return {"bytes": item["bytes"], "gzipBytes": item["gzipBytes"]} if item else None

    report = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "dist": str(args.dist),
        "artifacts": artifacts,
        "scopes": {
            "initialJavaScript": matching("/index-"),
            "lazyViewerJavaScript": matching("/PlayCanvasViewer-"),
            "generatedGlbFixture": matching("architectural-fixture.glb"),
        },
        "totalBytes": sum(item["bytes"] for item in artifacts),
        "totalGzipBytes": sum(item["gzipBytes"] for item in artifacts),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
