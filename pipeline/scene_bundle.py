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

Views. For each walkable cell the grid also lists which way the phone faced from nearby (a bitmask of
VIEW_SECTORS compass sectors). The viewer turns the visitor gently back when they look in a direction
nobody filmed from there, since that is where the splat streaks.
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
# it was trained from: at 1.5 m visitors reached spots that looked like smeared paint, and at 0.75 m the
# low views between desks still streaked, so keep it tight.
FILMED_RADIUS_M = 0.5
WALKED_RADIUS_M = 0.2           # cells this close to a camera position are always free
VIEW_SECTORS = 16               # compass sectors (22.5 degrees) for the per-cell filmed directions
VIEW_RADIUS_M = 1.0             # a camera within this distance counts as a view from the cell
MIN_VIEW_FRAMES = 3             # frames a sector needs to count as filmed (one or two glances still streak)


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


def view_masks(Cw: np.ndarray, Fw: np.ndarray, lo: np.ndarray, w: int, h: int) -> np.ndarray:
    """Per cell, a bitmask of the compass sectors at least MIN_VIEW_FRAMES cameras within VIEW_RADIUS_M
    faced. Sector k covers headings atan2(x, z) in [k, k+1) * 360 / VIEW_SECTORS degrees."""
    heading = np.arctan2(Fw[:, 0], Fw[:, 2]) % (2 * math.pi)
    sector = np.minimum((heading / (2 * math.pi) * VIEW_SECTORS).astype(int), VIEW_SECTORS - 1)
    xs = lo[0] + (np.arange(w) + 0.5) * CELL_M
    zs = lo[2] + (np.arange(h) + 0.5) * CELL_M
    counts = np.zeros((VIEW_SECTORS, h, w), np.int32)
    for c, k in zip(Cw, sector):
        d2 = (xs[None, :] - c[0]) ** 2 + (zs[:, None] - c[2]) ** 2
        counts[k][d2 <= VIEW_RADIUS_M ** 2] += 1
    return ((counts >= MIN_VIEW_FRAMES) * (1 << np.arange(VIEW_SECTORS))[:, None, None]).sum(0)


def navigation_grid(W: np.ndarray, Cw: np.ndarray, lo: np.ndarray, hi: np.ndarray, start: np.ndarray,
                    Fw: np.ndarray | None = None) -> dict:
    """W, Cw: points and camera centres in world metres (floor at y=0); Fw: camera forward directions."""
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
    grid = {"version": 1, "coordinateSystem": "x-z-grid",
            "origin": {"x": round(float(lo[0]), 3), "z": round(float(lo[2]), 3)},
            "cellSize": CELL_M, "width": w, "height": h,
            "blocked": flat(blocked), "unknown": flat(unknown),
            "start": {"x": int(sx), "z": int(sz)}, "clearanceMetres": CLEARANCE_M}
    if Fw is not None:
        views = view_masks(Cw, Fw, lo, w, h)
        views[blocked | unknown] = 0
        grid.update(viewSectors=VIEW_SECTORS, views=views.ravel().tolist())
    return grid


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
    # The grid must hold every camera position (the start is one): on a partial reconstruction the walked path
    # can stick out past the 1st/99th percentile of the points.
    lo[[0, 2]] = np.minimum(lo[[0, 2]], Cw[:, [0, 2]].min(0) - CELL_M)
    hi[[0, 2]] = np.maximum(hi[[0, 2]], Cw[:, [0, 2]].max(0) + CELL_M)
    align = viewer_alignment(centres, axes)
    start = Cw[align["spawn_image_index"]].copy()
    start[1] = ASSUMED_CAMERA_HEIGHT_M  # eye at the height the views were filmed from: sharpest there
    nav = navigation_grid(W, Cw, lo, hi, start, axes[:, 0] @ R.T)

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
