"""High-fidelity GLB builder supporting multiple PBR meshes and vertex-colored point clouds."""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path
from typing import Any

def align4(data: bytearray) -> None:
    while len(data) % 4:
        data.append(0)

def append_accessor(
    blob: bytearray,
    buffer_views: list[dict[str, Any]],
    accessors: list[dict[str, Any]],
    values: bytes,
    *,
    component_type: int,
    count: int,
    accessor_type: str,
    minimum: list[float] | None = None,
    maximum: list[float] | None = None,
) -> int:
    align4(blob)
    offset = len(blob)
    blob.extend(values)
    view_index = len(buffer_views)
    buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(values)})
    accessor: dict[str, Any] = {
        "bufferView": view_index,
        "componentType": component_type,
        "count": count,
        "type": accessor_type,
    }
    if minimum is not None:
        accessor["min"] = minimum
    if maximum is not None:
        accessor["max"] = maximum
    accessors.append(accessor)
    return len(accessors) - 1

def box_geometry(
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    pitch_deg: float = 0.0,
    yaw_deg: float = 0.0,
    roll_deg: float = 0.0,
) -> tuple[list[float], list[float], list[int]]:
    """Generate positions, normals, and triangle indices for an oriented box."""
    cx, cy, cz = center
    sx, sy, sz = (v / 2.0 for v in size)
    raw_corners = [
        (-sx, -sy, -sz), (sx, -sy, -sz),
        (sx, sy, -sz), (-sx, sy, -sz),
        (-sx, -sy, sz), (sx, -sy, sz),
        (sx, sy, sz), (-sx, sy, sz),
    ]

    rx, ry, rz = math.radians(pitch_deg), math.radians(yaw_deg), math.radians(roll_deg)
    cx_r, sx_r = math.cos(rx), math.sin(rx)
    cy_r, sy_r = math.cos(ry), math.sin(ry)
    cz_r, sz_r = math.cos(rz), math.sin(rz)

    def rot(p: tuple[float, float, float]) -> tuple[float, float, float]:
        x, y, z = p
        # Roll (Z)
        x1 = x * cz_r - y * sz_r
        y1 = x * sz_r + y * cz_r
        z1 = z
        # Pitch (X)
        x2 = x1
        y2 = y1 * cx_r - z1 * sx_r
        z2 = y1 * sx_r + z1 * cx_r
        # Yaw (Y)
        x3 = x2 * cy_r + z2 * sy_r
        y3 = y2
        z3 = -x2 * sy_r + z2 * cy_r
        return (x3 + cx, y3 + cy, z3 + cz)

    corners = [rot(c) for c in raw_corners]

    raw_faces = [
        ((0, 1, 2, 3), (0.0, 0.0, -1.0)),
        ((5, 4, 7, 6), (0.0, 0.0, 1.0)),
        ((4, 0, 3, 7), (-1.0, 0.0, 0.0)),
        ((1, 5, 6, 2), (1.0, 0.0, 0.0)),
        ((3, 2, 6, 7), (0.0, 1.0, 0.0)),
        ((4, 5, 1, 0), (0.0, -1.0, 0.0)),
    ]

    positions: list[float] = []
    normals: list[float] = []
    indices: list[int] = []

    for face_index, (face, n) in enumerate(raw_faces):
        nx, ny, nz = n
        nx1 = nx * cz_r - ny * sz_r
        ny1 = nx * sz_r + ny * cz_r
        nz1 = nz
        nx2 = nx1
        ny2 = ny1 * cx_r - nz1 * sx_r
        nz2 = ny1 * sx_r + nz1 * cx_r
        rn = (nx2 * cy_r + nz2 * sy_r, ny2, -nx2 * sy_r + nz2 * cy_r)

        offset = face_index * 4
        for corner_index in face:
            positions.extend(corners[corner_index])
            normals.extend(rn)
        indices.extend([offset, offset + 1, offset + 2, offset, offset + 2, offset + 3])

    return positions, normals, indices

