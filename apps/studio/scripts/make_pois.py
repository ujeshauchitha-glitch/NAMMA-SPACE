#!/usr/bin/env python3
"""POI (Point of Interest) authoring tool.

Generates a pois.json compatible with the Namma Space PoiSchema (src/types/scene.ts).

Usage (interactive):
    python scripts/make_pois.py --output ./semantic/pois.json

Usage (batch seed from a CSV):
    python scripts/make_pois.py --output ./semantic/pois.json --batch pois_seed.csv

The generated file is an array of POI objects. Each POI has:
  id, label, category, position [x, y, z], approachPoint [x, y, z],
  aliases, confidence, source.

Valid categories: room, service, landmark, furniture, entrance, other
Valid sources for operator-authored content: operator

After generating, validate the scene bundle with:
    python scripts/validate_scene.py <scene-dir>
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import deque
from pathlib import Path

VALID_CATEGORIES = ["room", "service", "landmark", "furniture", "entrance", "other"]
DEFAULT_EYE_HEIGHT = 1.45


class Grid:
    """Navigation grid (grid.json): blocked and unknown cells are not walkable, as in the viewer."""

    def __init__(self, data: dict):
        self.width = data["width"]
        self.height = data["height"]
        self.cell = data["cellSize"]
        self.ox = data["origin"]["x"]
        self.oz = data["origin"]["z"]
        self.occupied = set(data.get("blocked", [])) | set(data.get("unknown", []))

    def cell_of(self, x: float, z: float) -> tuple[int, int]:
        return math.floor((x - self.ox) / self.cell), math.floor((z - self.oz) / self.cell)

    def walkable(self, cx: int, cz: int) -> bool:
        return 0 <= cx < self.width and 0 <= cz < self.height and cz * self.width + cx not in self.occupied

    def nearest_walkable(self, x: float, z: float) -> tuple[float, float] | None:
        """Centre of the walkable cell nearest to (x, z) by breadth-first search, or None."""
        cx, cz = self.cell_of(x, z)
        start = (min(self.width - 1, max(0, cx)), min(self.height - 1, max(0, cz)))
        seen = {start}
        queue = deque([start])
        while queue:
            gx, gz = queue.popleft()
            if self.walkable(gx, gz):
                return self.ox + (gx + 0.5) * self.cell, self.oz + (gz + 0.5) * self.cell
            for nx, nz in ((gx + 1, gz), (gx - 1, gz), (gx, gz + 1), (gx, gz - 1)):
                if 0 <= nx < self.width and 0 <= nz < self.height and (nx, nz) not in seen:
                    seen.add((nx, nz))
                    queue.append((nx, nz))
        return None


def find_scene(output: Path) -> tuple[Path | None, float | None]:
    """For <scene>/semantic/pois.json, the scene's grid.json and its start (eye) height, if declared."""
    manifest_path = output.resolve().parent.parent / "manifest.json"
    if not manifest_path.is_file():
        return None, None
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    nav = manifest.get("navigationUri")
    start = manifest.get("startPosition")
    eye = float(start[1]) if isinstance(start, list) and len(start) == 3 else None
    return (manifest_path.parent / nav if nav else None), eye


def snap_approach(grid: Grid | None, x: float, z: float, y: float, label: str, explicit: bool) -> list[float]:
    """Approach point for a POI at (x, z): the nearest walkable cell centre at height y.

    Without a grid the point is kept as given (or placed at the POI) and cannot be checked."""
    if grid is None:
        return [x, y, z]
    if explicit and grid.walkable(*grid.cell_of(x, z)):
        return [x, y, z]
    snapped = grid.nearest_walkable(x, z)
    if snapped is None:
        print(f"  WARNING: no walkable cell for '{label}'; approach point left at ({x:.2f}, {z:.2f}).", file=sys.stderr)
        return [x, y, z]
    if explicit:
        print(f"  '{label}': approach ({x:.2f}, {z:.2f}) is not walkable; snapped to ({snapped[0]:.2f}, {snapped[1]:.2f}).", file=sys.stderr)
    return [round(snapped[0], 4), y, round(snapped[1], 4)]


def slugify(label: str) -> str:
    """Convert a display label to a URL-safe ID fragment."""
    return label.lower().replace(" ", "-").replace("/", "-").replace("(", "").replace(")", "")


