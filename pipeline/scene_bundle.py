"""Turn a reconstruction into a scene bundle for the studio viewer (apps/studio, PlayCanvas).

    python pipeline/scene_bundle.py <sparse_dir> <web_splat.sog> <out_dir> [--title T]

Writes out_dir/manifest.json, visual/<splat>, navigation/grid.json, semantic/pois.json and
quality/report.json. Two things the studio viewer needs that COLMAP does not give:

Scale. COLMAP's units are arbitrary. Without a marker in the room we guess: the phone was held at
ASSUMED_CAMERA_HEIGHT_M above the floor, and the floor is the lowest dense layer of SfM points.
The manifest says scaleStatus "estimated"; expect +-15% on a real capture.

Walls. The navigation grid marks a cell blocked when SfM points sit between knee and head height
in it (desks, walls), widened by the player's clearance. Cells the camera walked through are always
free, since the person filming walked there. Cells far from the filmed path are "unknown": the
splat is unreliable there, so the viewer does not walk into them.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from room_coverage import level_rotation, load_model, viewer_alignment  # noqa: E402

ASSUMED_CAMERA_HEIGHT_M = 1.45  # phone held at chest height while walking
CELL_M = 0.10                   # navigation grid resolution
CLEARANCE_M = 0.25              # player radius: blocked cells are widened by this
OBSTACLE_BAND_M = (0.25, 1.9)   # points in this height band block walking (floor and ceiling do not)
MIN_POINTS = 2                  # points per cell to count as an obstacle (single points are noise)
# Beyond this distance from the filmed path cells are "unknown". A splat is only sharp near the views
# it was trained from: at 1.5 m visitors reached spots that looked like smeared paint, so keep it tight.
FILMED_RADIUS_M = 0.75
WALKED_RADIUS_M = 0.2           # cells this close to a camera position are always free


def estimate_scale(P: np.ndarray, C: np.ndarray) -> tuple[float, float, float]:
    """Return (metres per model unit, floor height, ceiling height) in the levelled frame."""
    cam_y = float(np.median(C[:, 1]))
    below, above = P[P[:, 1] < cam_y, 1], P[P[:, 1] > cam_y, 1]
    if len(below) < 20:
        raise ValueError("too few points below the camera path to find the floor")
    floor = float(np.percentile(below, 3))
    ceiling = float(np.percentile(above, 97)) if len(above) >= 20 else cam_y + (cam_y - floor)
    return ASSUMED_CAMERA_HEIGHT_M / (cam_y - floor), floor, ceiling


def _disk(r: int) -> np.ndarray:
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def navigation_grid(W: np.ndarray, Cw: np.ndarray, lo: np.ndarray, hi: np.ndarray, start: np.ndarray) -> dict:
    """W, Cw: points and camera centres in world metres (floor at y=0)."""
    from scipy import ndimage

    w = int(math.ceil((hi[0] - lo[0]) / CELL_M))
    h = int(math.ceil((hi[2] - lo[2]) / CELL_M))

    def cells(xz):
        ij = np.floor((xz - [lo[0], lo[2]]) / CELL_M).astype(int)
        ok = (ij[:, 0] >= 0) & (ij[:, 0] < w) & (ij[:, 1] >= 0) & (ij[:, 1] < h)
        return ij[ok]

    band = W[(W[:, 1] > OBSTACLE_BAND_M[0]) & (W[:, 1] < OBSTACLE_BAND_M[1])]
    count = np.zeros((h, w), int)
    ij = cells(band[:, [0, 2]])
    np.add.at(count, (ij[:, 1], ij[:, 0]), 1)
    blocked = ndimage.binary_dilation(count >= MIN_POINTS, _disk(round(CLEARANCE_M / CELL_M)))

    walked = np.zeros((h, w), bool)
    ij = cells(Cw[:, [0, 2]])
    walked[ij[:, 1], ij[:, 0]] = True
    filmed = ndimage.binary_dilation(walked, _disk(round(FILMED_RADIUS_M / CELL_M)))
    walked = ndimage.binary_dilation(walked, _disk(round(WALKED_RADIUS_M / CELL_M)))
    # Consecutive camera positions are walked ground too, even when the gap between them is > 1 cell.
    for a, b in zip(Cw[:-1], Cw[1:]):
        for t in np.linspace(0, 1, max(2, int(np.linalg.norm((b - a)[[0, 2]]) / (CELL_M / 2)))):
            p = cells((a + (b - a) * t)[None, [0, 2]])
            if len(p):
                walked[p[0, 1], p[0, 0]] = True

    blocked &= ~walked
    unknown = ~filmed & ~blocked
    sx, sz = cells(start[None, [0, 2]])[0]
    flat = lambda m: np.flatnonzero(m.ravel()).tolist()  # index = z * width + x
    return {"version": 1, "coordinateSystem": "x-z-grid",
            "origin": {"x": round(float(lo[0]), 3), "z": round(float(lo[2]), 3)},
            "cellSize": CELL_M, "width": w, "height": h,
            "blocked": flat(blocked), "unknown": flat(unknown),
            "start": {"x": int(sx), "z": int(sz)}, "clearanceMetres": CLEARANCE_M}


def build(sparse: Path, splat: Path, out: Path, title: str, quality: dict | None = None) -> dict:
    pts, tracks, centres, axes = load_model(sparse, out / "_sparse_txt")
    R = level_rotation(centres, axes[:, 1])
    P, C = (pts @ R.T)[tracks >= 3], centres @ R.T
    keep = np.all((P >= np.percentile(P, 1, axis=0)) & (P <= np.percentile(P, 99, axis=0)), axis=1)
    P = P[keep]
    s, floor, ceiling = estimate_scale(P, C)
    mid = C.mean(0)
    t = -s * np.array([mid[0], floor, mid[2]])
    to_world = lambda X: s * X + t  # levelled model units -> metres, floor at y=0, path centred on 0
    W, Cw = to_world(P), to_world(C)

    lo = np.percentile(W, 1, axis=0)
    hi = np.percentile(W, 99, axis=0)
    lo[1], hi[1] = 0.0, max(float(hi[1]), 2.2)
    align = viewer_alignment(centres, axes)
    start = Cw[align["spawn_image_index"]].copy()
    start[1] = ASSUMED_CAMERA_HEIGHT_M  # eye at the height the views were filmed from: sharpest there
    nav = navigation_grid(W, Cw, lo, hi, start)

    out.mkdir(parents=True, exist_ok=True)
    for d in ("visual", "navigation", "semantic", "quality"):
        (out / d).mkdir(exist_ok=True)
    shutil.copy2(splat, out / "visual" / splat.name)
    (out / "navigation" / "grid.json").write_text(json.dumps(nav), encoding="utf-8")
    pois = [{"id": "start", "label": "Start", "category": "entrance", "position": start.round(3).tolist(),
             "approachPoint": start.round(3).tolist(), "aliases": ["spawn", "entrance"],
             "description": "Where the walk-through begins (a real camera position from the capture).",
             "confidence": 1, "source": "operator"}]
    (out / "semantic" / "pois.json").write_text(json.dumps(pois, indent=1), encoding="utf-8")
    room_h = (ceiling - floor) * s
    warnings = [f"Scale is estimated from an assumed {ASSUMED_CAMERA_HEIGHT_M} m camera height "
                f"(room height comes out at {room_h:.2f} m)."]
    if not 2.2 <= room_h <= 4.5:
        warnings.append(f"Estimated room height {room_h:.2f} m is implausible: the scale guess is probably off.")
    (out / "quality" / "report.json").write_text(json.dumps(quality or {
        "status": "needs-review", "readiness": "navigation_ready", "warnings": warnings,
        "checks": [{"id": "scale", "label": "Scale", "status": "warning",
                    "detail": f"{s:.3f} m per model unit, estimated"}]}, indent=1), encoding="utf-8")

    M = np.eye(4)
    M[:3, :3], M[:3, 3] = s * R, t
    manifest = {
        "schemaVersion": 1, "sceneId": out.name, "displayName": title,
        "sceneKind": "reconstructed-capture",
        "description": "Gaussian splat reconstructed from a smartphone video (COLMAP + Brush).",
        "coordinateSystem": "right-handed-y-up", "units": "metre",
        "worldFromReconstruction": [[round(float(v), 6) for v in row] for row in M],
        "bounds": {"min": lo.round(3).tolist(), "max": hi.round(3).tolist()},
        "startPosition": start.round(3).tolist(),
        "startYawDegrees": round(math.degrees(align["spawnYaw"]), 2),
        "visualAssets": [{"kind": splat.suffix.lstrip("."), "uri": f"visual/{splat.name}", "label": title,
                          "sha256": hashlib.sha256(splat.read_bytes()).hexdigest()}],
        "collisionAsset": None, "navigationUri": "navigation/grid.json",
        "semanticUri": "semantic/pois.json", "qualityUri": "quality/report.json",
        "scaleStatus": "estimated",
        "provenance": {"pipeline": "pipeline/scene_bundle.py", "pipelineVersion": "0.1.0",
                       "capturedAt": "", "source": "Smartphone video capture", "notes": warnings},
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    shutil.rmtree(out / "_sparse_txt", ignore_errors=True)
    stats = {"metres_per_unit": round(s, 4), "room_height_m": round(room_h, 2),
             "room_size_m": (hi - lo).round(2).tolist(), "grid": [nav["width"], nav["height"]],
             "blocked_cells": len(nav["blocked"]), "unknown_cells": len(nav["unknown"])}
    print("scene_bundle:", json.dumps(stats))
    return stats


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("sparse", type=Path)
    ap.add_argument("splat", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--title", default="Captured room")
    a = ap.parse_args()
    build(a.sparse, a.splat, a.out, a.title)