def build_scene_glb(
    output_path: Path,
    scene_name: str,
    objects: list[dict[str, Any]],
    points: list[tuple[float, float, float]] | None = None,
    point_colors: list[tuple[float, float, float]] | None = None,
    point_radius: float = 0.0035,
    camera_frustums: list[dict[str, Any]] | None = None,
) -> None:
    """Build a complete glTF 2.0 Binary (GLB) file containing architectural objects,

    point cloud micro-facets, and subtle camera frustums.
    """
    blob = bytearray()
    buffer_views: list[dict[str, Any]] = []
    accessors: list[dict[str, Any]] = []
    materials: list[dict[str, Any]] = []
    meshes: list[dict[str, Any]] = []
    nodes: list[dict[str, Any]] = []

    # 1. Add architectural objects
    for obj in objects:
        name = obj["name"]
        center = obj["center"]
        size = obj["size"]
        color = obj["color"]  # [r, g, b, a]
        metallic = obj.get("metallic", 0.08)
        roughness = obj.get("roughness", 0.65)
        pitch = obj.get("pitch", 0.0)
        yaw = obj.get("yaw", 0.0)
        roll = obj.get("roll", 0.0)

        pos, norm, idx = box_geometry(center, size, pitch, yaw, roll)
        if not pos:
            continue

        pos_acc = append_accessor(
            blob, buffer_views, accessors, struct.pack(f"<{len(pos)}f", *pos),
            component_type=5126, count=len(pos) // 3, accessor_type="VEC3",
            minimum=[min(pos[i::3]) for i in range(3)], maximum=[max(pos[i::3]) for i in range(3)],
        )
        norm_acc = append_accessor(
            blob, buffer_views, accessors, struct.pack(f"<{len(norm)}f", *norm),
            component_type=5126, count=len(norm) // 3, accessor_type="VEC3",
        )
        idx_acc = append_accessor(
            blob, buffer_views, accessors, struct.pack(f"<{len(idx)}H", *idx),
            component_type=5123, count=len(idx), accessor_type="SCALAR",
        )

        mat_idx = len(materials)
        materials.append({
            "name": f"{name}_material",
            "pbrMetallicRoughness": {
                "baseColorFactor": list(color),
                "metallicFactor": metallic,
                "roughnessFactor": roughness,
            },
            "doubleSided": True,
        })
        mesh_idx = len(meshes)
        meshes.append({
            "name": name,
            "primitives": [{
                "attributes": {"POSITION": pos_acc, "NORMAL": norm_acc},
                "indices": idx_acc,
                "material": mat_idx,
            }],
        })
        nodes.append({"name": name, "mesh": mesh_idx})

    # 2. Add calibrated points as micro-facets (4 vertices per point)
    if points and point_colors and len(points) == len(point_colors) and len(points) > 0:
        r = point_radius
        # Horizontal cross-facets facing up/outwards
        pt_positions: list[float] = []
        pt_normals: list[float] = []
        pt_colors: list[float] = []
        pt_indices: list[int] = []

        for p_idx, (p, c) in enumerate(zip(points, point_colors)):
            px, py, pz = p
            base_idx = p_idx * 4
            # 4 vertices forming a small quad
            v0 = (px - r, py, pz - r)
            v1 = (px + r, py, pz - r)
            v2 = (px + r, py, pz + r)
            v3 = (px - r, py, pz + r)

            for vx, vy, vz in (v0, v1, v2, v3):
                pt_positions.extend([vx, vy, vz])
                pt_normals.extend([0.0, 1.0, 0.0])
                pt_colors.extend([c[0], c[1], c[2]])

            pt_indices.extend([base_idx, base_idx + 1, base_idx + 2, base_idx, base_idx + 2, base_idx + 3])

        # Accessors for points
        pos_acc = append_accessor(
            blob, buffer_views, accessors, struct.pack(f"<{len(pt_positions)}f", *pt_positions),
            component_type=5126, count=len(pt_positions) // 3, accessor_type="VEC3",
            minimum=[min(pt_positions[i::3]) for i in range(3)], maximum=[max(pt_positions[i::3]) for i in range(3)],
        )
        norm_acc = append_accessor(
            blob, buffer_views, accessors, struct.pack(f"<{len(pt_normals)}f", *pt_normals),
            component_type=5126, count=len(pt_normals) // 3, accessor_type="VEC3",
        )
        col_acc = append_accessor(
            blob, buffer_views, accessors, struct.pack(f"<{len(pt_colors)}f", *pt_colors),
            component_type=5126, count=len(pt_colors) // 3, accessor_type="VEC3",
        )

        idx_comp = 5123 if len(pt_positions) // 3 <= 65535 else 5125
        fmt = f"<{len(pt_indices)}H" if idx_comp == 5123 else f"<{len(pt_indices)}I"
        idx_acc = append_accessor(
            blob, buffer_views, accessors, struct.pack(fmt, *pt_indices),
            component_type=idx_comp, count=len(pt_indices), accessor_type="SCALAR",
        )

        mat_idx = len(materials)
        materials.append({
            "name": "point_cloud_material",
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.85,
            },
            "doubleSided": True,
        })
        mesh_idx = len(meshes)
        meshes.append({
            "name": "Calibrated_Point_Cloud",
            "primitives": [{
                "attributes": {"POSITION": pos_acc, "NORMAL": norm_acc, "COLOR_0": col_acc},
                "indices": idx_acc,
                "material": mat_idx,
            }],
        })
        nodes.append({"name": "Calibrated_Point_Cloud", "mesh": mesh_idx})

    # 3. Add subtle camera frustums
    if camera_frustums and len(camera_frustums) > 0:
        cam_positions: list[float] = []
        cam_normals: list[float] = []
        cam_indices: list[int] = []
        cam_color = camera_frustums[0].get("color", [0.95, 0.75, 0.25, 0.9])

        for c_idx, cam in enumerate(camera_frustums):
            pos = cam["pos"]
            target = cam.get("target", (0.0, 1.0, 0.0))
            scale = cam.get("scale", 0.018)  # 1.8cm scale

            # Direction vector
            dx, dy, dz = target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]
            d_len = math.hypot(dx, dy, dz) or 1.0
            fx, fy, fz = dx / d_len, dy / d_len, dz / d_len

            # Right and up vectors
            rx, ry, rz = -fz, 0.0, fx
            r_len = math.hypot(rx, rz) or 1.0
            rx, rz = rx / r_len, rz / r_len
            ux, uy, uz = fy * rz - fz * ry, fz * rx - fx * rz, fx * ry - fy * rx

            base_idx = c_idx * 5
            # Apex
            ap = pos
            # 4 base corners
            d_fwd = scale * 1.6
            d_side = scale * 0.8
            d_up = scale * 0.6
            b0 = (pos[0] + fx * d_fwd - rx * d_side - ux * d_up,
                  pos[1] + fy * d_fwd - ry * d_side - uy * d_up,
                  pos[2] + fz * d_fwd - rz * d_side - uz * d_up)
            b1 = (pos[0] + fx * d_fwd + rx * d_side - ux * d_up,
                  pos[1] + fy * d_fwd + ry * d_side - uy * d_up,
                  pos[2] + fz * d_fwd + rz * d_side - uz * d_up)
            b2 = (pos[0] + fx * d_fwd + rx * d_side + ux * d_up,
                  pos[1] + fy * d_fwd + ry * d_side + uy * d_up,
                  pos[2] + fz * d_fwd + rz * d_side + uz * d_up)
            b3 = (pos[0] + fx * d_fwd - rx * d_side + ux * d_up,
                  pos[1] + fy * d_fwd - ry * d_side + uy * d_up,
                  pos[2] + fz * d_fwd - rz * d_side + uz * d_up)

            for pt in (ap, b0, b1, b2, b3):
                cam_positions.extend(pt)
                cam_normals.extend([fx, fy, fz])

            # 4 side triangles + 2 base triangles
            cam_indices.extend([
                base_idx, base_idx + 1, base_idx + 2,
                base_idx, base_idx + 2, base_idx + 3,
                base_idx, base_idx + 3, base_idx + 4,
                base_idx, base_idx + 4, base_idx + 1,
                base_idx + 1, base_idx + 3, base_idx + 2,
                base_idx + 1, base_idx + 4, base_idx + 3,
            ])

        pos_acc = append_accessor(
            blob, buffer_views, accessors, struct.pack(f"<{len(cam_positions)}f", *cam_positions),
            component_type=5126, count=len(cam_positions) // 3, accessor_type="VEC3",
            minimum=[min(cam_positions[i::3]) for i in range(3)], maximum=[max(cam_positions[i::3]) for i in range(3)],
        )
        norm_acc = append_accessor(
            blob, buffer_views, accessors, struct.pack(f"<{len(cam_normals)}f", *cam_normals),
            component_type=5126, count=len(cam_normals) // 3, accessor_type="VEC3",
        )
        idx_comp = 5123 if len(cam_positions) // 3 <= 65535 else 5125
        fmt = f"<{len(cam_indices)}H" if idx_comp == 5123 else f"<{len(cam_indices)}I"
        idx_acc = append_accessor(
            blob, buffer_views, accessors, struct.pack(fmt, *cam_indices),
            component_type=idx_comp, count=len(cam_indices), accessor_type="SCALAR",
        )

        mat_idx = len(materials)
        materials.append({
            "name": "camera_constellation_material",
            "pbrMetallicRoughness": {
                "baseColorFactor": list(cam_color),
                "metallicFactor": 0.4,
                "roughnessFactor": 0.35,
            },
        })
        mesh_idx = len(meshes)
        meshes.append({
            "name": "Camera_Constellation",
            "primitives": [{
                "attributes": {"POSITION": pos_acc, "NORMAL": norm_acc},
                "indices": idx_acc,
                "material": mat_idx,
            }],
        })
        nodes.append({"name": "Camera_Constellation", "mesh": mesh_idx})

    # Assemble glTF JSON Chunk
    align4(blob)
    document = {
        "asset": {"version": "2.0", "generator": "Namma Space High-Fidelity GLB Builder"},
        "scene": 0,
        "scenes": [{"name": scene_name, "nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
    }

    json_chunk = json.dumps(document, separators=(",", ":")).encode("utf-8")
    while len(json_chunk) % 4:
        json_chunk += b" "
    while len(blob) % 4:
        blob.append(0)

    total_length = 12 + 8 + len(json_chunk) + 8 + len(blob)
    glb = bytearray(struct.pack("<4sII", b"glTF", 2, total_length))
    glb.extend(struct.pack("<I4s", len(json_chunk), b"JSON"))
    glb.extend(json_chunk)
    glb.extend(struct.pack("<I4s", len(blob), b"BIN\x00"))
    glb.extend(blob)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(glb)
    print(f"Successfully generated GLB: {output_path} ({len(glb)} bytes, {len(nodes)} nodes, {len(materials)} materials)")

