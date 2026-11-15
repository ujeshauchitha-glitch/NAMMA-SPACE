"""Turn a reconstruction into a scene bundle for the studio viewer (apps/studio, PlayCanvas).

    python pipeline/scene_bundle.py <sparse_dir> <web_splat.sog> <out_dir> [--title T]

Writes out_dir/manifest.json, visual/<splat>, navigation/grid.json, semantic/pois.json and
quality/report.json. Two things the studio viewer needs that COLMAP does not give:

Scale. COLMAP's units are arbitrary. Without a marker in the room we guess: the phone was held at
ASSUMED_CAMERA_HEIGHT_M above the floor, and the floor is the lowest dense layer of SfM points.
The manifest says scaleStatus "estimated"; expect +-15% on a real capture. When the model is already in
metres (e.g. a dataset solved with a calibrated rig), pass --metres-per-unit and scaleStatus is "known".

Walls. The navigation grid marks a cell blocked when SfM points sit between knee and head height
in it (desks, walls), widened by the player's clearance. Cells the camera walked through are always
free, since the person filming walked there. Cells far from the filmed path are "unknown": the
splat is unreliable there, so the viewer does not walk into them.

Frame. The studio viewer applies no reconstruction->world transform (its manifest schema and
apps/studio/scripts/validate_scene.py accept only an identity worldFromReconstruction). So the splat must
already be in the bundle's world frame (levelled, metres, floor at y=0): world_alignment() gives the
transform and bake_ply() applies it to the float PLY (positions, scales, rotations and the SH colour
coefficients) before compression; build() writes identity. run_pipeline does this; by hand:
    python pipeline/scene_bundle.py --bake <sparse_dir> splat_clean.ply splat_world.ply

Views. For each walkable cell the grid also lists which way the phone faced from nearby (a bitmask of
VIEW_SECTORS compass sectors). With ?guide=1 the viewer turns the visitor gently back when they rest looking
in a direction nobody filmed from there, since that is where the splat streaks (off by default).
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


def world_alignment(sparse: Path, scratch: Path, metres_per_unit: float | None = None) -> dict:
    """COLMAP frame -> bundle world frame: world = s * R @ x + t (levelled, metres, floor at y=0, walked path
    centred on x=z=0). Also returns what build() needs from the model, in the levelled frame."""
    pts, tracks, centres, axes = load_model(sparse, scratch)
    R = level_rotation(centres, axes[:, 1])
    P, C = (pts @ R.T)[tracks >= 3], centres @ R.T
    keep = np.all((P >= np.percentile(P, 1, axis=0)) & (P <= np.percentile(P, 99, axis=0)), axis=1)
    P = P[keep]
    s, floor, ceiling = estimate_scale(P, C)
    if metres_per_unit:
        s = metres_per_unit  # the floor and ceiling still come from the points
    mid = C.mean(0)
    t = -s * np.array([mid[0], floor, mid[2]])
    return {"s": float(s), "R": R, "t": t, "P": P, "C": C, "centres": centres, "axes": axes,
            "floor": floor, "ceiling": ceiling}


def world_matrix(a: dict) -> np.ndarray:
    M = np.eye(4)
    M[:3, :3], M[:3, 3] = a["s"] * a["R"], a["t"]
    return M


# ---------------------------------------------------------------- baking the transform into a splat
SH_C1 = 0.4886025119029199
SH_C2 = (1.0925484305920792, -1.0925484305920792, 0.31539156525252005, -1.0925484305920792, 0.5462742152960396)
SH_C3 = (-0.5900435899266435, 2.890611442640554, -0.4570457994644658, 0.3731763325901154, -0.4570457994644658,
         1.445305721320277, -0.5900435899266435)


def sh_basis(d: np.ndarray, degree: int) -> np.ndarray:
    """Real SH basis without the DC term, (N, (degree+1)^2 - 1), as 3DGS/gsplat/PlayCanvas evaluate it."""
    x, y, z = d[:, 0], d[:, 1], d[:, 2]
    cols = []
    if degree >= 1:
        cols += [-SH_C1 * y, SH_C1 * z, -SH_C1 * x]
    if degree >= 2:
        xx, yy, zz = x * x, y * y, z * z
        cols += [SH_C2[0] * x * y, SH_C2[1] * y * z, SH_C2[2] * (2 * zz - xx - yy), SH_C2[3] * x * z,
                 SH_C2[4] * (xx - yy)]
    if degree >= 3:
        cols += [SH_C3[0] * y * (3 * xx - yy), SH_C3[1] * x * y * z, SH_C3[2] * y * (4 * zz - xx - yy),
                 SH_C3[3] * z * (2 * zz - 3 * xx - 3 * yy), SH_C3[4] * x * (4 * zz - xx - yy),
                 SH_C3[5] * z * (xx - yy), SH_C3[6] * x * (xx - 3 * yy)]
    return np.stack(cols, 1)


def sh_rotation(R: np.ndarray, degree: int) -> np.ndarray:
    """X with new_coeffs = X @ old_coeffs, so the rotated splat shows at direction d what the original showed
    at R^T d. Each band maps onto itself, so a least-squares fit on random directions is exact."""
    d = np.random.default_rng(0).normal(size=(256, 3))
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    A, B = sh_basis(d, degree), sh_basis(d @ R, degree)  # (d @ R)[i] = R^T d_i
    return np.linalg.lstsq(A, B, rcond=None)[0]  # Y(d) @ X = Y(R^T d), so f_new(e) = Y(e) @ X @ c = f(R^T e)


def quat_multiply(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Hamilton product of wxyz quaternions (broadcasts)."""
    aw, ax, ay, az = np.moveaxis(a, -1, 0)
    bw, bx, by, bz = np.moveaxis(b, -1, 0)
    return np.stack([aw * bw - ax * bx - ay * by - az * bz, aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw], -1)


