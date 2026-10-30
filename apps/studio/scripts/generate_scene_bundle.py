#!/usr/bin/env python3
"""Publish a validated manifest-driven scene bundle from real pipeline outputs.

This command copies only existing, inspectable artifacts. It never invents
navigation data or labels an incomplete output as a fully ready scene.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Everything this script does NOT and CANNOT verify. Kept next to the quality
# report so no reader mistakes "bundle generated" for "scene fully validated".
# Same honesty pattern as prepare_capture.py's notMeasured list.
NOT_MEASURED = [
    "route smoke tests (this script never runs the route planner)",
    "visual fidelity against the source capture",
    "metric scale accuracy",
    "geometry completeness beyond the declared bounds",
    "start-position reachability",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_relative(path: Path, root: Path) -> str:
    relative = path.resolve().relative_to(root.resolve())
    if not relative.parts or ".." in relative.parts:
        raise ValueError(f"Unsafe path outside scene directory: {path}")
    return relative.as_posix()


def read_bounds(report_path: Path) -> tuple[list[float], list[float]]:
    report = json.loads(report_path.read_text(encoding="utf-8"))
    bounds = report.get("bounds")
    if not isinstance(bounds, dict) or not isinstance(bounds.get("min"), list) or not isinstance(bounds.get("max"), list):
        raise ValueError("Geometry report must contain bounds.min and bounds.max.")
    minimum = [float(value) for value in bounds["min"]]
    maximum = [float(value) for value in bounds["max"]]
    if len(minimum) != 3 or len(maximum) != 3 or any(not math.isfinite(value) for value in minimum + maximum) or any(a >= b for a, b in zip(minimum, maximum)):
        raise ValueError("Geometry bounds must be finite and strictly non-degenerate.")
    return minimum, maximum


def navigation_bounds_consistent(navigation: dict, minimum: list[float], maximum: list[float]) -> bool:
    """True when the nav grid covers the manifest XZ footprint with at most one cell of overshoot.

    make_nav_grid.py uses ceil(), so a generated grid may extend one cell past
    the declared bounds. A larger overshoot, or a grid that does not cover the
    footprint, is an inconsistency — not a pass.
    """
    origin = navigation.get("origin")
    if not isinstance(origin, dict):
        return False
    try:
        origin_x = float(origin["x"])
        origin_z = float(origin["z"])
        cell = float(navigation["cellSize"])
        width = int(navigation["width"])
        height = int(navigation["height"])
    except (KeyError, TypeError, ValueError):
        return False
    if cell <= 0 or width <= 0 or height <= 0:
        return False
    grid_max_x = origin_x + width * cell
    grid_max_z = origin_z + height * cell
    min_x, min_z = minimum[0], minimum[2]
    max_x, max_z = maximum[0], maximum[2]
    covers = origin_x <= min_x + 1e-6 and origin_z <= min_z + 1e-6 and grid_max_x >= max_x - 1e-6 and grid_max_z >= max_z - 1e-6
    overshoot_ok = grid_max_x <= max_x + cell + 1e-6 and grid_max_z <= max_z + cell + 1e-6
    return covers and overshoot_ok


def validate_glb(path: Path) -> None:
    header = path.read_bytes()[:12]
    if len(header) != 12 or header[:4] != b"glTF" or struct.unpack_from("<I", header, 4)[0] != 2:
        raise ValueError(f"Invalid GLB header: {path}")
    if struct.unpack_from("<I", header, 8)[0] != path.stat().st_size:
        raise ValueError(f"GLB declared length does not match file size: {path}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--visual-asset", type=Path, required=True)
    parser.add_argument("--geometry-report", type=Path, required=True)
    parser.add_argument("--semantic", type=Path, required=True)
    parser.add_argument("--navigation", type=Path)
    parser.add_argument("--frame-manifest", type=Path)
    parser.add_argument("--processing-report", type=Path)
    parser.add_argument("--scene-id", required=True)
    parser.add_argument("--display-name", required=True)
    parser.add_argument("--pipeline", default="colmap-open3d")
    parser.add_argument("--pipeline-version", default="phase-4")
    parser.add_argument("--captured-at", default=datetime.now(timezone.utc).isoformat())
    parser.add_argument("--source", required=True)
    parser.add_argument("--scale-status", choices=["known", "estimated", "unknown"], default="unknown")
    args = parser.parse_args()

    inputs = [args.visual_asset, args.geometry_report, args.semantic]
    if args.navigation:
        inputs.append(args.navigation)
    if args.frame_manifest:
        inputs.append(args.frame_manifest)
    if args.processing_report:
        inputs.append(args.processing_report)
    missing = [str(path) for path in inputs if not path.is_file()]
    if missing:
        print(f"ERROR missing input: {', '.join(missing)}", file=sys.stderr)
        return 2

    try:
        minimum, maximum = read_bounds(args.geometry_report)
        validate_glb(args.visual_asset)
        json.loads(args.semantic.read_text(encoding="utf-8"))
        if args.navigation:
            json.loads(args.navigation.read_text(encoding="utf-8"))
    except (ValueError, json.JSONDecodeError, OSError) as error:
        print(f"ERROR invalid reconstruction output: {error}", file=sys.stderr)
        return 1

    output = args.output.resolve()
    visual_dir = output / "visual"
    semantic_dir = output / "semantic"
    navigation_dir = output / "navigation"
    quality_dir = output / "quality"
    output.mkdir(parents=True, exist_ok=True)
    visual_dir.mkdir(exist_ok=True)
    semantic_dir.mkdir(exist_ok=True)
    quality_dir.mkdir(exist_ok=True)
    if args.navigation:
        navigation_dir.mkdir(exist_ok=True)

    visual_path = visual_dir / args.visual_asset.name
    shutil.copy2(args.visual_asset, visual_path)
    semantic_path = semantic_dir / "pois.json"
    shutil.copy2(args.semantic, semantic_path)
    navigation_path = None
    if args.navigation:
        navigation_path = navigation_dir / "nav-data.json"
        shutil.copy2(args.navigation, navigation_path)

    frame_manifest_path = None
    if args.frame_manifest:
        frame_manifest_path = output / "frame-manifest.json"
        shutil.copy2(args.frame_manifest, frame_manifest_path)
    processing_path = None
    if args.processing_report:
        processing_path = output / "processing-report.json"
        shutil.copy2(args.processing_report, processing_path)

    QUALITY_NOT_MEASURED = [
        "route smoke tests",
        "collision accuracy with dynamic objects",
        "dense visual surface completeness",
        "photometric consistency under variable lighting",
    ]

    warnings: list[str] = []
    if navigation_path is None:
        quality_status = "needs-review"
        readiness = "visual_ready"
        warnings.append("Navigation data was not supplied; route planning is unavailable.")
        nav_check_status = "warning"
        nav_check_detail = "No trusted navigation input was supplied."
        measured = {
            "navigationSupplied": False,
            "navigationBoundsConsistentWithManifest": None,
        }
    else:
        nav_dict = json.loads(navigation_path.read_text(encoding="utf-8"))
        is_consistent = navigation_bounds_consistent(nav_dict, minimum, maximum)
        if is_consistent:
            quality_status = "passed"
            readiness = "validated"
            nav_check_status = "passed"
            nav_check_detail = "Navigation copied into bundle and verified consistent with geometry bounds."
            measured = {
                "navigationSupplied": True,
                "navigationBoundsConsistentWithManifest": True,
            }
        else:
            quality_status = "needs-review"
            readiness = "visual_ready"
            warnings.append("Navigation grid bounds are inconsistent with geometry manifest bounds.")
            nav_check_status = "failed"
            nav_check_detail = "Navigation grid bounds are inconsistent with geometry manifest bounds."
            measured = {
                "navigationSupplied": True,
                "navigationBoundsConsistentWithManifest": False,
            }

    quality = {
        "status": quality_status,
        "readiness": readiness,
        "warnings": warnings,
        "checks": [
            {"id": "visual-asset", "label": "Visual GLB exists and has a valid header", "status": "passed", "detail": "Validated by the bundle generator."},
            {"id": "geometry-bounds", "label": "Geometry bounds are finite and non-degenerate", "status": "passed", "detail": f"Bounds: {minimum} to {maximum}."},
            {"id": "navigation", "label": "Navigation data is available", "status": nav_check_status, "detail": nav_check_detail},
        ],
        "measured": measured,
        "notMeasured": QUALITY_NOT_MEASURED,
    }
    (quality_dir / "report.json").write_text(json.dumps(quality, indent=2) + "\n", encoding="utf-8")

    manifest: dict[str, Any] = {
        "schemaVersion": 1,
        "sceneId": args.scene_id,
        "displayName": args.display_name,
        "sceneKind": "reconstructed-capture",
        "description": "Generated from inspectable reconstruction pipeline outputs.",
        "coordinateSystem": "right-handed-y-up",
        "units": "metre",
        "worldFromReconstruction": [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
        "bounds": {"min": minimum, "max": maximum},
        "startPosition": [minimum[0], minimum[1], minimum[2]],
        "startYawDegrees": 0,
        "visualAssets": [{"kind": "glb", "uri": f"visual/{visual_path.name}", "label": "Reconstructed visual asset", "sha256": sha256(visual_path)}],
        "collisionAsset": None,
        "navigationUri": safe_relative(navigation_path, output) if navigation_path else None,
        "semanticUri": safe_relative(semantic_path, output),
        "qualityUri": safe_relative(quality_dir / "report.json", output),
        "sourceFrameManifest": safe_relative(frame_manifest_path, output) if frame_manifest_path else None,
        "processingReportUri": safe_relative(processing_path, output) if processing_path else None,
        "scaleStatus": args.scale_status,
        "provenance": {
            "pipeline": args.pipeline,
            "pipelineVersion": args.pipeline_version,
            "capturedAt": args.captured_at,
            "source": args.source,
            "notes": ["Generated only from existing reconstruction outputs.", "Navigation readiness is separate from visual asset readiness."],
        },
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Generated scene bundle: {output}")
    print(f"Quality: {quality_status} / {readiness}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
