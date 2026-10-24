#!/usr/bin/env python3
"""Process a dense point cloud into inspectable geometry when Open3D is available."""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def write_mesh_glb(output: Path, vertices: list[list[float]], normals: list[list[float]], triangles: list[list[int]]) -> None:
    blob = bytearray()

    def align4() -> None:
        while len(blob) % 4:
            blob.append(0)

    buffer_views: list[dict[str, Any]] = []
    accessors: list[dict[str, Any]] = []

    def append(values: bytes, component_type: int, count: int, accessor_type: str, minimum: list[float] | None = None, maximum: list[float] | None = None) -> int:
        align4()
        offset = len(blob)
        blob.extend(values)
        view = len(buffer_views)
        buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(values)})
        accessor: dict[str, Any] = {"bufferView": view, "componentType": component_type, "count": count, "type": accessor_type}
        if minimum is not None:
            accessor["min"] = minimum
        if maximum is not None:
            accessor["max"] = maximum
        accessors.append(accessor)
        return len(accessors) - 1

    flat_vertices = [value for vertex in vertices for value in vertex]
    flat_normals = [value for normal in normals for value in normal]
    flat_indices = [value for triangle in triangles for value in triangle]
    position = append(struct.pack(f"<{len(flat_vertices)}f", *flat_vertices), 5126, len(vertices), "VEC3", [min(v[i] for v in vertices) for i in range(3)], [max(v[i] for v in vertices) for i in range(3)])
    normal = append(struct.pack(f"<{len(flat_normals)}f", *flat_normals), 5126, len(normals), "VEC3")
    index = append(struct.pack(f"<{len(flat_indices)}I", *flat_indices), 5125, len(flat_indices), "SCALAR")
    align4()
    document = {
        "asset": {"version": "2.0", "generator": "Namma Space process_geometry.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "reconstructed-mesh"}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": position, "NORMAL": normal}, "indices": index}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [0.72, 0.68, 0.58, 1], "roughnessFactor": 0.85}}],
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
    }
    json_chunk = json.dumps(document, separators=(",", ":")).encode()
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
    output.write_bytes(glb)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-ply", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--depth", type=int, default=8)
    args = parser.parse_args()
    report: dict[str, Any] = {"schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "input": str(args.input_ply), "status": "queued", "stages": []}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.output_dir / "geometry-report.json"
    if not args.input_ply.is_file():
        report.update({"status": "blocked", "blocker": f"Input point cloud does not exist: {args.input_ply}"})
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        print(report["blocker"], file=sys.stderr)
        return 2
    try:
        import open3d as o3d
    except ImportError:
        report.update({"status": "blocked", "blocker": "Open3D is not installed. Install it in the isolated reconstruction environment before mesh processing."})
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        print(report["blocker"], file=sys.stderr)
        return 3

    started = time.monotonic()
    cloud = o3d.io.read_point_cloud(str(args.input_ply))
    if cloud.is_empty():
        report.update({"status": "failed", "blocker": "Point cloud loaded but contains no points."})
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        return 1
    clean, _ = cloud.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
    if clean.is_empty():
        report.update({"status": "failed", "blocker": "Outlier filtering removed every point from the dense cloud."})
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        return 1
    clean.estimate_normals()
    mesh, _ = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(clean, depth=args.depth)
    mesh = mesh.crop(clean.get_axis_aligned_bounding_box())
    if mesh.is_empty() or len(mesh.vertices) < 3 or len(mesh.triangles) < 1:
        report.update({"status": "failed", "blocker": "Surface reconstruction produced an empty or non-triangulated mesh."})
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        return 1
    mesh.compute_vertex_normals()
    mesh_path = args.output_dir / "reconstructed-mesh.ply"
    glb_path = args.output_dir / "reconstructed-mesh.glb"
    o3d.io.write_triangle_mesh(str(mesh_path), mesh)
    vertices = [[float(value) for value in vertex] for vertex in mesh.vertices]
    normals = [[float(value) for value in normal] for normal in mesh.vertex_normals]
    triangles = [[int(value) for value in triangle] for triangle in mesh.triangles]
    write_mesh_glb(glb_path, vertices, normals, triangles)
    bounds = mesh.get_axis_aligned_bounding_box()
    minimum = [float(value) for value in bounds.min_bound]
    maximum = [float(value) for value in bounds.max_bound]
    if any(not math.isfinite(value) for value in minimum + maximum) or any(a >= b for a, b in zip(minimum, maximum)):
        report.update({"status": "failed", "blocker": "Generated mesh bounds are non-finite or degenerate."})
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        return 1
    report.update({
        "status": "visual_ready",
        "durationSeconds": round(time.monotonic() - started, 3),
        "inputPointCount": len(cloud.points),
        "filteredPointCount": len(clean.points),
        "meshVertexCount": len(mesh.vertices),
        "meshTriangleCount": len(mesh.triangles),
        "bounds": {"min": minimum, "max": maximum},
        "outputs": {"ply": str(mesh_path), "glb": str(glb_path)},
        "warnings": ["Poisson surface reconstruction is an inferred surface; validate floors and obstacles before navigation publication."],
    })
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Generated {glb_path} from {len(clean.points)} filtered points")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
