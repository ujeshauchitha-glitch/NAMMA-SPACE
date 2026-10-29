"""Clean a trained splat so it holds up away from the exact filmed viewpoints.

Training only checks the splat against the filmed views. From those views, long thin "needle"
splats, room-sized splats and nearly transparent haze all blend into a sharp picture; seen from
anywhere else they show up as streaks through furniture and fog. This pass:

  1. caps each splat's longest axis at MAX_ASPECT x its middle axis (needles become short ellipses),
  2. drops splats larger than HUGE_FRAC of the scene extent,
  3. drops splats with opacity below MIN_OPACITY.

    python pipeline/clean_splat.py in.ply out.ply

Works on Brush/3DGS binary little-endian PLYs (float32 properties). Returns counts for report.json.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

# Classroom test (29 Oct): dropping splats > 5% of the extent and below 2% opacity removed the streaks
# but darkened the whole room (large faint splats paint the floor and walls), so both are off by
# default. The aspect cap alone kept brightness; its visible effect was small at the view tested.
MAX_ASPECT = 8.0
HUGE_FRAC = float("inf")
MIN_OPACITY = 0.005
FLOATER_RADIUS_M = 0.35  # the phone and the hand holding it filled this much space around each camera


def read_ply(path: Path) -> tuple[str, list[str], np.ndarray]:
    raw = path.read_bytes()
    end = raw.index(b"end_header\n") + len(b"end_header\n")
    header = raw[:end].decode("ascii")
    lines = header.splitlines()
    if "format binary_little_endian 1.0" not in lines:
        raise ValueError(f"{path}: only binary little-endian PLY is supported")
    props = []
    for ln in lines:
        if ln.startswith("property"):
            _, typ, name = ln.split()
            if typ != "float":
                raise ValueError(f"{path}: property {name} is {typ}, expected float")
            props.append(name)
    n = int(next(ln for ln in lines if ln.startswith("element vertex")).split()[-1])
    data = np.frombuffer(raw, dtype="<f4", count=n * len(props), offset=end).reshape(n, len(props)).copy()
    return header, props, data


def write_ply(path: Path, header: str, data: np.ndarray) -> None:
    lines = [f"element vertex {len(data)}" if ln.startswith("element vertex") else ln
             for ln in header.splitlines()]
    path.write_bytes(("\n".join(lines) + "\n").encode("ascii") + data.astype("<f4").tobytes())


def camera_path(sparse: Path, scratch: Path) -> tuple[np.ndarray, float]:
    """Camera centres in capture order, and FLOATER_RADIUS_M converted to model units (estimated scale)."""
    from room_coverage import level_rotation, load_model
    from scene_bundle import estimate_scale

    pts, tracks, centres, axes = load_model(sparse, scratch)
    R = level_rotation(centres, axes[:, 1])
    metres_per_unit, _, _ = estimate_scale((pts @ R.T)[tracks >= 3], centres @ R.T)
    return centres, FLOATER_RADIUS_M / metres_per_unit


def clean(src: Path, dst: Path, max_aspect: float = MAX_ASPECT, huge_frac: float = HUGE_FRAC,
          min_opacity: float = MIN_OPACITY, cameras: np.ndarray | None = None, camera_radius: float = 0.0) -> dict:
    """`cameras` (M,3) with `camera_radius` (model units): splats centred that close to a camera position
    are floaters, since the phone was carried through that space and nothing solid can be there."""
    header, props, d = read_ply(src)
    col = {k: i for i, k in enumerate(props)}
    sc = [col["scale_0"], col["scale_1"], col["scale_2"]]
    n0 = len(d)

    # Scales are stored as logs: capping the aspect ratio is a clamp in log space.
    logs = d[:, sc]
    order = np.argsort(logs, axis=1)
    mid = np.take_along_axis(logs, order[:, 1:2], axis=1)[:, 0]
    cap = mid + np.log(max_aspect)
    longest = order[:, 2]
    rows = np.arange(n0)
    needles = logs[rows, longest] > cap
    logs[rows, longest] = np.minimum(logs[rows, longest], cap)
    d[:, sc] = logs

    xyz = d[:, [col["x"], col["y"], col["z"]]]
    extent = float(np.linalg.norm(np.percentile(xyz, 99, axis=0) - np.percentile(xyz, 1, axis=0)))
    size = np.exp(logs.max(axis=1))
    opacity = 1 / (1 + np.exp(-d[:, col["opacity"]]))
    huge = size > huge_frac * extent
    faint = opacity < min_opacity
    floater = np.zeros(n0, bool)
    if cameras is not None and camera_radius > 0:
        from scipy.spatial import cKDTree

        # Densify the camera path (consecutive frames) so the whole walked tube is covered, not just beads.
        # Only short hops are filled in: a long one means the frames are not in walking order.
        steps = [a + (b - a) * t for a, b in zip(cameras[:-1], cameras[1:])
                 if np.linalg.norm(b - a) < 4 * camera_radius for t in np.linspace(0, 1, 5)[:-1]]
        path = np.vstack([*steps, cameras[-1:]]) if len(cameras) > 1 else cameras
        dist, _ = cKDTree(path).query(xyz, distance_upper_bound=camera_radius)
        floater = np.isfinite(dist)
    keep = ~(huge | faint | floater)
    write_ply(dst, header, d[keep])
    stats = {"splats_in": n0, "splats_out": int(keep.sum()), "needles_capped": int(needles.sum()),
             "huge_removed": int(huge.sum()), "faint_removed": int((faint & ~huge).sum()),
             "floaters_removed": int((floater & ~huge & ~faint).sum()),
             "max_aspect": max_aspect, "huge_frac": huge_frac, "min_opacity": min_opacity,
             "camera_radius": camera_radius}
    print(f"clean_splat: {n0} -> {stats['splats_out']} splats; capped {stats['needles_capped']} needles, "
          f"removed {stats['huge_removed']} huge, {stats['faint_removed']} faint and "
          f"{stats['floaters_removed']} floaters on the camera path")
    return stats


if __name__ == "__main__":
    clean(Path(sys.argv[1]), Path(sys.argv[2]))
