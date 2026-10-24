#!/usr/bin/env python3
"""Validate every scene bundle directory beneath a root."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python3 scripts/validate_all_scenes.py <scenes-root>")
        return 2
    root = Path(sys.argv[1])
    validator = Path(__file__).with_name("validate_scene.py")
    scenes = sorted(path for path in root.iterdir() if path.is_dir() and (path / "manifest.json").is_file())
    if not scenes:
        print(f"No scene manifests found under {root}", file=sys.stderr)
        return 1
    for scene in scenes:
        result = subprocess.run([sys.executable, str(validator), str(scene)], check=False)
        if result.returncode != 0:
            return result.returncode
    print(f"Validated {len(scenes)} scene bundles")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