def prompt_float3(prompt: str, default: tuple[float, float, float] | None = None) -> tuple[float, float, float]:
    """Prompt the user for three whitespace-separated floats."""
    default_str = f" [{default[0]} {default[1]} {default[2]}]" if default else ""
    while True:
        raw = input(f"{prompt}{default_str}: ").strip()
        if not raw and default is not None:
            return default
        parts = raw.split()
        if len(parts) == 3:
            try:
                return float(parts[0]), float(parts[1]), float(parts[2])
            except ValueError:
                pass
        print("  Enter three numbers separated by spaces (e.g. 1.5 0.9 -2.3).")


def prompt_category() -> str:
    cats_display = " / ".join(VALID_CATEGORIES)
    while True:
        raw = input(f"  Category ({cats_display}) [room]: ").strip().lower() or "room"
        if raw in VALID_CATEGORIES:
            return raw
        print(f"  Must be one of: {cats_display}")


def prompt_poi(index: int, grid: Grid | None = None, eye: float = DEFAULT_EYE_HEIGHT) -> dict:
    print(f"\n-- POI #{index + 1} --")
    label = input("  Label (e.g. 'Reception Desk'): ").strip()
    if not label:
        return {}
    poi_id = input(f"  ID (leave blank for 'poi-{slugify(label)}'): ").strip() or f"poi-{slugify(label)}"
    category = prompt_category()
    room_id = input("  Room ID (leave blank if n/a): ").strip() or None
    print("  Position [x y z] — world-space centre of the POI marker:")
    position = prompt_float3("  x y z", (0.0, 0.9, 0.0))
    print("  Approach point [x y z] — where the player should stand to face this POI:")
    suggested = snap_approach(grid, position[0], position[2], eye, label, explicit=False)
    approach = prompt_float3("  x y z", (suggested[0], suggested[1], suggested[2]))
    approach = snap_approach(grid, approach[0], approach[2], approach[1], label, explicit=True)
    aliases_raw = input("  Aliases (comma-separated, or leave blank): ").strip()
    aliases = [a.strip() for a in aliases_raw.split(",") if a.strip()] if aliases_raw else []
    description = input("  Description (optional): ").strip() or None
    confidence_raw = input("  Confidence 0–1 [1.0]: ").strip() or "1.0"
    try:
        confidence = max(0.0, min(1.0, float(confidence_raw)))
    except ValueError:
        confidence = 1.0

    poi: dict = {
        "id": poi_id,
        "label": label,
        "category": category,
        "position": list(position),
        "approachPoint": list(approach),
        "aliases": aliases,
        "confidence": confidence,
        "source": "operator",
    }
    if room_id:
        poi["roomId"] = room_id
    if description:
        poi["description"] = description
    return poi


