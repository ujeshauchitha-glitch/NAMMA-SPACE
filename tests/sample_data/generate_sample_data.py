#!/usr/bin/env python3
"""Regenerate the SYNTHETIC sample data in tests/sample_data/.

Everything this script writes is SYNTHETIC — procedurally drawn corridor
frames with a burned-in "SYNTHETIC" watermark. No real capture, photo or
video of any actual space is involved. The data proves the ingestion
contracts (image folder, studio export ZIP, video frame extraction); it
proves nothing about real-world reconstruction accuracy.

Outputs (all deterministic, byte-for-byte, given the same ffmpeg build):
  images/                      8 drawn corridor JPEGs (image-folder input)
  synthetic_capture_bundle.zip studio export ZIP: manifest.json +
                               images/<sha256>.jpg (schemaVersion 1,
                               bundleKind "prepared-capture" — the exact
                               contract of apps/studio/scripts/prepare_capture.py
                               and apps/studio/src/lib/capture/exportBundle.ts)
  synthetic_clip.mp4           3 s drawn clip (video input)

Requires: python3 (stdlib only) + ffmpeg on PATH.

Usage:  python3 tests/sample_data/generate_sample_data.py
"""

from __future__ import annotations

import hashlib
import json
import shutil
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
WIDTH, HEIGHT = 320, 240
JPEG_QUALITY = 5          # ffmpeg -q:v; small files, still plainly visible
FIXED_ISO_TIME = "2026-01-01T00:00:00Z"
FIXED_EPOCH_MS = 1_767_225_600_000
ZIP_DATE_TIME = (2026, 1, 1, 0, 0, 0)

