#!/usr/bin/env python3
"""Run the classical COLMAP reconstruction boundary without hiding dependencies.

The command owns preprocessing outputs and COLMAP's sparse reconstruction stages.
It deliberately does not manufacture a GLB, Gaussian Splat, collision mesh, or
published scene when those downstream artifacts have not been generated.
"""

from __future__ import annotations

import argparse
import json
import shutil
import struct
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}


def command_version(command: str) -> dict[str, Any]:
    executable = shutil.which(command)
    result: dict[str, Any] = {"command": command, "available": executable is not None, "path": executable}
    if executable is None:
        result["detail"] = f"{command} was not found on PATH."
        return result
    try:
        completed = subprocess.run([executable, "-h"], capture_output=True, text=True, timeout=10, check=False)
        output = (completed.stdout or completed.stderr).strip().splitlines()
        result["detail"] = output[0] if output else f"{command} responded with exit code {completed.returncode}."
        result["returncode"] = completed.returncode
    except (OSError, subprocess.TimeoutExpired) as error:
        result["detail"] = f"Could not query {command}: {error}"
    return result


def preflight() -> dict[str, Any]:
    return {
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "python": sys.version.split()[0],
        "tools": {
            "colmap": command_version("colmap"),
            "ffmpeg": command_version("ffmpeg"),
            "nvidia-smi": command_version("nvidia-smi"),
        },
        "supportedStages": [
            "feature_extraction", "feature_matching", "sparse_mapping",
            "image_undistortion", "patch_match_stereo", "stereo_fusion",
            "poisson_meshing", "delaunay_meshing", "advancing_front_meshing", "mesh_simplification", "mesh_texturing",
        ],
        "downstreamStages": ["glb_export", "collision_mesh_generation", "navigation_generation", "publication"],
    }