def load_batch_csv(path: Path, grid: Grid | None = None, eye: float = DEFAULT_EYE_HEIGHT) -> list[dict]:
    """Load POIs from a CSV file.

    Expected columns (header required):
        id, label, category, px, py, pz, ax, ay, az, aliases, confidence, room_id, description

    All position columns are floats. aliases is a pipe-separated list.
    Missing optional columns are silently skipped. Without ax/az the approach point is the walkable
    cell nearest the POI (with a grid); a given approach point that is not walkable is snapped.
    """
    pois = []
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for i, row in enumerate(reader, start=2):  # start=2 to account for header
            label = row.get("label", "").strip()
            if not label:
                print(f"  Row {i}: missing label, skipping.", file=sys.stderr)
                continue
            poi_id = row.get("id", "").strip() or f"poi-{slugify(label)}"
            category = row.get("category", "other").strip().lower()
            if category not in VALID_CATEGORIES:
                print(f"  Row {i}: unknown category '{category}', using 'other'.", file=sys.stderr)
                category = "other"
            def number(key: str, default: float) -> float:
                value = (row.get(key) or "").strip()
                return float(value) if value else default

            try:
                px, py, pz = number("px", 0.0), number("py", 0.9), number("pz", 0.0)
                explicit = bool((row.get("ax") or "").strip() or (row.get("az") or "").strip())
                ax, ay, az = number("ax", px), number("ay", eye), number("az", pz)
            except ValueError:
                print(f"  Row {i}: invalid position floats, using zeros.", file=sys.stderr)
                px, py, pz, ax, ay, az, explicit = 0.0, 0.9, 0.0, 0.0, eye, 0.0, False
            ax, ay, az = snap_approach(grid, ax, az, ay, label, explicit)
            aliases_raw = row.get("aliases", "").strip()
            aliases = [a.strip() for a in aliases_raw.split("|") if a.strip()] if aliases_raw else []
            try:
                confidence = max(0.0, min(1.0, float(row.get("confidence", 1.0))))
            except ValueError:
                confidence = 1.0

            poi: dict = {
                "id": poi_id,
                "label": label,
                "category": category,
                "position": [px, py, pz],
                "approachPoint": [ax, ay, az],
                "aliases": aliases,
                "confidence": confidence,
                "source": "operator",
            }
            room_id = row.get("room_id", "").strip()
            if room_id:
                poi["roomId"] = room_id
            description = row.get("description", "").strip()
            if description:
                poi["description"] = description
            pois.append(poi)
    return pois


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, required=True, help="Output path for pois.json.")
    parser.add_argument("--batch", type=Path, help="Load POIs from a CSV file instead of interactive entry.")
    parser.add_argument("--append", action="store_true", help="Append to an existing pois.json instead of overwriting.")
    parser.add_argument("--grid", type=Path, help="Navigation grid.json used to snap approach points onto walkable floor "
                        "(default: the scene's grid when --output is <scene>/semantic/pois.json).")
    parser.add_argument("--eye-height", type=float, help="Approach point height (default: the scene's start height, else 1.45).")
    args = parser.parse_args()

    scene_grid, scene_eye = find_scene(args.output)
    grid_path = args.grid or scene_grid
    grid = Grid(json.loads(grid_path.read_text(encoding="utf-8"))) if grid_path and grid_path.is_file() else None
    eye = args.eye_height if args.eye_height is not None else (scene_eye if scene_eye is not None else DEFAULT_EYE_HEIGHT)
    if grid is None:
        print("NOTE: no navigation grid given (--grid); approach points cannot be checked for walkability.", file=sys.stderr)

    pois: list[dict] = []

    # Load existing if appending
    if args.append and args.output.is_file():
        try:
            existing = json.loads(args.output.read_text(encoding="utf-8"))
            if isinstance(existing, list):
                pois = existing
                print(f"Loaded {len(pois)} existing POIs from {args.output}")
            else:
                print("WARNING: Existing file is not a JSON array. Starting fresh.", file=sys.stderr)
        except (json.JSONDecodeError, OSError) as err:
            print(f"WARNING: Could not read existing file: {err}", file=sys.stderr)

    # Batch CSV mode
    if args.batch:
        if not args.batch.is_file():
            print(f"ERROR: CSV file not found: {args.batch}", file=sys.stderr)
            return 2
        try:
            batch_pois = load_batch_csv(args.batch, grid, eye)
            print(f"Loaded {len(batch_pois)} POIs from CSV.")
            pois.extend(batch_pois)
        except (OSError, csv.Error) as err:
            print(f"ERROR: {err}", file=sys.stderr)
            return 1
    else:
        # Interactive mode
        print("=== POI Authoring Tool ===")
        print("Enter details for each Point of Interest.")
        print("Press Enter with an empty label to finish.\n")
        print("Coordinate system: right-handed Y-up, units = metres")
        print("  X = East / Right,  Y = Up,  Z = South / Toward viewer\n")

        index = len(pois)
        while True:
            poi = prompt_poi(index, grid, eye)
            if not poi:
                break
            pois.append(poi)
            index += 1
            print(f"  Added '{poi['label']}' (total: {index} POIs)")
            more = input("\nAdd another POI? [Y/n]: ").strip().lower()
            if more == "n":
                break

    # Check for duplicate IDs
    ids = [poi["id"] for poi in pois]
    duplicates = [pid for pid in ids if ids.count(pid) > 1]
    if duplicates:
        print(f"WARNING: Duplicate POI IDs detected: {set(duplicates)}", file=sys.stderr)
        print("  Each POI must have a unique ID. Edit the output file to fix this before publishing.")

    if not pois:
        print("No POIs entered. Writing empty array.")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(pois, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {len(pois)} POIs to {args.output}")
    print("\nNext steps:")
    print("  1. Open the JSON and verify positions and approach points in your 3D viewer.")
    print("  2. Pass this file to generate_scene_bundle.py --semantic")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
