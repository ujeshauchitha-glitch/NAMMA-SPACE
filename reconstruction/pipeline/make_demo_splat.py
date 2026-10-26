"""Generate a synthetic Gaussian-splat .ply (a small furnished room) to smoke-test the viewer.

Not a reconstruction: it only exists so the web viewer can be verified without a real capture.
Output uses the standard 3DGS PLY layout and the COLMAP convention (Y down), matching the
real pipeline's output, so the viewer's default rotation applies unchanged.

    python reconstruction/pipeline/make_demo_splat.py spark-viewer/public/fixtures/SYNTHETIC/synthetic_room.ply
"""
import struct
import sys
from pathlib import Path

import numpy as np

SH_C0 = 0.28209479177387814
rng = np.random.default_rng(7)


def plane(origin, u, v, n, rgb, jitter=0.01):
    """n splats on a rectangle spanned by u and v from origin."""
    a = rng.random((n, 1))
    b = rng.random((n, 1))
    pts = np.asarray(origin) + a * np.asarray(u) + b * np.asarray(v)
    pts += rng.normal(0, jitter, pts.shape)
    col = np.clip(np.asarray(rgb) + rng.normal(0, 0.04, (n, 3)), 0, 1)
    return pts, col


def box(cx, cz, w, d, h, rgb, n=4000):
    """Axis-aligned box standing on the floor (y = 0, up is -y in COLMAP space)."""
    x0, x1, z0, z1 = cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2
    parts = [
        plane((x0, -h, z0), (w, 0, 0), (0, 0, d), n // 3, rgb),
        plane((x0, 0, z0), (w, 0, 0), (0, -h, 0), n // 6, rgb),
        plane((x0, 0, z1), (w, 0, 0), (0, -h, 0), n // 6, rgb),
        plane((x0, 0, z0), (0, 0, d), (0, -h, 0), n // 6, rgb),
        plane((x1, 0, z0), (0, 0, d), (0, -h, 0), n // 6, rgb),
    ]
    return parts


W, D, H = 6.0, 5.0, 2.7
parts = [
    plane((0, 0, 0), (W, 0, 0), (0, 0, D), 30000, (0.55, 0.42, 0.30)),  # floor
    plane((0, -H, 0), (W, 0, 0), (0, 0, D), 12000, (0.92, 0.92, 0.90)),  # ceiling
    plane((0, 0, 0), (W, 0, 0), (0, -H, 0), 14000, (0.85, 0.80, 0.72)),  # back wall
    plane((0, 0, D), (W, 0, 0), (0, -H, 0), 14000, (0.80, 0.84, 0.88)),
    plane((0, 0, 0), (0, 0, D), (0, -H, 0), 12000, (0.88, 0.78, 0.78)),
    plane((W, 0, 0), (0, 0, D), (0, -H, 0), 12000, (0.78, 0.88, 0.80)),
]
parts += box(1.2, 1.2, 1.8, 0.9, 0.8, (0.25, 0.35, 0.65))  # sofa
parts += box(4.3, 3.6, 1.4, 0.8, 0.75, (0.70, 0.50, 0.25))  # table
parts += box(5.4, 1.0, 0.6, 0.6, 1.9, (0.30, 0.30, 0.32))  # cabinet

pos = np.concatenate([p for p, _ in parts]).astype("<f4")
rgb = np.concatenate([c for _, c in parts]).astype("<f4")
n = len(pos)

f_dc = ((rgb - 0.5) / SH_C0).astype("<f4")
opacity = np.full((n, 1), 4.0, "<f4")  # logit; sigmoid(4) ~ 0.98
scale = np.full((n, 3), np.log(0.025), "<f4")
rot = np.tile(np.array([1, 0, 0, 0], "<f4"), (n, 1))
normals = np.zeros((n, 3), "<f4")

out = Path(sys.argv[1] if len(sys.argv) > 1 else "demo.ply")
out.parent.mkdir(parents=True, exist_ok=True)
header = (
    "ply\nformat binary_little_endian 1.0\n"
    f"element vertex {n}\n"
    + "".join(f"property float {p}\n" for p in ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"])
    + "end_header\n"
)
data = np.concatenate([pos, normals, f_dc, opacity, scale, rot], axis=1).astype("<f4")
with open(out, "wb") as f:
    f.write(header.encode("ascii"))
    f.write(data.tobytes())
print(f"wrote {n} splats -> {out}")
