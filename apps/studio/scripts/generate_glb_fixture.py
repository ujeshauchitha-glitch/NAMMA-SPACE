#!/usr/bin/env python3
"""Generate a small, self-contained architectural GLB fixture.

The output is a genuine glTF 2.0 binary file made only from generated box
geometry and local material colours. It is a visual asset fixture, not a
smartphone reconstruction.
"""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path
from typing import Any


def align4(data: bytearray) -> None:
    while len(data) % 4:
        data.append(0)


def box_geometry(center: tuple[float, float, float], size: tuple[float, float, float]) -> tuple[list[float], list[float], list[int]]:
    cx, cy, cz = center
    sx, sy, sz = (value / 2 for value in size)
    corners = [
        (cx - sx, cy - sy, cz - sz), (cx + sx, cy - sy, cz - sz),
        (cx + sx, cy + sy, cz - sz), (cx - sx, cy + sy, cz - sz),
        (cx - sx, cy - sy, cz + sz), (cx + sx, cy - sy, cz + sz),
        (cx + sx, cy + sy, cz + sz), (cx - sx, cy + sy, cz + sz),
    ]
    faces = [
        ((0, 1, 2, 3), (0, 0, -1)), ((5, 4, 7, 6), (0, 0, 1)),
        ((4, 0, 3, 7), (-1, 0, 0)), ((1, 5, 6, 2), (1, 0, 0)),
        ((3, 2, 6, 7), (0, 1, 0)), ((4, 5, 1, 0), (0, -1, 0)),
    ]
    positions: list[float] = []
    normals: list[float] = []
    indices: list[int] = []
    for face_index, (face, normal) in enumerate(faces):
        offset = face_index * 4
        for corner_index in face:
            positions.extend(corners[corner_index])
            normals.extend(normal)
        indices.extend([offset, offset + 1, offset + 2, offset, offset + 2, offset + 3])
    return positions, normals, indices


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


def generate(output: Path) -> None:
    objects = [
        ("Floor", (0, -0.08, 0), (12, 0.16, 9), (0.19, 0.20, 0.18, 1)),
        ("Back wall", (0, 1.5, -4.35), (12, 3, 0.22), (0.33, 0.30, 0.25, 1)),
        ("Left wall", (-5.9, 1.5, 0), (0.22, 3, 8.7), (0.33, 0.30, 0.25, 1)),
        ("Right wall", (5.9, 1.5, 0), (0.22, 3, 8.7), (0.33, 0.30, 0.25, 1)),
        ("Front wall left", (-4.6, 1.5, 4.35), (2.6, 3, 0.22), (0.33, 0.30, 0.25, 1)),
        ("Front wall right", (4.6, 1.5, 4.35), (2.6, 3, 0.22), (0.33, 0.30, 0.25, 1)),
        ("Registration desk", (-1.8, 0.55, -1.1), (2.2, 1.1, 0.8), (0.48, 0.24, 0.11, 1)),
        ("Materials display", (2.4, 0.45, 1.4), (1.8, 0.9, 1.2), (0.24, 0.34, 0.36, 1)),
        ("Information kiosk", (0, 0.75, 2.65), (0.8, 1.5, 0.8), (0.64, 0.43, 0.16, 1)),
        ("Central obstacle", (0.6, 0.6, -0.4), (1.5, 1.2, 1.2), (0.26, 0.28, 0.26, 1)),
    ]
    blob = bytearray()
    buffer_views: list[dict[str, Any]] = []
    accessors: list[dict[str, Any]] = []
    materials: list[dict[str, Any]] = []
    meshes: list[dict[str, Any]] = []
    nodes: list[dict[str, Any]] = []
    for name, center, size, colour in objects:
        positions, normals, indices = box_geometry(center, size)
        pos_accessor = append_accessor(
            blob, buffer_views, accessors, struct.pack(f"<{len(positions)}f", *positions),
            component_type=5126, count=len(positions) // 3, accessor_type="VEC3",
            minimum=[min(positions[i::3]) for i in range(3)], maximum=[max(positions[i::3]) for i in range(3)],
        )
        normal_accessor = append_accessor(
            blob, buffer_views, accessors, struct.pack(f"<{len(normals)}f", *normals),
            component_type=5126, count=len(normals) // 3, accessor_type="VEC3",
        )
        index_accessor = append_accessor(
            blob, buffer_views, accessors, struct.pack(f"<{len(indices)}H", *indices),
            component_type=5123, count=len(indices), accessor_type="SCALAR",
        )
        material_index = len(materials)
        materials.append({
            "name": f"{name} material",
            "pbrMetallicRoughness": {"baseColorFactor": list(colour), "metallicFactor": 0.08, "roughnessFactor": 0.65},
        })
        meshes.append({"name": name, "primitives": [{"attributes": {"POSITION": pos_accessor, "NORMAL": normal_accessor}, "indices": index_accessor, "material": material_index}]})
        nodes.append({"name": name, "mesh": len(meshes) - 1})

    align4(blob)
    document = {
        "asset": {"version": "2.0", "generator": "Namma Space generate_glb_fixture.py"},
        "scene": 0,
        "scenes": [{"name": "Amber Hall GLB fixture", "nodes": list(range(len(nodes)))}],
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
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(glb)
    print(f"Generated {output} ({len(glb)} bytes, {len(objects)} meshes)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    generate(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
