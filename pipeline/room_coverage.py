"""Coverage layers on a COLMAP sparse model, plus the viewer alignment derived from it.

Layer 1  map     which parts of the room were seen (top-down map, cells seen by >= MIN_CAMS cameras)
Layer 2  verify  is the room closed: floor plan, floor, ceiling and all four walls observed
Layer 3  gaps    each unseen patch becomes an instruction: where to stand, which way to face

    python pipeline/room_coverage.py <sparse_dir> <out_dir>

Writes coverage.json, coverage_topdown.png and RECAPTURE.txt into out_dir. Exit code 0 when the
room verifies, 2 when gaps remain. It needs only COLMAP points and camera poses, so it runs in
seconds, right after SfM and before training: gaps are found while the phone is still in hand.

Limits: sparse points are thin on plain walls, so a blank wall can read as a gap even when the
splat shows it. Treat the report as "film this again to be sure", not as proof of a hole.
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import find_tool  # noqa: E402

CELL_FRAC = 1 / 40   # grid cell = 1/40 of the room's longest side (the model is not metric)
MIN_CAMS = 3         # a cell counts as seen when its points were observed by >= this many cameras
PASS_FRAC = 0.85     # a face is "closed" at this seen fraction
MIN_GAP_CELLS = 4    # smaller unseen patches are noise


def _quat_to_r(w, x, y, z) -> np.ndarray:
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def load_model(sparse: Path, scratch: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return points (N,3), track lengths (N,), camera centres (M,3), camera forward/up (M,2,3)."""
    if not (sparse / "points3D.txt").exists():
        scratch.mkdir(parents=True, exist_ok=True)  # never inside the dataset: Brush would see a 2nd model
        subprocess.run([find_tool("colmap"), "model_converter", "--input_path", str(sparse),
                        "--output_path", str(scratch), "--output_type", "TXT"], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        sparse = scratch
    pts, tracks = [], []
    for line in (sparse / "points3D.txt").read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        p = line.split()
        pts.append([float(v) for v in p[1:4]])
        tracks.append(len({p[i] for i in range(8, len(p), 2)}))
    centres, axes = [], []
    # Each image is a pose line then a 2D-points line, which is empty for an image without points,
    # so empty lines must be kept for the pairing to hold.
    rows = [ln for ln in (sparse / "images.txt").read_text().splitlines() if not ln.startswith("#")]
    for ln in rows[::2]:
        p = ln.split()
        R = _quat_to_r(*map(float, p[1:5]))
        t = np.array(p[5:8], float)
        centres.append(-R.T @ t)
        axes.append([R.T[:, 2], -R.T[:, 1]])  # COLMAP camera: +z forward, -y up
    if len(centres) < 3 or not pts:
        raise ValueError(f"{sparse}: too few cameras/points for coverage")
    return np.array(pts), np.array(tracks), np.array(centres), np.array(axes)


def level_rotation(centres: np.ndarray, ups: np.ndarray) -> np.ndarray:
    """Rotation that makes the plane the camera walked in horizontal, with the cameras' up as +y.

    A hand-held walk keeps the phone at roughly constant height, so the camera centres span a
    plane parallel to the floor; its normal (smallest singular vector) is "up".
    """
    _, _, vt = np.linalg.svd(centres - centres.mean(0))
    n = vt[2] * np.sign(vt[2] @ ups.mean(0))
    y = np.array([0.0, 1.0, 0.0])
    v, c = np.cross(n, y), float(n @ y)
    s = np.linalg.norm(v)
    if s < 1e-9:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K * ((1 - c) / s ** 2)


def euler_xyz(R: np.ndarray) -> list[float]:
    """three.js Euler 'XYZ' angles for rotation matrix R."""
    ry = math.asin(max(-1.0, min(1.0, R[0, 2])))
    return [math.atan2(-R[1, 2], R[2, 2]), ry, math.atan2(-R[0, 1], R[0, 0])]


def viewer_alignment(centres, axes) -> dict:
    """scene.json fields: level rotation, spawn at the real camera pose nearest the walk's centre,
    facing where that camera faced, and walk bounds around the camera path (+15% margin)."""
    R = level_rotation(centres, axes[:, 1])
    C = centres @ R.T
    fwd = axes[:, 0] @ R.T
    # Spawn where the first view shows the most room: a real camera near the edge of the walk that was
    # looking back across the middle (not one in the middle that may face a wall a metre away).
    to_mid = C.mean(0) - C
    dist = np.linalg.norm(to_mid[:, [0, 2]], axis=1)
    facing = np.einsum("ij,ij->i", fwd[:, [0, 2]], to_mid[:, [0, 2]]) / np.maximum(
        dist * np.linalg.norm(fwd[:, [0, 2]], axis=1), 1e-9)
    i = int(np.argmax(np.where(facing > 0.8, dist, -1.0)))
    if facing[i] <= 0.8:  # nobody looked inwards: fall back to the camera nearest the middle
        i = int(np.argmin(dist))
    lo, hi = C.min(0), C.max(0)
    pad = (hi - lo) * 0.15
    # A splat only looks right near the views it was trained from, so the viewer keeps the visitor within
    # walkRadius of the filmed path (camera centres in capture order; COLMAP lists images by id = name order).
    path = C[:, [0, 2]]
    keep = [0]
    for k in range(1, len(path)):  # drop near-duplicates to keep scene.json small
        if np.linalg.norm(path[k] - path[keep[-1]]) > 0.02 * float((hi - lo).max()):
            keep.append(k)
    return {"rotation": euler_xyz(R), "spawn": C[i].round(3).tolist(),
            "walkPath": [[round(float(x), 3), round(float(z), 3)] for x, z in path[keep]],
            "walkRadius": round(0.08 * float((hi - lo)[[0, 2]].max()), 3),
            "spawnYaw": round(math.atan2(-fwd[i, 0], -fwd[i, 2]), 3), "eyeHeight": 0,
            "bounds": [round(float(v), 3) for v in (lo[0] - pad[0], hi[0] + pad[0], lo[2] - pad[2], hi[2] + pad[2])],
            "spawn_image_index": i}


def analyse(sparse: Path, out: Path) -> dict:
    import cv2
    from scipy import ndimage

    out.mkdir(parents=True, exist_ok=True)
    pts, tracks, centres, axes = load_model(sparse, out / "sparse_txt")
    R = level_rotation(centres, axes[:, 1])
    P, C = pts @ R.T, centres @ R.T

    # Room box from robust percentiles, so points seen through windows/doors don't inflate it.
    lo, hi = np.percentile(P, 2, axis=0), np.percentile(P, 98, axis=0)
    keep = np.all((P >= lo) & (P <= hi), axis=1)
    P, tracks = P[keep], tracks[keep]
    size = hi - lo
    n = np.maximum(np.ceil(size / (size.max() * CELL_FRAC)).astype(int), 2)
    idx = np.minimum(((P - lo) / size * n).astype(int), n - 1)

    # Layer 1: a cell is seen when at least one point in it was observed by >= MIN_CAMS cameras.
    # Sparse SfM points are patchy, so a seen cell also vouches for its direct neighbours.
    seen = np.zeros(n, bool)
    good = idx[tracks >= MIN_CAMS]
    seen[good[:, 0], good[:, 1], good[:, 2]] = True
    seen = ndimage.binary_dilation(seen)
    top = seen.any(axis=1)  # (x, z) floor plan

    # Layer 2: each face of the box is a 2D slab two cells deep.
    t = 2
    faces = {  # name -> (2D seen map, axis normal to the face, side)
        "floor": (seen[:, :t].any(1), 1, 0), "ceiling": (seen[:, -t:].any(1), 1, 1),
        "-x wall": (seen[:t].any(0), 0, 0), "+x wall": (seen[-t:].any(0), 0, 1),
        "-z wall": (seen[:, :, :t].any(2), 2, 0), "+z wall": (seen[:, :, -t:].any(2), 2, 1),
    }
    fractions = {name: round(float(m.mean()), 3) for name, (m, _, _) in faces.items()}
    plan = round(float(top.mean()), 3)
    verified = plan >= PASS_FRAC and all(f >= PASS_FRAC for f in fractions.values())

    # Layer 3: unseen patches -> where to stand and what to face.
    centre = C.mean(0)
    gaps = []
    for name, (m, axis, side) in faces.items():
        k, lab, stats, cent = cv2.connectedComponentsWithStats((~m).astype(np.uint8), connectivity=4)
        dims = [d for d in range(3) if d != axis]  # m is indexed (dims[0], dims[1])
        for r in range(1, k):
            cells = int(stats[r, cv2.CC_STAT_AREA])
            if cells < MIN_GAP_CELLS:
                continue
            c1, c0 = cent[r]  # OpenCV gives (col, row) = (dims[1], dims[0])
            target = np.empty(3)
            target[axis] = hi[axis] if side else lo[axis]
            target[dims[0]] = lo[dims[0]] + (c0 + 0.5) / n[dims[0]] * size[dims[0]]
            target[dims[1]] = lo[dims[1]] + (c1 + 0.5) / n[dims[1]] * size[dims[1]]
            # Stand on the camera-path height, a third of the way from the walk's centre towards it.
            stand = centre + (target - centre) * 0.35
            stand[1] = centre[1]
            gaps.append({"face": name, "cells": cells, "fraction_of_face": round(cells / m.size, 3),
                         "target": target.round(2).tolist(), "stand_at": stand.round(2).tolist()})
    gaps.sort(key=lambda g: -g["cells"])

    report = {"verified": verified, "floor_plan_seen": plan, "faces_seen": fractions,
              "grid": n.tolist(), "room_size_model_units": size.round(2).tolist(),
              "cameras": len(C), "points_used": int(len(P)), "gaps": gaps}
    (out / "coverage.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    # Top-down picture: grey = seen, dark = unseen, red dots = camera path.
    s = 12
    img = np.where(top.T[::-1], 200, 45).astype(np.uint8)
    img = cv2.cvtColor(cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_NEAREST), cv2.COLOR_GRAY2BGR)
    for c in C:
        u = int((c[0] - lo[0]) / size[0] * n[0] * s)
        v = int((1 - (c[2] - lo[2]) / size[2]) * n[2] * s)
        cv2.circle(img, (u, v), 3, (0, 0, 255), -1)
    cv2.imwrite(str(out / "coverage_topdown.png"), img)

    lines = ["ROOM VERIFIED: every face observed." if verified else
             "ROOM NOT CLOSED: film the patches below, then run the pipeline again.",
             f"floor plan seen {plan:.0%}; " + ", ".join(f"{k} {v:.0%}" for k, v in fractions.items()),
             "Coordinates are in the levelled model frame (same as the viewer). Largest gaps first.", ""]
    for g in gaps[:15]:
        sx, _, sz = g["stand_at"]
        tx, ty, tz = g["target"]
        lines.append(f"- {g['face']}: {g['fraction_of_face']:.0%} of it unseen. Stand at ({sx:.1f}, {sz:.1f}), "
                     f"face ({tx:.1f}, {ty:.1f}, {tz:.1f}); pan slowly across it from two positions a step apart.")
    (out / "RECAPTURE.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:2]))
    return report


if __name__ == "__main__":
    sys.exit(0 if analyse(Path(sys.argv[1]), Path(sys.argv[2]))["verified"] else 2)