def write_report(output: Path, report: dict[str, Any]) -> None:
    output.mkdir(parents=True, exist_ok=True)
    (output / "reconstruction-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def run_command(stage: str, command: list[str], report: dict[str, Any], expected_outputs: list[Path] | None = None) -> bool:
    started = time.monotonic()
    record: dict[str, Any] = {"stage": stage, "command": command, "startedAt": datetime.now(timezone.utc).isoformat()}
    try:
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
    except OSError as error:
        record.update({"status": "failed", "error": str(error)})
        report["stages"].append(record)
        return False
    outputs_ok = all(path.is_dir() or path.is_file() and path.stat().st_size > 0 for path in (expected_outputs or []))
    status = "passed" if completed.returncode == 0 and outputs_ok else "failed"
    record.update({
        "status": status,
        "returncode": completed.returncode,
        "durationSeconds": round(time.monotonic() - started, 3),
        "stdoutTail": completed.stdout[-2000:],
        "stderrTail": completed.stderr[-2000:],
        "finishedAt": datetime.now(timezone.utc).isoformat(),
    })
    if expected_outputs:
        record["expectedOutputs"] = [str(path) for path in expected_outputs]
        record["outputsPresent"] = outputs_ok
        if completed.returncode == 0 and not outputs_ok:
            record["diagnostic"] = "Command returned zero but one or more expected outputs were missing or empty."
    report["stages"].append(record)
    return status == "passed"


def validate_ply(path: Path) -> tuple[bool, str]:
    if not path.is_file() or path.stat().st_size == 0:
        return False, "PLY output is missing or empty."
    try:
        header = path.read_bytes()[:8192].decode("ascii", errors="strict")
    except UnicodeDecodeError:
        return False, "PLY header is not readable ASCII."
    if not header.startswith("ply\n") or "format ascii" not in header and "format binary" not in header:
        return False, "PLY header is malformed."
    vertex_line = next((line for line in header.splitlines() if line.startswith("element vertex ")), None)
    if vertex_line is None or int(vertex_line.split()[-1]) < 1:
        return False, "PLY contains no vertices."
    return True, "PLY exists with a positive vertex count."


def validate_glb(path: Path) -> tuple[bool, str]:
    if not path.is_file() or path.stat().st_size < 12:
        return False, "GLB output is missing or too small."
    header = path.read_bytes()[:12]
    if header[:4] != b"glTF" or struct.unpack_from("<I", header, 4)[0] != 2:
        return False, "GLB header is invalid."
    if struct.unpack_from("<I", header, 8)[0] != path.stat().st_size:
        return False, "GLB declared length does not match file size."
    return True, "GLB header and declared length are valid."


def find_sparse_model(sparse: Path) -> Path | None:
    models = sorted(path for path in sparse.iterdir() if path.is_dir() and (path / "cameras.bin").is_file() and (path / "images.bin").is_file() and (path / "points3D.bin").is_file())
    return models[0] if models else None


def run_reconstruction(args: argparse.Namespace) -> int:
    frames = args.frames.resolve()
    output = args.output.resolve()
    if not frames.is_dir():
        print(f"ERROR image directory does not exist: {frames}", file=sys.stderr)
        return 2
    images = sorted(path for path in frames.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS)
    if not images:
        print(f"ERROR no supported images found in {frames}", file=sys.stderr)
        return 2
    colmap = shutil.which("colmap")
    report: dict[str, Any] = {
        "schemaVersion": 1,
        "status": "queued",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "input": {"frames": str(frames), "imageCount": len(images)},
        "output": str(output),
        "stages": [],
        "downstream": {"visualAsset": "not-generated", "collisionAsset": "not-generated", "navigation": "not-generated", "publication": "not-published"},
    }
    if colmap is None:
        report["status"] = "blocked"
        report["blocker"] = "COLMAP executable not found on PATH. Run `npm run preflight:reconstruction` for diagnostics."
        write_report(output, report)
        print(report["blocker"], file=sys.stderr)
        return 3

    database = output / "database.db"
    sparse = output / "sparse"
    sparse.mkdir(parents=True, exist_ok=True)
    report["status"] = "running"
    commands = [
        ("feature_extraction", [colmap, "feature_extractor", "--database_path", str(database), "--image_path", str(frames), "--ImageReader.single_camera", "1", "--SiftExtraction.use_gpu", "0"]),
        ("feature_matching", [colmap, "exhaustive_matcher", "--database_path", str(database), "--SiftMatching.use_gpu", "0"]),
        ("sparse_mapping", [colmap, "mapper", "--database_path", str(database), "--image_path", str(frames), "--output_path", str(sparse)]),
    ]
    for stage, command in commands[:3]:
        if not run_command(stage, command, report):
            report["status"] = "failed"
            write_report(output, report)
            print(f"COLMAP stage failed: {stage}. See {output / 'reconstruction-report.json'}", file=sys.stderr)
            return 1
    sparse_model = find_sparse_model(sparse)
    if sparse_model is None:
        report["status"] = "failed"
        report["blocker"] = "COLMAP mapper returned zero but no complete sparse model directory was produced."
        write_report(output, report)
        return 1
    report["sparseModel"] = str(sparse_model)

    if not args.dense:
        report["status"] = "sparse-reconstruction-ready"
        report["nextStep"] = "Run with --dense to produce a fused point cloud, or --mesh for dense meshing."
        write_report(output, report)
        print(f"Sparse reconstruction ready: {output}")
        print(f"Report: {output / 'reconstruction-report.json'}")
        return 0

    dense = output / "dense"
    dense.mkdir(parents=True, exist_ok=True)
    undistort = [colmap, "image_undistorter", "--image_path", str(frames), "--input_path", str(sparse_model), "--output_path", str(dense), "--output_type", "COLMAP", "--max_image_size", str(args.max_image_size)]
    if not run_command("image_undistortion", undistort, report, [dense / "images", dense / "sparse"]):
        report["status"] = "partial"
        report["blocker"] = "Dense reconstruction could not start because image undistortion failed. Sparse output was preserved."
        write_report(output, report)
        return 1
    patch_match = [colmap, "patch_match_stereo", "--workspace_path", str(dense), "--workspace_format", "COLMAP", "--PatchMatchStereo.geom_consistency", "true"]
    if not run_command("patch_match_stereo", patch_match, report, [dense / "stereo"]):
        report["status"] = "partial"
        report["blocker"] = "Dense stereo failed; sparse output and any partial dense workspace were preserved."
        write_report(output, report)
        return 1
    fused = dense / "fused.ply"
    fusion = [colmap, "stereo_fusion", "--workspace_path", str(dense), "--workspace_format", "COLMAP", "--input_type", "geometric", "--output_path", str(fused)]
    if not run_command("stereo_fusion", fusion, report, [fused]):
        report["status"] = "partial"
        report["blocker"] = "Dense stereo fusion failed; sparse output was preserved."
        write_report(output, report)
        return 1
    ply_ok, ply_detail = validate_ply(fused)
    report["denseValidation"] = {"path": str(fused), "valid": ply_ok, "detail": ply_detail}
    if not ply_ok:
        report["status"] = "partial"
        report["blocker"] = ply_detail
        write_report(output, report)
        return 1

    if args.mesh:
        mesh_path = dense / f"meshed-{args.mesh_method}.ply"
        mesher = [colmap, f"{args.mesh_method}_mesher", "--input_path", str(fused if args.mesh_method == 'poisson' else dense), "--output_path", str(mesh_path)]
        if not run_command(f"{args.mesh_method}_meshing", mesher, report, [mesh_path]):
            report["status"] = "visual-ready"
            report["blocker"] = "Dense point cloud is available, but surface meshing failed."
            write_report(output, report)
            return 1
        mesh_ok, mesh_detail = validate_ply(mesh_path)
        report["meshValidation"] = {"path": str(mesh_path), "valid": mesh_ok, "detail": mesh_detail}
        report["status"] = "mesh-ready" if mesh_ok else "visual-ready"
        selected_mesh = mesh_path
        if mesh_ok and args.simplify:
            simplified_path = dense / f"meshed-{args.mesh_method}-simplified.ply"
            simplify = [colmap, "mesh_simplifier", "--input_path", str(mesh_path), "--output_path", str(simplified_path), "--MeshSimplification.target_face_ratio", str(args.simplify_ratio)]
            if not run_command("mesh_simplification", simplify, report, [simplified_path]):
                report["status"] = "mesh-ready"
                report["blocker"] = "Mesh exists, but optional simplification failed; the unsimplified mesh was preserved."
            else:
                simplified_ok, simplified_detail = validate_ply(simplified_path)
                report["simplifiedMeshValidation"] = {"path": str(simplified_path), "valid": simplified_ok, "detail": simplified_detail}
                if not simplified_ok:
                    report["status"] = "mesh-ready"
                    report["blocker"] = simplified_detail
                else:
                    selected_mesh = simplified_path
        if mesh_ok and args.texture:
            textured_dir = dense / "textured"
            texture = [colmap, "mesh_texturer", "--workspace_path", str(dense), "--input_path", str(selected_mesh), "--output_path", str(textured_dir)]
            if not run_command("mesh_texturing", texture, report, [textured_dir]):
                report["blocker"] = "Mesh exists, but optional texture baking failed; the untextured mesh was preserved."
            else:
                report["textureOutput"] = str(textured_dir)
        report["nextStep"] = "Convert the validated PLY surface to GLB and generate a scene bundle." if mesh_ok else "Validate the dense point cloud before retrying meshing."
    else:
        report["status"] = "dense-reconstruction-ready"
        report["nextStep"] = "Run with --mesh to produce an explicit surface mesh."
    write_report(output, report)
    print(f"Reconstruction output ready: {output}")
    print(f"Report: {output / 'reconstruction-report.json'}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    preflight_parser = subparsers.add_parser("preflight", help="report available external tools")
    preflight_parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    run_parser = subparsers.add_parser("run", help="run COLMAP sparse reconstruction")
    run_parser.add_argument("--frames", type=Path, required=True, help="directory containing extracted images")
    run_parser.add_argument("--output", type=Path, required=True, help="output directory for database, sparse model, and report")
    run_parser.add_argument("--dense", action="store_true", help="run image undistortion, patch-match stereo, and stereo fusion after sparse mapping")
    run_parser.add_argument("--mesh", action="store_true", help="run COLMAP surface meshing after dense fusion; implies --dense")
    run_parser.add_argument("--mesh-method", choices=["poisson", "delaunay", "advancing_front"], default="poisson", help="COLMAP surface mesher; default: poisson")
    run_parser.add_argument("--simplify", action="store_true", help="run COLMAP mesh_simplifier after surface meshing")
    run_parser.add_argument("--simplify-ratio", type=float, default=0.25, help="target face ratio for --simplify; default: 0.25")
    run_parser.add_argument("--texture", action="store_true", help="run COLMAP mesh_texturer after surface meshing")
    run_parser.add_argument("--max-image-size", type=int, default=2000, help="maximum undistorted image dimension; default: 2000")
    args = parser.parse_args()
    if args.command == "preflight":
        result = preflight()
        print(json.dumps(result, indent=2) if args.json else "\n".join(f"{name}: {'available' if data['available'] else 'missing'} — {data['detail']}" for name, data in result["tools"].items()))
        return 0
    if args.mesh:
        args.dense = True
    return run_reconstruction(args)


if __name__ == "__main__":
    raise SystemExit(main())
