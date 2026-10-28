#!/usr/bin/env python3
"""Prepare a conservative, provenance-preserving frame set from phone media.

Accepts three input kinds:
  * a bundle ZIP exported by the capture studio (`manifest.json` at the archive
    root + staged frames under `images/<sha256>.jpg`) — digests are verified
    against the manifest and room/view-group metadata is carried into the
    output frame manifest;
  * a directory of images;
  * a video file (requires ffmpeg on PATH).

This is the CPU-safe ingest stage. It does not claim to reconstruct a scene.
COLMAP integration is intentionally a separate stage because its executable and
GPU/CPU runtime vary by machine.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import re
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".avi"}

# HEIC/HEIF ISO-BMFF brands recognized at the ftyp box (stdlib-only sniffing;
# `imghdr` was removed from the standard library in Python 3.13).
HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"heif", b"mif1"}

# Honest remedy copy for HEIC frames (voice guide §9.1 — never blame the user).
HEIC_REMEDY = "This file is HEIC — export JPG or run the prepare script."

# Raster formats resolved via the mimetypes fallback (signatures outside the
# magic table, kept for parity with the previous imghdr-based behaviour).
MIMETYPE_FALLBACKS = {
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/x-ms-bmp": "bmp",
    "image/tiff": "tiff",
    "image/x-icon": "ico",
}


def sniff_image_type(path: Path) -> str | None:
    """Classify a frame by magic bytes, falling back to the declared extension.

    Magic bytes are authoritative: a familiar extension never promotes content
    the signature check rejected (a .jpg name on non-JPEG bytes stays unknown).
    The mimetypes fallback only resolves formats whose signatures are not in
    the magic table.
    """
    try:
        with path.open("rb") as handle:
            header = handle.read(32)
    except OSError:
        return None
    if header[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if header[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "webp"
    if header[4:8] == b"ftyp" and header[8:12] in HEIC_BRANDS:
        return "heic"
    kind, _ = mimetypes.guess_type(path.name)
    return MIMETYPE_FALLBACKS.get(kind) if kind else None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --------------------------------------------------------------------------- #
# Bundle ZIP ingest (contract: apps/studio/src/lib/capture/exportBundle.ts).
#
# The studio exports a deterministic ZIP with exactly two kinds of members:
# `manifest.json` at the archive root, and staged frames under
# `images/<sha256>.jpg`. The manifest (schemaVersion 1, bundleKind
# "prepared-capture") carries rooms, view groups, and a sha256 per image.
# --------------------------------------------------------------------------- #

BUNDLE_MANIFEST = "manifest.json"
BUNDLE_IMAGE_DIR = "images"
BUNDLE_SCHEMA_VERSION = 1
BUNDLE_KIND = "prepared-capture"

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class BundleError(Exception):
    """A bundle could not be trusted or understood. The message is operator-facing."""


def safe_member_path(name: str) -> bool:
    """True when an archive/manifest path is a relative path that cannot escape its root."""
    if not name or name.startswith("/") or name.startswith("\\"):
        return False
    if re.match(r"^[A-Za-z]:", name):
        return False
    parts = re.split(r"[\\/]", name)
    return ".." not in parts


def validate_bundle_manifest(raw: str, members: set[str]) -> dict:
    """Parse and cross-check a bundle manifest against the archive's member list.

    Raises BundleError with an actionable message on anything untrusted:
    malformed JSON, wrong schema/kind, unsafe or missing image references,
    dangling room/view-group links.
    """
    try:
        manifest = json.loads(raw)
    except json.JSONDecodeError as error:
        raise BundleError(f"{BUNDLE_MANIFEST} is not valid JSON ({error}). The bundle is corrupt; export it again from the studio.") from error
    if not isinstance(manifest, dict):
        raise BundleError(f"{BUNDLE_MANIFEST} must be a JSON object. The bundle is corrupt; export it again from the studio.")
    if manifest.get("schemaVersion") != BUNDLE_SCHEMA_VERSION:
        raise BundleError(f"Unsupported bundle schemaVersion {manifest.get('schemaVersion')!r}; this script supports version {BUNDLE_SCHEMA_VERSION}.")
    if manifest.get("bundleKind") != BUNDLE_KIND:
        raise BundleError(f"Unsupported bundleKind {manifest.get('bundleKind')!r}; this script only ingests '{BUNDLE_KIND}' bundles.")

    rooms = manifest.get("rooms")
    view_groups = manifest.get("viewGroups")
    images = manifest.get("images")
    if not isinstance(rooms, list) or not isinstance(view_groups, list) or not isinstance(images, list):
        raise BundleError(f"{BUNDLE_MANIFEST} must contain 'rooms', 'viewGroups' and 'images' lists. The bundle is corrupt; export it again from the studio.")
    if not images:
        raise BundleError("The bundle manifest declares no images — nothing to prepare. Stage at least one image in the studio before exporting.")

    def require_ids(items: list, label: str) -> dict[str, dict]:
        index: dict[str, dict] = {}
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
                raise BundleError(f"Every {label} in {BUNDLE_MANIFEST} needs a non-empty string 'id'. The bundle is corrupt; export it again from the studio.")
            if item["id"] in index:
                raise BundleError(f"Duplicate {label} id {item['id']!r} in {BUNDLE_MANIFEST}. The bundle is corrupt; export it again from the studio.")
            index[item["id"]] = item
        return index

    rooms_by_id = require_ids(rooms, "room")
    groups_by_id = require_ids(view_groups, "view group")
    images_by_id = require_ids(images, "image")

    for group in view_groups:
        room_id = group.get("roomId")
        if room_id is not None and room_id not in rooms_by_id:
            raise BundleError(f"View group {group['id']!r} references room {room_id!r}, which the manifest does not declare.")

    for image in images:
        sha256 = image.get("sha256")
        if not isinstance(sha256, str) or not _SHA256_RE.match(sha256):
            raise BundleError(f"Image {image['id']!r} has no valid sha256 digest. The bundle is corrupt; export it again from the studio.")
        file = image.get("file")
        if not isinstance(file, str) or not safe_member_path(file) or not file.startswith(f"{BUNDLE_IMAGE_DIR}/"):
            raise BundleError(f"Image {image['id']!r} references {file!r}, which is outside the {BUNDLE_IMAGE_DIR}/ directory. The bundle is corrupt; export it again from the studio.")
        if file not in members:
            raise BundleError(f"The manifest references {file}, which is not in the archive. The bundle is incomplete; export it again from the studio.")
        group_id = image.get("viewGroupId")
        if group_id is not None and group_id not in groups_by_id:
            raise BundleError(f"Image {image['id']!r} references view group {group_id!r}, which the manifest does not declare.")
    for group in view_groups:
        for image_id in group.get("imageIds", []):
            if image_id not in images_by_id:
                raise BundleError(f"View group {group['id']!r} references image {image_id!r}, which the manifest does not declare.")
    for room in rooms:
        for group_id in room.get("viewGroupIds", []):
            if group_id not in groups_by_id:
                raise BundleError(f"Room {room['id']!r} references view group {group_id!r}, which the manifest does not declare.")
    return manifest


def ingest_bundle(source: Path, frames_dir: Path, limit: int) -> tuple[list[Path], list[dict], list[str], dict]:
    """Verify and extract a studio export ZIP into a deterministic flat frames dir.

    Returns (frame paths, per-frame metadata aligned with the paths, warnings,
    bundle summary). Every digest is recomputed from the bytes that actually
    ship; a mismatch is a hard failure, never a silently prepared frame set.
    """
    warnings: list[str] = []
    try:
        archive = zipfile.ZipFile(source)
    except zipfile.BadZipFile as error:
        raise BundleError(f"{source.name} is not a readable ZIP archive ({error}). Export the bundle again from the studio.") from error
    with archive:
        members = set(archive.namelist())
        for name in archive.namelist():
            if not safe_member_path(name):
                qualifier = "an absolute path" if name.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", name) else "a path that escapes the output directory"
                raise BundleError(f"The archive contains an entry with {qualifier} ({name!r}). Refusing to extract any part of this bundle.")
        if BUNDLE_MANIFEST not in members:
            raise BundleError(f"The archive has no {BUNDLE_MANIFEST} at its root — this is not a studio capture export.")
        try:
            raw_manifest = archive.read(BUNDLE_MANIFEST).decode("utf-8")
        except UnicodeDecodeError as error:
            raise BundleError(f"{BUNDLE_MANIFEST} is not valid UTF-8. The bundle is corrupt; export it again from the studio.") from error
        manifest = validate_bundle_manifest(raw_manifest, members)

        entries = manifest["images"]
        if len(entries) > limit:
            skipped = len(entries) - limit
            warnings.append(f"The bundle holds {len(entries)} images but --limit is {limit}; {skipped} image(s) were not prepared.")
        selected = entries[:limit]

        referenced = {entry["file"] for entry in entries}
        unreferenced = sorted(name for name in members if name not in referenced and name != BUNDLE_MANIFEST)
        if unreferenced:
            warnings.append(f"{len(unreferenced)} archive file(s) are not referenced by manifest.json and were skipped.")

        rooms_by_id = {room["id"]: room for room in manifest["rooms"]}
        groups_by_id = {group["id"]: group for group in manifest["viewGroups"]}

        frames_dir.mkdir(parents=True, exist_ok=True)
        frames: list[Path] = []
        frame_meta: list[dict] = []
        for index, entry in enumerate(selected, start=1):
            try:
                data = archive.read(entry["file"])
            except KeyError as error:
                raise BundleError(f"The manifest references {entry['file']}, which is not in the archive. The bundle is incomplete; export it again from the studio.") from error
            actual = hashlib.sha256(data).hexdigest()
            if actual != entry["sha256"]:
                raise BundleError(f"sha256 mismatch for {entry['file']}: manifest.json says {entry['sha256']}, the archive contains {actual}. The bundle is corrupt; export it again from the studio.")
            declared_bytes = entry.get("bytes")
            if isinstance(declared_bytes, int) and declared_bytes != len(data):
                raise BundleError(f"Size mismatch for {entry['file']}: manifest.json says {declared_bytes} bytes, the archive contains {len(data)}. The bundle is corrupt; export it again from the studio.")
            destination = frames_dir / f"frame-{index:05d}.jpg"
            destination.write_bytes(data)
            frames.append(destination)
            group = groups_by_id.get(entry.get("viewGroupId"))
            room = rooms_by_id.get(group.get("roomId")) if group else None
            frame_meta.append({
                "sourceEntryId": entry["id"],
                "viewGroupId": entry.get("viewGroupId"),
                "roomId": room["id"] if room else None,
                "width": entry.get("width"),
                "height": entry.get("height"),
                "source": entry.get("source"),
                "stagedAt": entry.get("stagedAt"),
            })

    bundle_summary = {
        "displayName": manifest.get("displayName"),
        "createdAt": manifest.get("createdAt"),
        "rooms": manifest["rooms"],
        "viewGroups": manifest["viewGroups"],
    }
    return frames, frame_meta, warnings, bundle_summary


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
    heic = []
    for frame in frames:
        kind = sniff_image_type(frame)
        if kind is None:
            invalid.append(str(frame))
        elif kind == "heic":
            heic.append(str(frame))
    return {
        "invalidFrameCount": len(invalid),
        "invalidFrames": invalid,
        "heicFrameCount": len(heic),
        "heicFrames": heic,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="bundle ZIP exported by the capture studio, video file, or directory of images")
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
    bundle_warnings: list[str] = []
    bundle_summary: dict | None = None
    frame_meta: list[dict] = []
    try:
        if source.is_dir():
            frames = copy_images(source, frames_dir, args.limit)
            source_kind = "image-directory"
        elif source.suffix.lower() in VIDEO_EXTENSIONS:
            frames = run_ffmpeg(source, frames_dir, args.fps, args.limit)
            source_kind = "video"
        elif source.suffix.lower() == ".zip" or zipfile.is_zipfile(source):
            frames, frame_meta, bundle_warnings, bundle_summary = ingest_bundle(source, frames_dir, args.limit)
            source_kind = "prepared-capture-bundle"
        else:
            raise RuntimeError("Unsupported input. Use a bundle ZIP exported from the studio, a video (MP4/MOV/M4V/AVI), or an image folder.")
    except BundleError as error:
        print(f"ERROR bundle ingest failed: {error}", file=sys.stderr)
        return 2
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"ERROR capture preparation failed: {error}", file=sys.stderr)
        return 1

    hashes = [sha256_file(frame) for frame in frames]
    duplicate_count = len(hashes) - len(set(hashes))
    tiny_frames = [str(frame.relative_to(output)) for frame in frames if frame.stat().st_size < 1024]
    quality_warnings = list(bundle_warnings)
    diagnostics = image_diagnostics(frames)
    if diagnostics["invalidFrameCount"]:
        quality_warnings.append(f"{diagnostics['invalidFrameCount']} frame file(s) could not be identified as readable raster images; verify file contents.")
    if diagnostics["heicFrameCount"]:
        quality_warnings.append(HEIC_REMEDY)
    if duplicate_count:
        quality_warnings.append(f"{duplicate_count} duplicate frame file(s) detected by SHA-256.")
    if tiny_frames:
        quality_warnings.append(f"{len(tiny_frames)} frame file(s) are under 1 KiB and may be corrupt or unusable.")
    if len(frames) < 8:
        quality_warnings.append("Fewer than 8 frames were prepared; indoor coverage is likely insufficient for reconstruction.")
    frame_records = []
    for index, frame in enumerate(frames):
        record = {"id": frame.stem, "path": str(frame.relative_to(output)), "sha256": hashes[index]}
        if index < len(frame_meta):
            record.update(frame_meta[index])
        frame_records.append(record)
    manifest = {
        "schemaVersion": 1,
        "captureId": f"capture-{sha256_file(source)[:12] if source.is_file() else source.name}",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": {"kind": source_kind, "path": str(source), "sha256": sha256_file(source) if source.is_file() else None},
        "sampling": {"fps": args.fps if source_kind == "video" else None, "limit": args.limit},
        "frames": frame_records,
        "quality": {
            "status": "warning" if quality_warnings else "passed",
            "warnings": quality_warnings,
            "measured": {"frameCount": len(frames), "duplicateFrameCount": duplicate_count, "tinyFrameCount": len(tiny_frames)},
            "diagnostics": diagnostics,
            "notMeasured": ["blur", "exposure consistency", "camera coverage", "pose registration", "scale accuracy", "geometry completeness", "navigation trustworthiness"],
        },
        "nextStage": "reconstruction-not-run",
    }
    if bundle_summary is not None:
        manifest["bundle"] = bundle_summary
    (output / "frame-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(frames)} frames in {output}")
    print(f"Manifest: {output / 'frame-manifest.json'}")
    print("Next stage: run a configured COLMAP adapter; this command does not claim reconstruction.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
