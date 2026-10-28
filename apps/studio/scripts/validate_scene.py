#!/usr/bin/env python3
"""Validate a Namma Space scene bundle without requiring a GPU.

URI/integrity contract — kept in sync with apps/studio/src/lib/sceneLoader.ts:

* Every URI a scene declares (document references and non-procedural visual
  assets) must be a bundle-relative POSIX path: no scheme, no leading slash,
  no backslash, no query/fragment, no '..' segment — and it must resolve
  inside the directory of the manifest that declares it. Procedural assets
  are the sole exception: they are engine-built, never fetched, and must
  declare a ``procedural://`` URI.
* Single JSON scene documents are capped at MAX_SCENE_JSON_BYTES.
* A declared sha256 digest must be 64 lowercase hex characters and must
  match the shipped bytes (the browser verifies the same digests against
  the bytes it fetches).
* The manifest may not promise behaviour the viewer does not implement:
  ``worldFromReconstruction`` must be the identity matrix (the engine
  applies no reconstruction->world transform) and ``collisionAsset`` must
  be null (the navigation grid is the only collision model). Shipped
  bundles already use identity/null; non-identity values are rejected with
  the same message the zod schema uses.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import struct
import sys
from pathlib import Path

MAX_SCENE_JSON_BYTES = 32 * 1024 * 1024
SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
VISUAL_KINDS = {"glb", "gltf", "sog", "procedural"}


def load_json(path: Path, role: str):
    size = path.stat().st_size
    if size > MAX_SCENE_JSON_BYTES:
        fail(
            f"{role} exceeds the {MAX_SCENE_JSON_BYTES // (1024 * 1024)} MiB scene document limit: "
            f"{path.name} ({size} bytes)"
        )
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def fail(message: str) -> None:
    print(f"FAIL  {message}")
    raise SystemExit(1)


def bundle_relative(uri, role: str) -> None:
    """Reject anything that is not a bundle-relative POSIX path (D3 policy)."""
    if not isinstance(uri, str) or not uri or uri != uri.strip():
        fail(f"{role} URI must be a non-empty bundle-relative path: {uri!r}")
    if SCHEME_RE.match(uri):
        fail(f"{role} URI must be bundle-relative (no scheme): {uri}")
    if uri.startswith("/") or "\\" in uri:
        fail(f"{role} URI must be bundle-relative (no absolute paths): {uri}")
    if "?" in uri or "#" in uri:
        fail(f"{role} URI must be bundle-relative (no query or fragment): {uri}")
    if ".." in Path(uri).parts:
        fail(f"{role} URI must be bundle-relative (no '..' traversal): {uri}")


def resolve_inside(root: Path, uri: str, role: str) -> Path:
    bundle_relative(uri, role)
    target = (root / uri).resolve()
    if not target.is_relative_to(root):
        fail(f"{role} URI escapes the scene bundle directory: {uri}")
    return target


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python3 scripts/validate_scene.py <scene-directory>")
        return 2

    root = Path(sys.argv[1]).resolve()
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        fail(f"missing manifest: {manifest_path}")

    manifest = load_json(manifest_path, "Scene manifest")
    required = [
        "schemaVersion", "sceneId", "displayName", "sceneKind", "description",
        "coordinateSystem", "units", "worldFromReconstruction", "bounds",
        "startPosition", "startYawDegrees", "visualAssets", "collisionAsset",
        "navigationUri", "semanticUri", "qualityUri", "provenance",
    ]
    missing = [key for key in required if key not in manifest]
    if missing:
        fail(f"manifest missing keys: {', '.join(missing)}")
    if manifest["schemaVersion"] != 1:
        fail("unsupported schemaVersion")
    if manifest["coordinateSystem"] != "right-handed-y-up" or manifest["units"] != "metre":
        fail("unsupported coordinate convention")

    # D2 — the viewer applies no reconstruction->world transform, so only the
    # identity matrix is a value it actually honours (same message as the zod
    # schema in src/types/scene.ts).
    matrix = manifest["worldFromReconstruction"]
    shape_ok = (
        isinstance(matrix, list)
        and len(matrix) == 4
        and all(isinstance(row, list) and len(row) == 4 for row in matrix)
    )
    if not shape_ok:
        fail("worldFromReconstruction must be a 4x4 matrix")
    for row_index, row in enumerate(matrix):
        for column_index, value in enumerate(row):
            expected = 1 if row_index == column_index else 0
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value != expected:
                fail(
                    "worldFromReconstruction must be the identity matrix — the viewer applies no "
                    "reconstruction→world transform, so non-identity transforms are rejected until "
                    "the engine applies them end-to-end."
                )

    # D2 — the viewer loads no collision mesh; the navigation grid is the
    # only collision model (same message as the zod schema).
    if manifest["collisionAsset"] is not None:
        fail(
            "collisionAsset is not supported: the viewer never loads a collision mesh — "
            "declare obstacles in navigation.blocked/unknown instead."
        )

    bounds = manifest.get("bounds", {})
    minimum = bounds.get("min", [])
    maximum = bounds.get("max", [])
    if len(minimum) != 3 or len(maximum) != 3 or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in minimum + maximum) or any(a >= b for a, b in zip(minimum, maximum)):
        fail("scene bounds must be finite and strictly non-degenerate")

    referenced = [("semantic", manifest["semanticUri"]), ("quality", manifest["qualityUri"])]
    if manifest.get("navigationUri") is not None:
        referenced.append(("navigation", manifest["navigationUri"]))
    for optional_key in ("sourceFrameManifest", "processingReportUri"):
        if manifest.get(optional_key):
            referenced.append((optional_key, manifest[optional_key]))
    for role, uri in referenced:
        target = resolve_inside(root, uri, role)
        if not target.is_file():
            fail(f"missing referenced asset: {uri}")

    navigation = load_json(root / manifest["navigationUri"], "Navigation grid") if manifest.get("navigationUri") else None
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

    pois = load_json(root / manifest["semanticUri"], "POI index")
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

    quality = load_json(root / manifest["qualityUri"], "Quality report")
    if quality.get("status") not in {"passed", "needs-review", "failed"}:
        fail("invalid quality report status")

    hashed_assets = 0
    assets = manifest["visualAssets"]
    if not isinstance(assets, list):
        fail("visualAssets must be a list")
    for asset in assets:
        if not isinstance(asset, dict):
            fail("visual asset entries must be objects")
        kind = asset.get("kind")
        if kind not in VISUAL_KINDS:
            fail(f"unsupported visual asset kind: {kind!r} — expected one of glb|gltf|sog|procedural")
        uri = asset.get("uri")
        if not isinstance(uri, str) or not uri:
            fail("visual asset URI must be a non-empty bundle-relative path")
        if kind == "procedural":
            # Engine-built, never fetched — the only allowed scheme.
            if not uri.startswith("procedural://"):
                fail(f"procedural asset URI must use the procedural:// scheme (engine-built assets are never fetched): {uri}")
            continue
        asset_path = resolve_inside(root, uri, "visual asset")
        if not asset_path.is_file():
            fail(f"missing visual asset: {uri}")
        if kind == "glb":
            header = asset_path.read_bytes()[:12]
            if len(header) != 12 or header[:4] != b"glTF" or struct.unpack_from("<I", header, 4)[0] != 2:
                fail(f"invalid GLB header: {uri}")
            declared_length = struct.unpack_from("<I", header, 8)[0]
            if declared_length != asset_path.stat().st_size:
                fail(f"GLB declared length does not match file size: {uri}")
        declared_digest = asset.get("sha256")
        if declared_digest is not None:
            if not isinstance(declared_digest, str) or not SHA256_RE.match(declared_digest):
                fail(f"malformed sha256 digest for {uri} — expected 64 lowercase hex characters.")
            digest = hashlib.sha256(asset_path.read_bytes()).hexdigest()
            if digest != declared_digest:
                fail(f"hash mismatch for visual asset: {uri}")
            hashed_assets += 1

    print(f"PASS  {manifest['displayName']} ({manifest['sceneKind']})")
    print(f"PASS  {len(pois)} POIs, {len(blocked)} blocked cells, {hashed_assets} hashed assets")
    print(f"PASS  quality status: {quality['status']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
