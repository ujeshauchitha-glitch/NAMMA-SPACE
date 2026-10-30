#!/usr/bin/env python3
"""Single-command pipeline runner for Namma Space.

Chains: prepare_capture -> reconstruct_colmap -> process_geometry (or ply_to_glb fallback) -> generate_scene_bundle.

This is a convenience wrapper around the individual scripts. Each stage
writes its own report. If a stage fails, the pipeline stops and prints
clear instructions for manual intervention.

Usage:
    python scripts/run_pipeline.py \\
        --input ./my-capture.mp4 \\
        --output ./pipeline-output \\
        --scene-id venue-2026 \\
        --display-name "Main Hall" \\
        --source "Phone capture, Techfest 2026"

Optional flags:
    --fps 2           Video sampling rate (default: 2)
    --limit 120       Max frames to extract (default: 120)
    --dense           Run COLMAP dense reconstruction after sparse (slow)
    --mesh            Run COLMAP surface meshing after dense (implies --dense)
    --cell-size 0.25  Nav-grid cell size in metres (default: 0.25)
    --clearance 0.3   Agent clearance for nav-grid (default: 0.3)
    --scene-dir       Destination inside public/scenes/ (default: scene-id)
    --skip-nav        Skip nav-grid generation (visual-only bundle)
    --dry-run         Print commands without executing

Exit codes:
  0  All stages completed.
  1  A pipeline stage failed (see stage report for details).
  2  Usage or prerequisite error.
  3  COLMAP not available (sparse reconstruction blocked).
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent
REPO_ROOT = SCRIPTS_DIR.parent


def run(cmd: list[str], *, dry_run: bool = False, cwd: Path | None = None) -> int:
    """Run a command, print it, and return its exit code."""
    display = " ".join(str(c) for c in cmd)
    print(f"\n$ {display}")
    if dry_run:
        print("  [dry-run] skipped")
        return 0
    result = subprocess.run(cmd, cwd=cwd)
    return result.returncode


def stage_header(name: str) -> None:
    print(f"\n{'=' * 60}")
    print(f"  STAGE: {name}")
    print(f"{'=' * 60}")


def read_report(path: Path) -> dict:
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, required=True,
                        help="Video file or directory of images to capture from.")
    parser.add_argument("--output", type=Path, required=True,
                        help="Root output directory for all pipeline intermediate files.")
    parser.add_argument("--scene-id", required=True,
                        help="Unique scene identifier (e.g. venue-2026-main-hall).")
    parser.add_argument("--display-name", required=True,
                        help="Human-readable scene name (e.g. 'Main Hall').")
    parser.add_argument("--source", required=True,
                        help="Free-text description of the capture source.")
    parser.add_argument("--fps", type=float, default=2.0)
    parser.add_argument("--limit", type=int, default=120)
    parser.add_argument("--dense", action="store_true")
    parser.add_argument("--mesh", action="store_true")
    parser.add_argument("--cell-size", type=float, default=0.25)
    parser.add_argument("--clearance", type=float, default=0.3)
    parser.add_argument("--scene-dir", type=Path,
                        help="Override destination directory. Default: public/scenes/<scene-id>")
    parser.add_argument("--skip-nav", action="store_true",
                        help="Skip navigation grid authoring (visual-only bundle).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print commands without executing.")
    parser.add_argument("--captured-at", default=datetime.now(timezone.utc).isoformat(),
                        help="ISO-8601 capture timestamp (default: now).")
    args = parser.parse_args()

    # Derived paths
    output_root = args.output.resolve()
    capture_out = output_root / "capture"
    colmap_out = output_root / "colmap"
    geometry_out = output_root / "geometry"
    nav_out = output_root / "nav"
    semantic_out = output_root / "semantic"
    scene_dir = args.scene_dir.resolve() if args.scene_dir else (REPO_ROOT / "public" / "scenes" / args.scene_id)

    python = sys.executable
    if args.mesh:
        args.dense = True

    # ---------------------------------------------------------------------------
    # Stage 1: prepare_capture
    # ---------------------------------------------------------------------------
    stage_header("1 / 5  Prepare capture frames")
    prepare_cmd = [
        python, str(SCRIPTS_DIR / "prepare_capture.py"),
        str(args.input),
        "--output", str(capture_out),
        "--fps", str(args.fps),
        "--limit", str(args.limit),
    ]
    rc = run(prepare_cmd, dry_run=args.dry_run)
    if rc != 0:
        print(f"\nERROR: prepare_capture.py exited {rc}. Check input path and FFmpeg availability.")
        return 1

    frames_dir = capture_out / "frames"
    frame_manifest = capture_out / "frame-manifest.json"

    # ---------------------------------------------------------------------------
    # Stage 2: reconstruct_colmap (sparse; optionally dense/mesh)
    # ---------------------------------------------------------------------------
    stage_header("2 / 5  Reconstruct with COLMAP")
    colmap_cmd = [
        python, str(SCRIPTS_DIR / "reconstruct_colmap.py"), "run",
        "--frames", str(frames_dir),
        "--output", str(colmap_out),
    ]
    if args.dense:
        colmap_cmd.append("--dense")
    if args.mesh:
        colmap_cmd.append("--mesh")

    rc = run(colmap_cmd, dry_run=args.dry_run)
    if rc == 3:
        print("\nBLOCKED: COLMAP is not installed or not on PATH.")
        print("Install guide: see WINDOWS_SETUP.md or https://colmap.github.io/install.html")
        print("After installing COLMAP, re-run this script (or run reconstruct_colmap.py directly).")
        return 3
    if rc != 0:
        colmap_report = read_report(colmap_out / "reconstruction-report.json")
        blocker = colmap_report.get("blocker", "see reconstruction-report.json")
        print(f"\nERROR: COLMAP reconstruction failed: {blocker}")
        return 1

    # Determine best PLY input for geometry stage
    ply_candidates = [
        colmap_out / "dense" / "fused.ply",              # stereo_fusion output
        colmap_out / "dense" / "meshed-poisson.ply",      # poisson mesh
        colmap_out / "dense" / "meshed-delaunay.ply",
        colmap_out / "dense" / "meshed-advancing_front.ply",
    ]
    ply_input = next((p for p in ply_candidates if p.is_file() and p.stat().st_size > 0), None)

    if ply_input is None:
        print("\nWARNING: No PLY output found from COLMAP dense stages.")
        print("  Sparse reconstruction may have succeeded. To proceed:")
        print("  1. Run with --dense (and ideally --mesh) to produce a point cloud / mesh.")
        print("  2. Or manually place a fused.ply in:", colmap_out / "dense")
        return 1

    print(f"\nUsing PLY input: {ply_input} ({ply_input.stat().st_size // 1024} KB)")

    # ---------------------------------------------------------------------------
    # Stage 3a: process_geometry (Open3D path, preferred)
    # ---------------------------------------------------------------------------
    stage_header("3 / 5  Process geometry -> GLB")

    # Try Open3D path first
    try:
        import importlib.util
        open3d_available = importlib.util.find_spec("open3d") is not None
    except Exception:  # noqa: BLE001
        open3d_available = False

    glb_path = geometry_out / "reconstructed-mesh.glb"
    geometry_report_path = geometry_out / "geometry-report.json"

    if open3d_available:
        print("Open3D is available — using process_geometry.py for Poisson reconstruction.")
        geo_cmd = [
            python, str(SCRIPTS_DIR / "process_geometry.py"),
            "--input-ply", str(ply_input),
            "--output-dir", str(geometry_out),
        ]
        rc = run(geo_cmd, dry_run=args.dry_run)
        if rc != 0:
            print("WARNING: process_geometry.py failed. Falling back to ply_to_glb.py (direct PLY->GLB).")
            open3d_available = False

    if not open3d_available:
        print("Open3D not available or failed — using ply_to_glb.py (direct PLY->GLB, no meshing).")
        geometry_out.mkdir(parents=True, exist_ok=True)
        ply_glb_cmd = [
            python, str(SCRIPTS_DIR / "ply_to_glb.py"),
            str(ply_input),
            str(glb_path),
        ]
        rc = run(ply_glb_cmd, dry_run=args.dry_run)
        if rc != 0:
            print(f"\nERROR: ply_to_glb.py failed with exit code {rc}.")
            return 1

        # Synthesize a minimal geometry-report.json so generate_scene_bundle.py can read bounds
        # We compute bounds by parsing the GLB (or approximate from PLY)
        if not args.dry_run:
            _write_synthetic_geometry_report(geometry_report_path, ply_input, glb_path)
        else:
            print(f"  [dry-run] Would write synthetic geometry-report.json to {geometry_report_path}")

    # Verify GLB and report exist
    if not args.dry_run:
        if not glb_path.is_file() or glb_path.stat().st_size < 12:
            print(f"\nERROR: Expected GLB not found or too small: {glb_path}")
            return 1
        if not geometry_report_path.is_file():
            print(f"\nERROR: geometry-report.json not found: {geometry_report_path}")
            return 1

    # ---------------------------------------------------------------------------
    # Stage 4: nav-grid scaffold
    # ---------------------------------------------------------------------------
    stage_header("4 / 5  Generate navigation grid scaffold")
    nav_path = nav_out / "nav-data.json"

    if args.skip_nav:
        print("--skip-nav set. Skipping nav-grid generation (visual-only bundle).")
    else:
        nav_cmd = [
            python, str(SCRIPTS_DIR / "make_nav_grid.py"),
            "--geometry-report", str(geometry_report_path),
            "--output", str(nav_path),
            "--cell-size", str(args.cell_size),
            "--clearance", str(args.clearance),
            "--no-interactive",  # Non-interactive in pipeline; user edits JSON after
        ]
        rc = run(nav_cmd, dry_run=args.dry_run)
        if rc != 0:
            print(f"\nWARNING: make_nav_grid.py exited {rc}. Bundle will be visual-only.")
            nav_path = None  # type: ignore[assignment]
        else:
            print(f"\nNOTE: Nav-grid scaffold saved to {nav_path}")
            print("  IMPORTANT: Edit this file to mark obstacle cells (walls, furniture) before publishing.")

    # ---------------------------------------------------------------------------
    # Stage 4b: placeholder pois.json
    # ---------------------------------------------------------------------------
    semantic_out.mkdir(parents=True, exist_ok=True)
    pois_path = semantic_out / "pois.json"
    if not pois_path.is_file():
        pois_path.write_text(json.dumps([], indent=2) + "\n", encoding="utf-8")
        print(f"\nCreated empty pois.json placeholder: {pois_path}")
        print("  Run: python scripts/make_pois.py --output", pois_path)
        print("  to add labeled Points of Interest before publishing.")

    # ---------------------------------------------------------------------------
    # Stage 5: generate_scene_bundle
    # ---------------------------------------------------------------------------
    stage_header("5 / 5  Generate scene bundle")
    bundle_cmd = [
        python, str(SCRIPTS_DIR / "generate_scene_bundle.py"),
        "--output", str(scene_dir),
        "--visual-asset", str(glb_path),
        "--geometry-report", str(geometry_report_path),
        "--semantic", str(pois_path),
        "--scene-id", args.scene_id,
        "--display-name", args.display_name,
        "--source", args.source,
        "--pipeline", "colmap-baseline",
        "--pipeline-version", "run_pipeline-v1",
        "--captured-at", args.captured_at,
    ]
    if not args.skip_nav and nav_path and (args.dry_run or nav_path.is_file()):
        bundle_cmd += ["--navigation", str(nav_path)]
    if frame_manifest.is_file() or args.dry_run:
        bundle_cmd += ["--frame-manifest", str(frame_manifest)]
    colmap_report = colmap_out / "reconstruction-report.json"
    if colmap_report.is_file() or args.dry_run:
        bundle_cmd += ["--processing-report", str(colmap_report)]

    rc = run(bundle_cmd, dry_run=args.dry_run)
    if rc != 0:
        print(f"\nERROR: generate_scene_bundle.py failed with exit code {rc}.")
        return 1

    # ---------------------------------------------------------------------------
    # Validate
    # ---------------------------------------------------------------------------
    stage_header("Validation")
    validate_cmd = [
        python, str(SCRIPTS_DIR / "validate_scene.py"),
        str(scene_dir),
    ]
    rc = run(validate_cmd, dry_run=args.dry_run)
    if rc != 0:
        print("\nWARNING: Scene validation reported issues. See validate output above.")
        print("  Fix the issues and re-run validation before publishing.")
    else:
        print("\nScene bundle validated successfully.")

    # ---------------------------------------------------------------------------
    # Summary
    # ---------------------------------------------------------------------------
    print(f"\n{'=' * 60}")
    print("  PIPELINE COMPLETE")
    print(f"{'=' * 60}")
    print(f"  Scene bundle: {scene_dir}")
    print(f"  GLB asset:    {glb_path}")
    if not args.skip_nav:
        print(f"  Nav-grid:     {nav_path}  <-- EDIT THIS before publishing")
    print(f"  POIs:         {pois_path}  <-- run make_pois.py to add labels")
    print()
    print("Next steps:")
    print("  1. Edit nav-data.json to mark obstacle cells (walls, furniture).")
    print("  2. Run make_pois.py to add labelled Points of Interest.")
    print("  3. Re-run validate_scene.py to confirm the bundle is clean.")
    print("  4. Deploy the viewer (npm run build) and host public/scenes/.")
    print()
    return 0


def _write_synthetic_geometry_report(report_path: Path, ply_path: Path, glb_path: Path) -> None:
    """Write a minimal geometry-report.json from PLY header info (no Open3D needed)."""
    import struct as _struct

    # Quick PLY bounds extraction from header
    bounds_min = [-5.0, 0.0, -5.0]
    bounds_max = [5.0, 3.0, 5.0]

    try:
        raw = ply_path.read_bytes()
        end = raw.find(b"end_header")
        if end > 0:
            header = raw[:end].decode(errors="replace")
            # Check if it's binary little-endian with float vertices
            is_binary_le = "binary_little_endian" in header
            vertex_count_line = next(
                (ln for ln in header.splitlines() if ln.strip().startswith("element vertex ")), None
            )
            if vertex_count_line:
                n_verts = int(vertex_count_line.strip().split()[-1])
                # For a rough bounds estimate on small files: sample a few vertices
                body_start = end + len(b"end_header")
                if raw[body_start:body_start + 1] in (b"\n", b"\r"):
                    body_start += 1
                if is_binary_le and n_verts > 0:
                    # Assume minimal float32 xyz per vertex (may have more properties)
                    # Count known float properties before xyz ends
                    props = [ln.strip() for ln in header.splitlines() if ln.strip().startswith("property float")]
                    xyz_props = [p for p in props if any(p.endswith(c) for c in (" x", " y", " z"))]
                    if len(xyz_props) >= 3:
                        # Try reading first few verts to estimate bounds
                        step = max(1, len(props)) * 4  # bytes per vertex (float32 only estimate)
                        sample_n = min(1000, n_verts)
                        xs, ys, zs = [], [], []
                        for i in range(sample_n):
                            off = body_start + i * step
                            if off + 12 > len(raw):
                                break
                            x, y, z = _struct.unpack_from("<3f", raw, off)
                            import math as _math
                            if all(_math.isfinite(v) for v in (x, y, z)):
                                xs.append(x); ys.append(y); zs.append(z)
                        if xs:
                            bounds_min = [min(xs), min(ys), min(zs)]
                            bounds_max = [max(xs), max(ys), max(zs)]
    except Exception:  # noqa: BLE001
        pass  # Use fallback bounds

    report = {
        "schemaVersion": 1,
        "status": "visual_ready",
        "input": str(ply_path),
        "outputs": {"glb": str(glb_path)},
        "bounds": {"min": bounds_min, "max": bounds_max},
        "warnings": [
            "Bounds estimated from PLY header sampling; full mesh analysis requires Open3D.",
            "Install Open3D (pip install open3d) for accurate Poisson surface reconstruction.",
        ],
        "generator": "run_pipeline.py (ply_to_glb fallback path)",
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"  Wrote synthetic geometry-report.json to {report_path}")


if __name__ == "__main__":
    raise SystemExit(main())
