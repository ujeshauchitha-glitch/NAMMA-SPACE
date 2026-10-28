"""Output checks. A stage only counts as done if its output passes these."""
from __future__ import annotations

import re
from pathlib import Path

from common import Report, find_tool, run

# Thresholds (documented in docs/SOP.md "Pass criteria").
MIN_REGISTRATION = 0.90
WARN_REGISTRATION = 0.60
MAX_REPROJ_PX = 1.5
MIN_SPARSE_POINTS = 2000
MIN_SPLATS = 50_000

REQUIRED_PLY_PROPS = {"x", "y", "z", "opacity", "scale_0", "scale_1", "scale_2",
                      "rot_0", "rot_1", "rot_2", "rot_3", "f_dc_0", "f_dc_1", "f_dc_2"}


def colmap_model_stats(model_dir: Path, log: Path) -> dict:
    """Parse `colmap model_analyzer`. Missing fields stay None and make the check fail, never pass."""
    out = run([find_tool("colmap"), "model_analyzer", "--path", str(model_dir)], log, "model_analyzer")

    def grab(pattern: str, cast=float):
        m = re.search(pattern, out)
        return cast(m.group(1)) if m else None

    return {
        "registered_images": grab(r"Registered images:\s*(\d+)", int),
        "points3d": grab(r"Points:\s*(\d+)", int),
        "mean_reprojection_error_px": grab(r"Mean reprojection error:\s*([\d.]+)"),
        "mean_track_length": grab(r"Mean track length:\s*([\d.]+)"),
    }


def split_extra_models(extra_sizes: list[int], total_frames: int, min_frac: float = 0.10, min_images: int = 10) -> tuple[int, list[int]]:
    """Separate real splits from scraps. COLMAP often leaves a tiny fragment (a few images) next to a
    main model that registered every frame; that is not "the room split". `extra_sizes` are the registered
    image counts of every model except the best one. Returns (number of significant extra models, scrap sizes)."""
    cutoff = max(min_images, round(min_frac * total_frames))
    return sum(1 for n in extra_sizes if n >= cutoff), [n for n in extra_sizes if n < cutoff]


def check_sfm(report: Report, stats: dict, total_frames: int, extra_models: int) -> bool:
    ok = True
    reg, pts, err = stats["registered_images"], stats["points3d"], stats["mean_reprojection_error_px"]
    if reg is None or pts is None:
        return report.check("sfm_stats_parsed", False, f"could not parse model_analyzer output: {stats}")
    ratio = reg / max(total_frames, 1)
    report.data["sfm"] = {**stats, "frames_total": total_frames, "registration_ratio": round(ratio, 3)}
    ok &= report.check("sfm_registration", ratio >= WARN_REGISTRATION,
                       f"{reg}/{total_frames} frames registered ({ratio:.0%}); need >= {WARN_REGISTRATION:.0%}")
    if WARN_REGISTRATION <= ratio < MIN_REGISTRATION:
        report.check("sfm_registration_good", False,
                     f"{ratio:.0%} < {MIN_REGISTRATION:.0%}: expect holes; re-shoot weak areas (see SOP failure modes)", "warn")
    ok &= report.check("sfm_points", pts >= MIN_SPARSE_POINTS, f"{pts} sparse points; need >= {MIN_SPARSE_POINTS}")
    if err is not None:
        report.check("sfm_reprojection_error", err <= MAX_REPROJ_PX, f"{err:.2f} px mean; want <= {MAX_REPROJ_PX}", "warn")
    if extra_models:
        report.check("sfm_single_model", False,
                     f"{extra_models} extra disconnected model(s): the room split. Re-shoot doorways/overlap.", "warn")
    return ok


def read_ply_header(path: Path) -> tuple[int, list[str], int]:
    props: list[str] = []
    count = 0
    with open(path, "rb") as f:
        if f.readline().strip() != b"ply":
            raise ValueError("not a PLY file")
        fmt = f.readline().decode().strip()
        if "binary_little_endian" not in fmt:
            raise ValueError(f"unsupported PLY format {fmt!r} (need binary_little_endian)")
        while True:
            line = f.readline()
            if not line:
                raise ValueError("PLY header never ended")
            s = line.decode().strip()
            if s.startswith("element vertex"):
                count = int(s.split()[-1])
            elif s.startswith("property"):
                props.append(s.split()[-1])
            elif s == "end_header":
                return count, props, f.tell()


def check_splat(report: Report, ply: Path) -> bool:
    """Validate a trained splat: exists, parses, has the 3DGS attributes, finite and non-degenerate."""
    import numpy as np

    if not ply.exists() or ply.stat().st_size == 0:
        return report.check("splat_exists", False, f"{ply} missing or empty")
    try:
        count, props, offset = read_ply_header(ply)
    except ValueError as e:
        return report.check("splat_parses", False, str(e))
    missing = REQUIRED_PLY_PROPS - set(props)
    if not report.check("splat_attributes", not missing, f"missing 3DGS properties: {sorted(missing)}" if missing else "all 3DGS properties present"):
        return False
    ok = report.check("splat_count", count >= MIN_SPLATS, f"{count:,} splats; need >= {MIN_SPLATS:,}")
    # Rows are interleaved float32; the byte count must match the header exactly or the file is truncated.
    stride = len(props)
    expected = count * stride * 4
    actual = ply.stat().st_size - offset
    if not report.check("splat_size_matches_header", actual == expected,
                        f"{actual:,} bytes of data, header promises {expected:,}"):
        return False
    data = np.memmap(ply, dtype="<f4", mode="r", offset=offset, shape=(count, stride))
    xyz = np.asarray(data[:, [props.index("x"), props.index("y"), props.index("z")]])
    opacity = np.asarray(data[:, props.index("opacity")])
    finite = bool(np.isfinite(xyz).all() and np.isfinite(opacity).all())
    ok &= report.check("splat_finite", finite, "positions and opacity are finite" if finite else "NaN/inf values found")
    if finite:
        lo, hi = np.percentile(xyz, 1, axis=0), np.percentile(xyz, 99, axis=0)
        extent = hi - lo
        ok &= report.check("splat_extent", bool((extent > 1e-3).all()),
                           f"central 98% extent (model units) = {np.round(extent, 2).tolist()}")
        report.data["splat"] = {"file": str(ply), "count": count, "mb": round(ply.stat().st_size / 1e6, 1),
                                "extent_p1_p99": np.round(extent, 3).tolist(),
                                "centre": np.round((lo + hi) / 2, 3).tolist()}
    return ok
