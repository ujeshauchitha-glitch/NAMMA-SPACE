#!/usr/bin/env python3
"""Prepare a conservative, provenance-preserving frame set from phone media.

This is the CPU-safe ingest stage. It does not claim to reconstruct a scene.
COLMAP integration is intentionally a separate stage because its executable and
GPU/CPU runtime vary by machine.
"""

from __future__ import annotations

import argparse
import hashlib
import imghdr
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".avi"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_ffmpeg(source: Path, frames_dir: Path, fps: float, limit: int) -> list[Path]:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg is not installed or not on PATH; install it or provide an image folder.")
    frames_dir.mkdir(parents=True, exist_ok=True)
    pattern = frames_dir / "frame-%05d.jpg"
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(source), "-vf", f"fps={fps},scale='min(1600,iw)':-2", "-frames:v", str(limit), "-q:v", "3", str(pattern)]
    subprocess.run(command, check=True)
    return sorted(frames_dir.glob("frame-*.jpg"))


def copy_images(source: Path, frames_dir: Path, limit: int) -> list[Path]:
    frames_dir.mkdir(parents=True, exist_ok=True)
    images = sorted(path for path in source.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS)
    if not images:
        raise RuntimeError("No supported images found. Use JPG, PNG, WEBP or HEIC files.")
    selected = images[:limit]
    output: list[Path] = []
    for index, image in enumerate(selected, start=1):
        destination = frames_dir / f"frame-{index:05d}{image.suffix.lower()}"
        shutil.copy2(image, destination)
        output.append(destination)
    return output


def image_diagnostics(frames: list[Path]) -> dict[str, object]:
    invalid = []
    for frame in frames:
        if frame.suffix.lower() == ".heic":
            continue
        if imghdr.what(frame) is None:
            invalid.append(str(frame))
    return {"invalidFrameCount": len(invalid), "invalidFrames": invalid}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="video file or directory of images")
    parser.add_argument("--output", type=Path, required=True, help="output capture directory")
    parser.add_argument("--fps", type=float, default=2.0, help="video sampling rate; default: 2")
    parser.add_argument("--limit", type=int, default=120, help="maximum frames; default: 120")
    args = parser.parse_args()

    source = args.input.resolve()
    if not source.exists():
        print(f"ERROR input does not exist: {source}", file=sys.stderr)
        return 2
    if args.limit < 1 or args.limit > 1000:
        print("ERROR --limit must be between 1 and 1000", file=sys.stderr)
        return 2

    output = args.output.resolve()
    frames_dir = output / "frames"
    output.mkdir(parents=True, exist_ok=True)
    try:
        if source.is_dir():
            frames = copy_images(source, frames_dir, args.limit)
            source_kind = "image-directory"
        elif source.suffix.lower() in VIDEO_EXTENSIONS:
            frames = run_ffmpeg(source, frames_dir, args.fps, args.limit)
            source_kind = "video"
        else:
            raise RuntimeError("Unsupported input. Use a video (MP4/MOV/M4V/AVI) or an image folder.")
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"ERROR capture preparation failed: {error}", file=sys.stderr)
        return 1

    hashes = [sha256_file(frame) for frame in frames]
    duplicate_count = len(hashes) - len(set(hashes))
    tiny_frames = [str(frame.relative_to(output)) for frame in frames if frame.stat().st_size < 1024]
    quality_warnings = []
    diagnostics = image_diagnostics(frames)
    if diagnostics["invalidFrameCount"]:
        quality_warnings.append(f"{diagnostics['invalidFrameCount']} frame file(s) could not be identified as readable raster images; verify file contents.")
    if duplicate_count:
        quality_warnings.append(f"{duplicate_count} duplicate frame file(s) detected by SHA-256.")
    if tiny_frames:
        quality_warnings.append(f"{len(tiny_frames)} frame file(s) are under 1 KiB and may be corrupt or unusable.")
    if len(frames) < 8:
        quality_warnings.append("Fewer than 8 frames were prepared; indoor coverage is likely insufficient for reconstruction.")
    manifest = {
        "schemaVersion": 1,
        "captureId": f"capture-{sha256_file(source)[:12] if source.is_file() else source.name}",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": {"kind": source_kind, "path": str(source), "sha256": sha256_file(source) if source.is_file() else None},
        "sampling": {"fps": args.fps if source_kind == "video" else None, "limit": args.limit},
        "frames": [{"id": frame.stem, "path": str(frame.relative_to(output)), "sha256": sha256_file(frame)} for frame in frames],
        "quality": {
            "status": "warning" if quality_warnings else "passed",
            "warnings": quality_warnings,
            "measured": {"frameCount": len(frames), "duplicateFrameCount": duplicate_count, "tinyFrameCount": len(tiny_frames)},
            "diagnostics": diagnostics,
            "notMeasured": ["blur", "exposure consistency", "camera coverage", "pose registration", "scale accuracy", "geometry completeness", "navigation trustworthiness"],
        },
        "nextStage": "reconstruction-not-run",
    }
    (output / "frame-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(frames)} frames in {output}")
    print(f"Manifest: {output / 'frame-manifest.json'}")
    print("Next stage: run a configured COLMAP adapter; this command does not claim reconstruction.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
