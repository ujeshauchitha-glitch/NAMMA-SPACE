#!/usr/bin/env python3
"""Validate a Namma Space scene bundle without requiring a GPU."""

from __future__ import annotations

import hashlib
import json
import math
import struct
import sys
from pathlib import Path


def load_json(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def fail(message: str) -> None:
    print(f"FAIL  {message}")
    raise SystemExit(1)


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python3 scripts/validate_scene.py <scene-directory>")
        return 2

    root = Path(sys.argv[1]).resolve()
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        fail(f"missing manifest: {manifest_path}")

    manifest = load_json(manifest_path)
    required = [
        "schemaVersion", "sceneId", "displayName", "sceneKind", "coordinateSystem",
        "units", "bounds", "startPosition", "navigationUri", "semanticUri", "qualityUri",
    ]
    missing = [key for key in required if key not in manifest]
    if missing:
        fail(f"manifest missing keys: {', '.join(missing)}")
    if manifest["schemaVersion"] != 1:
        fail("unsupported schemaVersion")
    if manifest["coordinateSystem"] != "right-handed-y-up" or manifest["units"] != "metre":
        fail("unsupported coordinate convention")
    bounds = manifest.get("bounds", {})
    minimum = bounds.get("min", [])
    maximum = bounds.get("max", [])
    if len(minimum) != 3 or len(maximum) != 3 or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in minimum + maximum) or any(a >= b for a, b in zip(minimum, maximum)):
        fail("scene bounds must be finite and strictly non-degenerate")

    referenced = [manifest["semanticUri"], manifest["qualityUri"]]
    if manifest.get("navigationUri") is not None:
        referenced.append(manifest["navigationUri"])
    for optional_key in ("sourceFrameManifest", "processingReportUri"):
        if manifest.get(optional_key):
            referenced.append(manifest[optional_key])
    for uri in referenced:
        if uri.startswith("/") or ".." in Path(uri).parts:
            fail(f"unsafe asset URI: {uri}")
        if not (root / uri).is_file():
            fail(f"missing referenced asset: {uri}")

    navigation = load_json(root / manifest["navigationUri"]) if manifest.get("navigationUri") else None
    blocked = []
    if navigation is not None:
        width = navigation.get("width")
        height = navigation.get("height")
        blocked = navigation.get("blocked", [])
        if not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0:
            fail("invalid navigation dimensions")
        unknown = navigation.get("unknown", [])
        all_indices = blocked + unknown
        if any(not isinstance(index, int) or index < 0 or index >= width * height for index in all_indices):
            fail("navigation blocked indices exceed grid bounds")
        if len(set(all_indices)) != len(all_indices):
            fail("navigation blocked and unknown cells overlap or repeat")

    pois = load_json(root / manifest["semanticUri"])
    if not isinstance(pois, list) or not pois:
        fail("semantic POI list is empty")
    ids = [poi.get("id") for poi in pois]
    if len(ids) != len(set(ids)):
        fail("POI identifiers are not unique")

    if navigation is not None:
        width = navigation.get("width")
        height = navigation.get("height")
        all_indices = navigation.get("blocked", []) + navigation.get("unknown", [])
        start = navigation.get("start")
        if not isinstance(start, dict) or not isinstance(start.get("x"), int) or not isinstance(start.get("z"), int):
            fail("navigation start cell is malformed")
        if start["x"] < 0 or start["x"] >= width or start["z"] < 0 or start["z"] >= height:
            fail("navigation start cell is outside grid bounds")
        start_index = start["z"] * width + start["x"]
        if start_index in all_indices:
            fail("navigation start cell is blocked")

    quality = load_json(root / manifest["qualityUri"])
    if quality.get("status") not in {"passed", "needs-review", "failed"}:
        fail("invalid quality report status")

    hashed_assets = 0
    for asset in manifest.get("visualAssets", []):
        if asset.get("kind") == "procedural":
            continue
        uri = asset.get("uri", "")
        if uri.startswith("/") or ".." in Path(uri).parts:
            fail(f"unsafe visual asset URI: {uri}")
        asset_path = root / uri
        if not asset_path.is_file():
            fail(f"missing visual asset: {uri}")
        if asset.get("kind") == "glb":
            header = asset_path.read_bytes()[:12]
            if len(header) != 12 or header[:4] != b"glTF" or struct.unpack_from("<I", header, 4)[0] != 2:
                fail(f"invalid GLB header: {uri}")
            declared_length = struct.unpack_from("<I", header, 8)[0]
            if declared_length != asset_path.stat().st_size:
                fail(f"GLB declared length does not match file size: {uri}")
        if asset.get("sha256"):
            digest = hashlib.sha256(asset_path.read_bytes()).hexdigest()
            if digest != asset["sha256"]:
                fail(f"hash mismatch for visual asset: {uri}")
            hashed_assets += 1

    print(f"PASS  {manifest['displayName']} ({manifest['sceneKind']})")
    print(f"PASS  {len(pois)} POIs, {len(blocked)} blocked cells, {hashed_assets} hashed assets")
    print(f"PASS  quality status: {quality['status']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