def matrix_to_quat(R: np.ndarray) -> np.ndarray:
    w = math.sqrt(max(0.0, 1 + R[0, 0] + R[1, 1] + R[2, 2])) / 2
    x = math.copysign(math.sqrt(max(0.0, 1 + R[0, 0] - R[1, 1] - R[2, 2])) / 2, R[2, 1] - R[1, 2])
    y = math.copysign(math.sqrt(max(0.0, 1 - R[0, 0] + R[1, 1] - R[2, 2])) / 2, R[0, 2] - R[2, 0])
    z = math.copysign(math.sqrt(max(0.0, 1 - R[0, 0] - R[1, 1] + R[2, 2])) / 2, R[1, 0] - R[0, 1])
    return np.array([w, x, y, z])


def bake_ply(src: Path, dst: Path, s: float, R: np.ndarray, t: np.ndarray) -> int:
    """Write `src` (float 3DGS PLY, COLMAP frame) as `dst` in the world frame world = s * R @ x + t:
    positions, log-scales (+log s), rotations (R * q) and SH bands 1-3 (rotated). Returns the splat count."""
    from clean_splat import read_ply, write_ply

    if abs(np.linalg.det(R) - 1) > 1e-6:
        raise ValueError("world alignment must be a proper rotation")
    header, props, d = read_ply(src)
    col = {k: i for i, k in enumerate(props)}
    d = d.astype(np.float64)
    xyz = [col[k] for k in ("x", "y", "z")]
    d[:, xyz] = s * d[:, xyz] @ R.T + t
    for k in ("scale_0", "scale_1", "scale_2"):
        d[:, col[k]] += math.log(s)
    rot = [col[f"rot_{i}"] for i in range(4)]
    q = quat_multiply(matrix_to_quat(R), d[:, rot])
    d[:, rot] = q / np.linalg.norm(q, axis=1, keepdims=True)
    rest = sorted((k for k in props if k.startswith("f_rest_")), key=lambda k: int(k[7:]))
    if rest:
        k = len(rest) // 3  # coefficients per channel (channel-major: all R, then G, then B)
        degree = {3: 1, 8: 2, 15: 3}[k]
        X = sh_rotation(R, degree)
        for c in range(3):
            cols = [col[rest[c * k + i]] for i in range(k)]
            d[:, cols] = d[:, cols] @ X.T
    for k in ("nx", "ny", "nz"):
        if k in col:
            d[:, col[k]] = 0.0
    write_ply(dst, header, d.astype(np.float32))
    return len(d)


