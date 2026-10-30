"""Honesty tests for apps/studio/scripts/generate_scene_bundle.py quality report.

The quality report must describe what the generator actually verified
(nav file supplied -> parses -> footprint consistent with manifest bounds)
and must list unmeasured properties under ``notMeasured`` instead of
claiming a blanket "passed" whenever a navigation file was handed in.
"""

import json
import struct
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
GENERATOR = ROOT / "apps" / "studio" / "scripts" / "generate_scene_bundle.py"

# Bounds shared by the synthetic geometry report: XZ footprint [-2, 2] x [-2, 2].
BOUNDS_MIN = [-2.0, 0.0, -2.0]
BOUNDS_MAX = [2.0, 3.0, 2.0]


def make_glb(path: Path) -> None:
    body = b"\x00" * 64
    header = b"glTF" + struct.pack("<I", 2) + struct.pack("<I", 12 + len(body))
    path.write_bytes(header + body)


def nav_data(origin_x: float, origin_z: float, width: int, height: int, cell: float = 1.0) -> dict:
    return {
        "version": 1,
        "coordinateSystem": "x-z-grid",
        "origin": {"x": origin_x, "z": origin_z},
        "cellSize": cell,
        "width": width,
        "height": height,
        "blocked": [],
        "unknown": [],
        "start": {"x": 0, "z": 0},
        "clearanceMetres": 0.3,
    }


def run_generator(tmp_path: Path, navigation: dict | None) -> Path:
    visual = tmp_path / "scene.glb"
    make_glb(visual)
    geometry = tmp_path / "geometry-report.json"
    geometry.write_text(json.dumps({"bounds": {"min": BOUNDS_MIN, "max": BOUNDS_MAX}}))
    semantic = tmp_path / "pois.json"
    semantic.write_text(json.dumps([{"id": "poi-1"}]))
    output = tmp_path / "bundle"

    command = [
        sys.executable,
        str(GENERATOR),
        "--output", str(output),
        "--visual-asset", str(visual),
        "--geometry-report", str(geometry),
        "--semantic", str(semantic),
        "--scene-id", "test-scene",
        "--display-name", "Test scene",
        "--source", "unit test",
    ]
    if navigation is not None:
        nav_path = tmp_path / "nav-data.json"
        nav_path.write_text(json.dumps(navigation))
        command += ["--navigation", str(nav_path)]

    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"
    return output


def read_quality(output: Path) -> dict:
    return json.loads((output / "quality" / "report.json").read_text(encoding="utf-8"))


def test_nav_missing_is_not_passed(tmp_path: Path) -> None:
    quality = read_quality(run_generator(tmp_path, navigation=None))
    assert quality["status"] != "passed"
    assert quality["status"] == "needs-review"
    assert quality["readiness"] == "visual_ready"
    navigation_check = next(c for c in quality["checks"] if c["id"] == "navigation")
    assert navigation_check["status"] != "passed"
    assert quality["measured"]["navigationSupplied"] is False
    assert quality["measured"]["navigationBoundsConsistentWithManifest"] is None
    assert any("route smoke tests" in item for item in quality["notMeasured"])


def test_nav_inconsistent_bounds_is_not_passed(tmp_path: Path) -> None:
    # Grid footprint starts at (50, 50) — nowhere near the manifest bounds [-2, 2].
    bad_nav = nav_data(origin_x=50.0, origin_z=50.0, width=4, height=4)
    quality = read_quality(run_generator(tmp_path, navigation=bad_nav))
    assert quality["status"] != "passed"
    assert quality["status"] == "needs-review"
    assert quality["readiness"] == "visual_ready"
    navigation_check = next(c for c in quality["checks"] if c["id"] == "navigation")
    assert navigation_check["status"] == "failed"
    assert "bounds" in navigation_check["detail"].lower()
    assert any("bounds" in warning.lower() for warning in quality["warnings"])
    assert quality["measured"]["navigationSupplied"] is True
    assert quality["measured"]["navigationBoundsConsistentWithManifest"] is False
    assert any("route smoke tests" in item for item in quality["notMeasured"])


def test_nav_consistent_bounds_is_passed_with_not_measured_list(tmp_path: Path) -> None:
    # Grid footprint exactly covers the manifest XZ bounds [-2, 2] x [-2, 2].
    good_nav = nav_data(origin_x=-2.0, origin_z=-2.0, width=4, height=4)
    quality = read_quality(run_generator(tmp_path, navigation=good_nav))
    assert quality["status"] == "passed"
    assert quality["readiness"] == "validated"
    navigation_check = next(c for c in quality["checks"] if c["id"] == "navigation")
    assert navigation_check["status"] == "passed"
    assert quality["measured"]["navigationSupplied"] is True
    assert quality["measured"]["navigationBoundsConsistentWithManifest"] is True
    # Passing must still not imply everything was measured.
    assert isinstance(quality["notMeasured"], list) and quality["notMeasured"]
    assert any("route smoke tests" in item for item in quality["notMeasured"])


def test_nav_overshoot_within_one_cell_still_consistent(tmp_path: Path) -> None:
    # make_nav_grid.py builds the grid with ceil(), so a grid may overshoot the
    # bounds by up to one cell; that must not count as an inconsistency.
    overshoot_nav = nav_data(origin_x=-2.0, origin_z=-2.0, width=5, height=4, cell=1.0)
    quality = read_quality(run_generator(tmp_path, navigation=overshoot_nav))
    assert quality["status"] == "passed"
    assert quality["measured"]["navigationBoundsConsistentWithManifest"] is True


def test_fixture_quality_reports_declare_not_measured() -> None:
    """Shipped fixture bundles must carry the notMeasured field honestly."""
    for fixture in ("fixture", "glb-fixture"):
        report_path = ROOT / "apps" / "studio" / "public" / "scenes" / fixture / "quality" / "report.json"
        report = json.loads(report_path.read_text(encoding="utf-8"))
        assert isinstance(report.get("notMeasured"), list) and report["notMeasured"], (
            f"{fixture} quality report must list what was never measured"
        )