# 5x7 bitmap font for the burned-in watermark (only the letters we need).
FONT: dict[str, tuple[str, ...]] = {
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "Y": ("10001", "10001", "01010", "00100", "00100", "00100", "00100"),
    "N": ("10001", "11001", "10101", "10011", "10001", "10001", "10001"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "H": ("10001", "10001", "10001", "11111", "10001", "10001", "10001"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "I": ("11111", "00100", "00100", "00100", "00100", "00100", "11111"),
    "C": ("01110", "10001", "10000", "10000", "10000", "10001", "01110"),
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "F": ("11111", "10000", "10000", "11110", "10000", "10000", "10000"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "0": ("01110", "10001", "10011", "10101", "11001", "10001", "01110"),
    "1": ("00100", "01100", "00100", "00100", "00100", "00100", "01110"),
    "2": ("01110", "10001", "00001", "00010", "00100", "01000", "11111"),
    "3": ("11110", "00001", "00001", "01110", "00001", "00001", "11110"),
    "4": ("00010", "00110", "01010", "10010", "11111", "00010", "00010"),
    "5": ("11111", "10000", "11110", "00001", "00001", "10001", "01110"),
    "6": ("00110", "01000", "10000", "11110", "10001", "10001", "01110"),
    "7": ("11111", "00001", "00010", "00100", "01000", "01000", "01000"),
    "8": ("01110", "10001", "10001", "01110", "10001", "10001", "01110"),
    "9": ("01110", "10001", "10001", "01111", "00001", "00010", "01100"),
    " ": ("00000", "00000", "00000", "00000", "00000", "00000", "00000"),
    "M": ("10001", "11011", "10101", "10001", "10001", "10001", "10001"),
    "G": ("01110", "10001", "10000", "10011", "10001", "10001", "01110"),
    "P": ("11110", "10001", "10001", "11110", "10000", "10000", "10000"),
    "D": ("11100", "10010", "10001", "10001", "10001", "10010", "11100"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "B": ("11110", "10001", "10001", "11110", "10001", "10001", "11110"),
    "U": ("10001", "10001", "10001", "10001", "10001", "10001", "01110"),
    "W": ("10001", "10001", "10001", "10101", "10101", "11011", "10001"),
}


def draw_frame(index: int, total: int) -> bytearray:
    """Draw one synthetic corridor frame (RGB24), deterministic integer math.

    A simple one-point-perspective corridor: back wall, side walls, ceiling
    and a checkered floor whose bands compress towards the vanishing point.
    The camera slides laterally across the sequence to fake parallax.
    """
    width, height = WIDTH, HEIGHT
    vpx = width // 2 + int((index - (total - 1) / 2) * 6)   # vanishing point x
    vpy = height // 2
    bw, bh = 60, 44                                          # back-wall half-size
    pixels = bytearray(width * height * 3)

    for y in range(height):
        for x in range(width):
            dx, dy = x - vpx, y - vpy
            if abs(dx) < bw and abs(dy) < bh:
                # Back wall: warm amber, slightly darker at the edges.
                shade = 160 - (abs(dx) * 30 // bw) - (abs(dy) * 20 // bh)
                r, g, b = shade + 40, shade + 18, shade - 20
            elif dy >= bh or dy < -bh:
                # Floor / ceiling: perspective checker bands.
                band = max(4, int(240 / (1 + abs(dy) * 8 // bh)))
                tile = (x // band + index) % 2
                if dy > 0:  # floor: brown/taupe tiles
                    r, g, b = (120, 96, 72) if tile else (96, 76, 56)
                else:       # ceiling: pale panels
                    r, g, b = (196, 196, 190) if tile else (172, 172, 168)
            else:
                # Side walls: vertical amber panels, darker near the back.
                depth = (bw - abs(dx)) * 2
                panel = (y // 24) % 2
                base = 150 if panel else 120
                r, g, b = base + depth // 4, base, base - depth // 6
            # Burn the watermark into every frame (dark text, light outline).
            offset = (y * width + x) * 3
            pixels[offset] = max(0, min(255, r))
            pixels[offset + 1] = max(0, min(255, g))
            pixels[offset + 2] = max(0, min(255, b))

    draw_watermark(pixels, "SYNTHETIC", origin=(width // 2 - 45, height - 24), scale=2)
    draw_watermark(pixels, f"FRAME {index + 1:02d}", origin=(8, 8), scale=1)
    return pixels


def draw_watermark(pixels: bytearray, text: str, origin: tuple[int, int], scale: int) -> None:
    ox, oy = origin
    cursor = ox
    for char in text:
        glyph = FONT[char]
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit != "1":
                    continue
                for sy in range(scale):
                    for sx in range(scale):
                        px = cursor + gx * scale + sx
                        py = oy + gy * scale + sy
                        if 0 <= px < WIDTH and 0 <= py < HEIGHT:
                            offset = (py * WIDTH + px) * 3
                            # Near-black text with a thin white halo above/left.
                            pixels[offset : offset + 3] = bytes((16, 16, 16))
        cursor += 6 * scale


def write_ppm(path: Path, pixels: bytearray) -> None:
    path.write_bytes(f"P6\n{WIDTH} {HEIGHT}\n255\n".encode() + pixels)


def ffmpeg_encode(source: Path, target: Path, extra: list[str]) -> None:
    """Encode with bitexact flags so the same ffmpeg build gives identical bytes."""
    command = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-fflags", "+bitexact", "-i", str(source),
        *extra,
        "-fflags", "+bitexact", "-flags:v", "+bitexact", "-map_metadata", "-1",
        str(target),
    ]
    subprocess.run(command, check=True)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build_bundle_zip(images: list[Path]) -> Path:
    """Build the studio prepared-capture ZIP (contract: exportBundle.ts)."""
    entries = []
    image_data: list[bytes] = []
    for index, image in enumerate(images, start=1):
        data = image.read_bytes()
        image_data.append(data)
        entries.append({
            "id": f"img-{index:02d}",
            "viewGroupId": "vg-1" if index <= 4 else "vg-2",
            "sha256": sha256_bytes(data),
            "bytes": len(data),
            "width": WIDTH,
            "height": HEIGHT,
            "source": "operator",
            "stagedAt": FIXED_EPOCH_MS + index * 1000,
            "file": f"images/{sha256_bytes(data)}.jpg",
        })
    manifest = {
        "schemaVersion": 1,
        "bundleKind": "prepared-capture",
        "displayName": "Synthetic Corridor Sample (SYNTHETIC — generated, not a real space)",
        "createdAt": FIXED_ISO_TIME,
        "provenance": {
            "source": "operator",
            "pipeline": "tests/sample_data/generate_sample_data.py",
            "notes": [
                "SYNTHETIC data: procedurally drawn corridor frames with a burned-in SYNTHETIC watermark.",
                "Proves ingestion contracts only — proves nothing about real-world reconstruction accuracy.",
            ],
        },
        "counts": {"images": len(entries), "rooms": 1, "viewGroups": 2},
        "rooms": [{
            "id": "room-1",
            "name": "Synthetic Corridor (SYNTHETIC)",
            "dimensionsM": [8.0, 2.6, 4.0],
            "originM": [0.0, 0.0, 0.0],
            "createdAt": FIXED_EPOCH_MS,
            "viewGroupIds": ["vg-1", "vg-2"],
        }],
        "viewGroups": [
            {"id": "vg-1", "name": "Synthetic view group A (SYNTHETIC)", "roomId": "room-1", "createdAt": FIXED_EPOCH_MS, "imageIds": [e["id"] for e in entries[:4]]},
            {"id": "vg-2", "name": "Synthetic view group B (SYNTHETIC)", "roomId": "room-1", "createdAt": FIXED_EPOCH_MS, "imageIds": [e["id"] for e in entries[4:]]},
        ],
        "images": entries,
    }
    target = HERE / "synthetic_capture_bundle.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        info = zipfile.ZipInfo("manifest.json", date_time=ZIP_DATE_TIME)
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, json.dumps(manifest, indent=2) + "\n")
        for entry, data in zip(entries, image_data):
            info = zipfile.ZipInfo(entry["file"], date_time=ZIP_DATE_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    return target



def main() -> int:
    if shutil.which("ffmpeg") is None:
        print("ERROR: ffmpeg is required on PATH to regenerate the sample data.", file=sys.stderr)
        return 1

    images_dir = HERE / "images"
    images_dir.mkdir(exist_ok=True)

    images: list[Path] = []
    total = 8
    for index in range(total):
        ppm = HERE / f"_frame_{index:02d}.ppm"
        write_ppm(ppm, draw_frame(index, total))
        target = images_dir / f"sample_synthetic_{index + 1:02d}.jpg"
        ffmpeg_encode(ppm, target, ["-frames:v", "1", "-q:v", str(JPEG_QUALITY)])
        ppm.unlink()
        images.append(target)

    zip_path = build_bundle_zip(images)

    # 3 s clip at 4 fps (12 drawn frames with lateral motion), H.264.
    frames_dir = HERE / "_clip_frames"
    frames_dir.mkdir(exist_ok=True)
    clip_frames = []
    for index in range(12):
        ppm = frames_dir / f"clip_{index:03d}.ppm"
        write_ppm(ppm, draw_frame(index, 12))
        clip_frames.append(ppm)
    mp4 = HERE / "synthetic_clip.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-framerate", "4", "-i", str(frames_dir / "clip_%03d.ppm"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-video_track_timescale", "12800",
        "-fflags", "+bitexact", "-flags:v", "+bitexact", "-map_metadata", "-1",
        str(mp4),
    ], check=True)
    shutil.rmtree(frames_dir)

    print("Regenerated SYNTHETIC sample data:")
    for path in sorted(images) + [zip_path, mp4]:
        print(f"  {sha256_bytes(path.read_bytes())}  {path.relative_to(HERE)}  ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
