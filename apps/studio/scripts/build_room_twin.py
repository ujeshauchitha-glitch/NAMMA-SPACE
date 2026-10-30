#!/usr/bin/env python3
"""Build a production-grade digital twin GLB from COLMAP sparse reconstruction.

Reads points3D.bin and images.bin from work/captures/room_run/sparse/0,
centers and aligns coordinates (Y-up, eye-level), generates 3D volumetric
colored points + camera frustum markers + room floor grid, and writes
a fully compliant glTF 2.0 Binary (GLB).
"""

from __future__ import annotations

import hashlib
import json
import math
import struct
import sys
from pathlib import Path

def qvec2rotmat(q):
    w, x, y, z = q
    return [
        [1 - 2*y*y - 2*z*z, 2*x*y - 2*w*z, 2*z*x + 2*w*y],
        [2*x*y + 2*w*z, 1 - 2*x*x - 2*z*z, 2*y*z - 2*w*x],
        [2*z*x - 2*w*y, 2*y*z + 2*w*x, 1 - 2*x*x - 2*y*y]
    ]

def mat_vec(M, v):
    return [sum(M[r][c] * v[c] for c in range(3)) for r in range(3)]

def transpose(M):
    return [[M[c][r] for c in range(3)] for r in range(3)]

def main():
    root = Path(__file__).resolve().parents[3]
    sparse_dir = root / "work" / "captures" / "room_run" / "sparse" / "0"
    out_glb = root / "apps" / "studio" / "public" / "scenes" / "real-room" / "visual" / "room_sparse.glb"
    manifest_path = root / "apps" / "studio" / "public" / "scenes" / "real-room" / "manifest.json"

    # 1. Read cameras / images
    images_bin = sparse_dir / "images.bin"
    camera_centers = []
    camera_rotations = []
    with open(images_bin, "rb") as f:
        num_reg_images = struct.unpack("<Q", f.read(8))[0]
        for _ in range(num_reg_images):
            image_id = struct.unpack("<I", f.read(4))[0]
            qw, qx, qy, qz = struct.unpack("<dddd", f.read(32))
            tx, ty, tz = struct.unpack("<ddd", f.read(24))
            cam_id = struct.unpack("<I", f.read(4))[0]
            name = b""
            while True:
                c = f.read(1)
                if c == b"\x00": break
                name += c
            num_points2d = struct.unpack("<Q", f.read(8))[0]
            f.seek(num_points2d * 24, 1)

            R = qvec2rotmat([qw, qx, qy, qz])
            RT = transpose(R)
            # C = -RT * t in COLMAP coords
            C = mat_vec(RT, [-tx, -ty, -tz])
            # Transform to glTF frame: X = X, Y = -Y, Z = -Z
            C_gltf = [C[0], -C[1], -C[2]]
            camera_centers.append(C_gltf)
            camera_rotations.append(RT)

    # 2. Read 3D points
    points_bin = sparse_dir / "points3D.bin"
    raw_points = []
    raw_colors = []
    with open(points_bin, "rb") as f:
        num_pts = struct.unpack("<Q", f.read(8))[0]
        for _ in range(num_pts):
            pid = struct.unpack("<Q", f.read(8))[0]
            x, y, z = struct.unpack("<ddd", f.read(24))
            r, g, b = struct.unpack("<BBB", f.read(3))
            err = struct.unpack("<d", f.read(8))[0]
            track_len = struct.unpack("<Q", f.read(8))[0]
            f.seek(track_len * 8, 1)
            raw_points.append([x, -y, -z])
            raw_colors.append([r / 255.0, g / 255.0, b / 255.0])

    # Filter extreme outliers
    all_xs = sorted(p[0] for p in raw_points)
    all_ys = sorted(p[1] for p in raw_points)
    all_zs = sorted(p[2] for p in raw_points)
    n = len(raw_points)
    x_min, x_max = all_xs[int(n * 0.02)], all_xs[int(n * 0.98)]
    y_min, y_max = all_ys[int(n * 0.02)], all_ys[int(n * 0.98)]
    z_min, z_max = all_zs[int(n * 0.02)], all_zs[int(n * 0.98)]

    # Compute center of camera trajectory to center the scene
    cx = sum(c[0] for c in camera_centers) / len(camera_centers)
    cy = sum(c[1] for c in camera_centers) / len(camera_centers)
    cz = sum(c[2] for c in camera_centers) / len(camera_centers)

    # We shift so cameras are at eye level (~1.5 m)
    shift_x = cx
    shift_y = cy - 1.5
    shift_z = cz

    positions: list[tuple[float, float, float]] = []
    colors: list[tuple[float, float, float]] = []
    normals: list[tuple[float, float, float]] = []
    triangles: list[tuple[int, int, int]] = []

    # 3. Build volumetric octahedra for each point
    # An octahedron has 6 vertices and 8 triangular faces
    oct_offsets = [
        (0.0, 0.06, 0.0),   # top
        (0.0, -0.06, 0.0),  # bottom
        (0.06, 0.0, 0.0),   # right
        (-0.06, 0.0, 0.0),  # left
        (0.0, 0.0, 0.06),   # front
        (0.0, 0.0, -0.06),  # back
    ]
    oct_faces = [
        (0, 2, 4), (0, 4, 3), (0, 3, 5), (0, 5, 2),
        (1, 4, 2), (1, 3, 4), (1, 5, 3), (1, 2, 5),
    ]

    for p, c in zip(raw_points, raw_colors):
        # Skip extreme outliers
        if not (x_min <= p[0] <= x_max and y_min <= p[1] <= y_max and z_min <= p[2] <= z_max):
            continue
        base_x = p[0] - shift_x
        base_y = p[1] - shift_y
        base_z = p[2] - shift_z
        base_idx = len(positions)

        for ox, oy, oz in oct_offsets:
            positions.append((base_x + ox, base_y + oy, base_z + oz))
            colors.append(tuple(c))
            normals.append((ox / 0.06, oy / 0.06, oz / 0.06))

        for v1, v2, v3 in oct_faces:
            triangles.append((base_idx + v1, base_idx + v2, base_idx + v3))

    # 4. Build camera markers (small camera frustums in distinct cyan)
    cam_color = (0.2, 0.85, 1.0)
    for c in camera_centers:
        bx = c[0] - shift_x
        by = c[1] - shift_y
        bz = c[2] - shift_z
        base_idx = len(positions)
        # Small pyramid pointing forward
        pyramid_pts = [
            (bx, by, bz),
            (bx - 0.08, by - 0.06, bz + 0.15),
            (bx + 0.08, by - 0.06, bz + 0.15),
            (bx + 0.08, by + 0.06, bz + 0.15),
            (bx - 0.08, by + 0.06, bz + 0.15),
        ]
        for pt in pyramid_pts:
            positions.append(pt)
            colors.append(cam_color)
            normals.append((0.0, 1.0, 0.0))
        # 4 sides + 1 base (2 triangles)
        pyramid_tris = [
            (0, 1, 2), (0, 2, 3), (0, 3, 4), (0, 4, 1),
            (1, 3, 2), (1, 4, 3)
        ]
        for v1, v2, v3 in pyramid_tris:
            triangles.append((base_idx + v1, base_idx + v2, base_idx + v3))

    # 5. Build subtle floor boundary / grid plate
    floor_y = 0.0
    floor_color = (0.15, 0.18, 0.22)
    fw, fd = 12.0, 10.0
    floor_base = len(positions)
    floor_pts = [
        (-fw / 2, floor_y - 0.02, -fd / 2),
        (fw / 2, floor_y - 0.02, -fd / 2),
        (fw / 2, floor_y - 0.02, fd / 2),
        (-fw / 2, floor_y - 0.02, fd / 2),
    ]
    for pt in floor_pts:
        positions.append(pt)
        colors.append(floor_color)
        normals.append((0.0, 1.0, 0.0))
    triangles.append((floor_base, floor_base + 1, floor_base + 2))
    triangles.append((floor_base, floor_base + 2, floor_base + 3))

    # 6. Write binary GLTF (GLB)
    import sys
    sys.path.insert(0, str(root / "apps" / "studio" / "scripts"))
    from ply_to_glb import write_glb
    write_glb(out_glb, positions, normals, colors, triangles)
    print(f"Generated {out_glb} ({len(positions)} vertices, {len(triangles)} triangles, {out_glb.stat().st_size} bytes)")

    # 7. Calculate SHA-256
    sha256 = hashlib.sha256(out_glb.read_bytes()).hexdigest()
    print(f"GLB SHA-256: {sha256}")

    # 8. Update manifest
    manifest = json.loads(manifest_path.read_text())
    manifest["visualAssets"][0]["sha256"] = sha256
    manifest["startPosition"] = [0.0, 1.6, 1.0]
    manifest["bounds"] = {
        "min": [-6.0, 0.0, -5.0],
        "max": [6.0, 3.5, 5.0]
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Updated {manifest_path}")

if __name__ == "__main__":
    main()