def build(sparse: Path, splat: Path, out: Path, title: str, quality: dict | None = None,
          metres_per_unit: float | None = None) -> dict:
    """`splat` must already be in the world frame (bake_ply with world_alignment's transform)."""
    a = world_alignment(sparse, out / "_sparse_txt", metres_per_unit)
    R, s, t, P, C, centres, axes = a["R"], a["s"], a["t"], a["P"], a["C"], a["centres"], a["axes"]
    floor, ceiling = a["floor"], a["ceiling"]
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
    warnings = [] if metres_per_unit else [
        f"Scale is estimated from an assumed {ASSUMED_CAMERA_HEIGHT_M} m camera height "
        f"(room height comes out at {room_h:.2f} m)."]
    if not 2.2 <= room_h <= 4.5:
        warnings.append(f"Estimated room height {room_h:.2f} m is implausible: the scale guess is probably off.")
    (out / "quality" / "report.json").write_text(json.dumps(quality or {
        "status": "needs-review", "readiness": "navigation_ready", "warnings": warnings,
        "checks": [{"id": "scale", "label": "Scale", "status": "passed" if metres_per_unit else "warning",
                    "detail": f"{s:.3f} m per model unit, {'known' if metres_per_unit else 'estimated'}"}]},
        indent=1), encoding="utf-8")

    notes = [*warnings, f"Reconstruction-to-world transform (scale {s:.4f}) baked into the splat by "
                        "scene_bundle.bake_ply, so worldFromReconstruction is identity."]
    manifest = {
        "schemaVersion": 1, "sceneId": out.name, "displayName": title,
        "sceneKind": "reconstructed-capture",
        "description": "Gaussian splat reconstructed from a smartphone video (COLMAP + Gaussian-splat training).",
        "coordinateSystem": "right-handed-y-up", "units": "metre",
        "worldFromReconstruction": np.eye(4, dtype=int).tolist(),  # the splat is baked (see bake_ply)
        "bounds": {"min": lo.round(3).tolist(), "max": hi.round(3).tolist()},
        "startPosition": start.round(3).tolist(),
        "startYawDegrees": round(math.degrees(align["spawnYaw"]), 2),
        "visualAssets": [{"kind": splat.suffix.lstrip("."), "uri": f"visual/{splat.name}", "label": title,
                          "sha256": hashlib.sha256(splat.read_bytes()).hexdigest()}],
        "collisionAsset": None, "navigationUri": "navigation/grid.json",
        "semanticUri": "semantic/pois.json", "qualityUri": "quality/report.json",
        "scaleStatus": "known" if metres_per_unit else "estimated",
        "provenance": {"pipeline": "pipeline/scene_bundle.py", "pipelineVersion": "0.1.0",
                       "capturedAt": "", "source": "Smartphone video capture", "notes": notes},
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    shutil.rmtree(out / "_sparse_txt", ignore_errors=True)
    stats = {"metres_per_unit": round(s, 4), "room_height_m": round(room_h, 2),
             "room_size_m": (hi - lo).round(2).tolist(), "grid": [nav["width"], nav["height"]],
             "blocked_cells": len(nav["blocked"]), "unknown_cells": len(nav["unknown"])}
    print("scene_bundle:", json.dumps(stats))
    return stats


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Build a scene bundle; or, with --bake, move a float PLY into the "
                                             "bundle's world frame first.")
    ap.add_argument("sparse", type=Path)
    ap.add_argument("splat", type=Path, help="world-frame web splat (or, with --bake, the COLMAP-frame float PLY)")
    ap.add_argument("out", type=Path, help="bundle folder (or, with --bake, the world-frame PLY to write)")
    ap.add_argument("--bake", action="store_true")
    ap.add_argument("--title", default="Captured room")
    ap.add_argument("--metres-per-unit", type=float, help="known model scale; skips the camera-height guess")
    a = ap.parse_args()
    if a.bake:
        al = world_alignment(a.sparse, a.out.parent / "_sparse_txt", a.metres_per_unit)
        shutil.rmtree(a.out.parent / "_sparse_txt", ignore_errors=True)
        print(f"baked {bake_ply(a.splat, a.out, al['s'], al['R'], al['t'])} splats -> {a.out}")
    else:
        build(a.sparse, a.splat, a.out, a.title, metres_per_unit=a.metres_per_unit)
