#!/usr/bin/env python3
"""Pure-Python PLY to GLB converter.

Converts a binary or ASCII PLY point cloud or triangle mesh to a valid
glTF 2.0 Binary (GLB) file. Works with any Python 3.8+ installation;
does not require Open3D, numpy, or any native extension.

Supports:
  - ASCII and binary_little_endian PLY files.
  - float32 x/y/z vertex positions.
  - Optional float32 nx/ny/nz vertex normals.
  - Optional uchar r/g/b or uchar red/green/blue vertex colors.
  - Triangle and quad faces (quads are triangulated).
  - Ignores unrecognized properties gracefully.

Usage:
    python scripts/ply_to_glb.py input.ply output.glb

Exit codes:
  0  success
  1  conversion error (bad PLY data)
  2  usage / file-not-found error
"""

from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# GLB writer helpers
# ---------------------------------------------------------------------------


def _align4(data: bytearray) -> None:
    while len(data) % 4:
        data.append(0)


def _append_accessor(
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
    _align4(blob)
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


def write_glb(
    output: Path,
    positions: list[tuple[float, float, float]],
    normals: list[tuple[float, float, float]] | None,
    colors: list[tuple[float, float, float]] | None,
    triangles: list[tuple[int, int, int]] | None,
) -> None:
    """Write a GLB from in-memory geometry arrays."""
    if not positions:
        raise ValueError("GLB requires at least one vertex position.")

    blob: bytearray = bytearray()
    buffer_views: list[dict[str, Any]] = []
    accessors: list[dict[str, Any]] = []
    attributes: dict[str, int] = {}
    primitives: dict[str, Any] = {"attributes": attributes}

    # Positions
    flat_pos = [c for v in positions for c in v]
    mins_pos = [min(v[i] for v in positions) for i in range(3)]
    maxs_pos = [max(v[i] for v in positions) for i in range(3)]
    pos_idx = _append_accessor(
        blob, buffer_views, accessors,
        struct.pack(f"<{len(flat_pos)}f", *flat_pos),
        component_type=5126, count=len(positions), accessor_type="VEC3",
        minimum=mins_pos, maximum=maxs_pos,
    )
    attributes["POSITION"] = pos_idx

    # Normals
    if normals:
        flat_norm = [c for v in normals for c in v]
        norm_idx = _append_accessor(
            blob, buffer_views, accessors,
            struct.pack(f"<{len(flat_norm)}f", *flat_norm),
            component_type=5126, count=len(normals), accessor_type="VEC3",
        )
        attributes["NORMAL"] = norm_idx

    # Colors (as VEC3 FLOAT normalized 0-1)
    if colors:
        flat_col = [c for v in colors for c in v]
        col_idx = _append_accessor(
            blob, buffer_views, accessors,
            struct.pack(f"<{len(flat_col)}f", *flat_col),
            component_type=5126, count=len(colors), accessor_type="VEC3",
        )
        attributes["COLOR_0"] = col_idx

    # Indices (triangles)
    material_index = 0
    if triangles:
        flat_idx = [i for tri in triangles for i in tri]
        # Choose UINT16 or UINT32
        if len(positions) <= 65535:
            idx_bytes = struct.pack(f"<{len(flat_idx)}H", *flat_idx)
            idx_comp = 5123  # UNSIGNED_SHORT
        else:
            idx_bytes = struct.pack(f"<{len(flat_idx)}I", *flat_idx)
            idx_comp = 5125  # UNSIGNED_INT
        idx_accessor = _append_accessor(
            blob, buffer_views, accessors,
            idx_bytes,
            component_type=idx_comp, count=len(flat_idx), accessor_type="SCALAR",
        )
        primitives["indices"] = idx_accessor
        primitives["material"] = material_index
        primitives["mode"] = 4  # TRIANGLES
    else:
        primitives["mode"] = 0  # POINTS

    _align4(blob)

    # Material: use vertex color if available, else plain grey
    material: dict[str, Any]
    if colors:
        material = {
            "pbrMetallicRoughness": {
                "baseColorFactor": [1, 1, 1, 1],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.85,
            }
        }
    else:
        material = {
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.72, 0.68, 0.58, 1.0],
                "metallicFactor": 0.05,
                "roughnessFactor": 0.85,
            }
        }

    document: dict[str, Any] = {
        "asset": {"version": "2.0", "generator": "Namma Space ply_to_glb.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "reconstructed-mesh"}],
        "meshes": [{"primitives": [primitives]}],
        "materials": [material],
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


# ---------------------------------------------------------------------------
# PLY parser
# ---------------------------------------------------------------------------

class PlyParseError(Exception):
    pass


def _parse_ply_header(lines: list[bytes]) -> dict[str, Any]:
    """Parse a PLY header and return metadata dict."""
    if not lines or lines[0].strip() != b"ply":
        raise PlyParseError("Not a valid PLY file (missing 'ply' magic).")

    format_line = next((ln.decode().strip() for ln in lines if ln.startswith(b"format ")), None)
    if format_line is None:
        raise PlyParseError("PLY header missing 'format' line.")
    if "ascii" in format_line:
        ply_format = "ascii"
    elif "binary_little_endian" in format_line:
        ply_format = "binary_little_endian"
    elif "binary_big_endian" in format_line:
        ply_format = "binary_big_endian"
    else:
        raise PlyParseError(f"Unsupported PLY format: {format_line!r}")

    elements: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for raw_line in lines:
        line = raw_line.decode(errors="replace").strip()
        if line.startswith("element "):
            parts = line.split()
            current = {"name": parts[1], "count": int(parts[2]), "properties": []}
            elements.append(current)
        elif line.startswith("property ") and current is not None:
            parts = line.split()
            if parts[1] == "list":
                current["properties"].append({"name": parts[4], "type": "list",
                                               "count_type": parts[2], "item_type": parts[3]})
            else:
                current["properties"].append({"name": parts[2], "type": parts[1]})

    return {"format": ply_format, "elements": elements}


_PLY_TYPE_SIZES = {
    "char": 1, "uchar": 1, "short": 2, "ushort": 2,
    "int": 4, "uint": 4, "float": 4, "double": 8,
    "int8": 1, "uint8": 1, "int16": 2, "uint16": 2,
    "int32": 4, "uint32": 4, "float32": 4, "float64": 8,
}
_PLY_STRUCT_FMT = {
    "char": "b", "uchar": "B", "short": "h", "ushort": "H",
    "int": "i", "uint": "I", "float": "f", "double": "d",
    "int8": "b", "uint8": "B", "int16": "h", "uint16": "H",
    "int32": "i", "uint32": "I", "float32": "f", "float64": "d",
}


def _read_binary_element(
    data: bytes, offset: int, props: list[dict[str, Any]], count: int, endian: str
) -> tuple[list[dict[str, Any]], int]:
    prefix = "<" if endian == "little" else ">"
    rows = []
    for _ in range(count):
        row: dict[str, Any] = {}
        for prop in props:
            if prop["type"] == "list":
                count_fmt = prefix + _PLY_STRUCT_FMT[prop["count_type"]]
                count_size = _PLY_TYPE_SIZES[prop["count_type"]]
                (n,) = struct.unpack_from(count_fmt, data, offset)
                offset += count_size
                item_fmt = _PLY_STRUCT_FMT[prop["item_type"]]
                item_size = _PLY_TYPE_SIZES[prop["item_type"]]
                values = list(struct.unpack_from(f"{prefix}{n}{item_fmt}", data, offset))
                offset += n * item_size
                row[prop["name"]] = values
            else:
                fmt = prefix + _PLY_STRUCT_FMT[prop["type"]]
                size = _PLY_TYPE_SIZES[prop["type"]]
                (val,) = struct.unpack_from(fmt, data, offset)
                offset += size
                row[prop["name"]] = val
        rows.append(row)
    return rows, offset


def _read_ascii_element(lines_iter: Any, props: list[dict[str, Any]], count: int) -> list[dict[str, Any]]:
    rows = []
    for _ in range(count):
        line = next(lines_iter).decode(errors="replace").strip()
        tokens = line.split()
        row: dict[str, Any] = {}
        token_idx = 0
        for prop in props:
            if prop["type"] == "list":
                n = int(tokens[token_idx])
                token_idx += 1
                row[prop["name"]] = [float(tokens[token_idx + i]) for i in range(n)]
                token_idx += n
            else:
                val_str = tokens[token_idx]
                token_idx += 1
                try:
                    row[prop["name"]] = float(val_str) if prop["type"] in ("float", "double", "float32", "float64") else int(val_str)
                except ValueError:
                    row[prop["name"]] = 0
        rows.append(row)
    return rows


def load_ply(path: Path) -> tuple[
    list[tuple[float, float, float]],
    list[tuple[float, float, float]] | None,
    list[tuple[float, float, float]] | None,
    list[tuple[int, int, int]] | None,
]:
    """Load PLY file. Returns (positions, normals, colors, triangles)."""
    raw = path.read_bytes()

    # Split header from body
    end_header = raw.find(b"end_header")
    if end_header < 0:
        raise PlyParseError("PLY header end marker not found.")
    header_bytes = raw[:end_header]
    body_start = end_header + len(b"end_header")
    # Skip any trailing newline after end_header
    if body_start < len(raw) and raw[body_start:body_start + 1] in (b"\n", b"\r"):
        body_start += 1
    if body_start < len(raw) - 1 and raw[body_start - 1:body_start] == b"\r":
        body_start += 1

    header_lines = header_bytes.split(b"\n")
    meta = _parse_ply_header(header_lines)
    ply_format = meta["format"]
    elements: list[dict[str, Any]] = meta["elements"]

    vertex_elem = next((e for e in elements if e["name"] == "vertex"), None)
    face_elem = next((e for e in elements if e["name"] == "face"), None)

    if vertex_elem is None:
        raise PlyParseError("PLY file has no vertex element.")

    vertex_count: int = vertex_elem["count"]
    vertex_props: list[dict[str, Any]] = vertex_elem["properties"]
    face_count: int = face_elem["count"] if face_elem else 0
    face_props: list[dict[str, Any]] = face_elem["properties"] if face_elem else []

    vertex_rows: list[dict[str, Any]]
    face_rows: list[dict[str, Any]]

    if ply_format == "ascii":
        all_lines_iter = iter(raw[body_start:].split(b"\n"))
        vertex_rows = _read_ascii_element(all_lines_iter, vertex_props, vertex_count)
        face_rows = _read_ascii_element(all_lines_iter, face_props, face_count) if face_count else []
    else:
        endian = "little" if ply_format == "binary_little_endian" else "big"
        body = raw[body_start:]
        offset = 0
        # Read all elements in order
        all_rows: list[list[dict[str, Any]]] = []
        for elem in elements:
            rows, offset = _read_binary_element(body, offset, elem["properties"], elem["count"], endian)
            all_rows.append(rows)
        elem_names = [e["name"] for e in elements]
        vertex_rows = all_rows[elem_names.index("vertex")] if "vertex" in elem_names else []
        face_rows = all_rows[elem_names.index("face")] if "face" in elem_names else []

    # Extract positions
    prop_names = {p["name"] for p in vertex_props}
    has_normals = all(n in prop_names for n in ("nx", "ny", "nz"))
    has_colors_rgb = all(n in prop_names for n in ("r", "g", "b"))
    has_colors_full = all(n in prop_names for n in ("red", "green", "blue"))

    positions: list[tuple[float, float, float]] = [
        (float(v.get("x", 0)), float(v.get("y", 0)), float(v.get("z", 0)))
        for v in vertex_rows
    ]
    normals: list[tuple[float, float, float]] | None = None
    colors: list[tuple[float, float, float]] | None = None

    if has_normals:
        normals = [(float(v["nx"]), float(v["ny"]), float(v["nz"])) for v in vertex_rows]

    if has_colors_full:
        colors = [
            (min(1.0, float(v["red"]) / 255.0),
             min(1.0, float(v["green"]) / 255.0),
             min(1.0, float(v["blue"]) / 255.0))
            for v in vertex_rows
        ]
    elif has_colors_rgb:
        colors = [
            (min(1.0, float(v["r"]) / 255.0),
             min(1.0, float(v["g"]) / 255.0),
             min(1.0, float(v["b"]) / 255.0))
            for v in vertex_rows
        ]

    # Extract faces (triangulate quads)
    triangles: list[tuple[int, int, int]] | None = None
    if face_rows:
        face_prop = next((p["name"] for p in face_props if p["type"] == "list"), "vertex_indices")
        tris: list[tuple[int, int, int]] = []
        for face in face_rows:
            verts = face.get(face_prop, [])
            if len(verts) >= 3:
                # Fan triangulate
                for i in range(1, len(verts) - 1):
                    tris.append((int(verts[0]), int(verts[i]), int(verts[i + 1])))
        if tris:
            triangles = tris

    # Validate finite positions
    bad = sum(1 for p in positions if any(not math.isfinite(c) for c in p))
    if bad:
        print(f"WARNING: {bad} vertices have non-finite coordinates and will be set to (0,0,0).", file=sys.stderr)
        positions = [
            p if all(math.isfinite(c) for c in p) else (0.0, 0.0, 0.0)
            for p in positions
        ]

    return positions, normals, colors, triangles


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main() -> int:
    if len(sys.argv) not in (3, 4):
        print(f"Usage: {sys.argv[0]} input.ply output.glb [--points-only]", file=sys.stderr)
        return 2

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    points_only = "--points-only" in sys.argv

    if not input_path.is_file():
        print(f"ERROR: input file does not exist: {input_path}", file=sys.stderr)
        return 2

    try:
        print(f"Loading {input_path} ...", file=sys.stderr)
        positions, normals, colors, triangles = load_ply(input_path)
        print(f"  {len(positions)} vertices, {len(triangles or [])} faces", file=sys.stderr)

        if points_only:
            triangles = None

        output_path.parent.mkdir(parents=True, exist_ok=True)
        write_glb(output_path, positions, normals, colors, triangles)
        size_kb = output_path.stat().st_size // 1024
        print(f"Wrote {output_path} ({size_kb} KB)", file=sys.stderr)
        return 0

    except PlyParseError as err:
        print(f"ERROR: PLY parse failed: {err}", file=sys.stderr)
        return 1
    except Exception as err:  # noqa: BLE001
        print(f"ERROR: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
