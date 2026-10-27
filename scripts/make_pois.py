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
import sys
from pathlib import Path

VALID_CATEGORIES = ["room", "service", "landmark", "furniture", "entrance", "other"]


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


def prompt_poi(index: int) -> dict:
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
    approach = prompt_float3("  x y z", (position[0], position[1], position[2] + 1.0))
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


def load_batch_csv(path: Path) -> list[dict]:
    """Load POIs from a CSV file.

    Expected columns (header required):
        id, label, category, px, py, pz, ax, ay, az, aliases, confidence, room_id, description

    All position columns are floats. aliases is a pipe-separated list.
    Missing optional columns are silently skipped.
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
            try:
                px, py, pz = float(row.get("px", 0)), float(row.get("py", 0.9)), float(row.get("pz", 0))
                ax, ay, az = float(row.get("ax", px)), float(row.get("ay", py)), float(row.get("az", pz + 1.0))
            except ValueError:
                print(f"  Row {i}: invalid position floats, using zeros.", file=sys.stderr)
                px, py, pz, ax, ay, az = 0.0, 0.9, 0.0, 0.0, 0.9, 1.0
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
    args = parser.parse_args()

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
            batch_pois = load_batch_csv(args.batch)
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
            poi = prompt_poi(index)
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
