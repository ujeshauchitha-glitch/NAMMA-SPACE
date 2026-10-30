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

    quality_status = "passed" if navigation_path else "needs-review"
    readiness = "validated" if navigation_path else "visual_ready"
    quality = {
        "status": quality_status,
        "readiness": readiness,
        "warnings": ([] if navigation_path else ["Navigation data was not supplied; route planning is unavailable."]),
        "checks": [
            {"id": "visual-asset", "label": "Visual GLB exists and has a valid header", "status": "passed", "detail": "Validated by the bundle generator."},
            {"id": "geometry-bounds", "label": "Geometry bounds are finite and non-degenerate", "status": "passed", "detail": f"Bounds: {minimum} to {maximum}."},
            {"id": "navigation", "label": "Navigation data is available", "status": "passed" if navigation_path else "warning", "detail": "Navigation copied into bundle." if navigation_path else "No trusted navigation input was supplied."},
        ],
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
