"""Dependency doctor and input validation. Nothing here modifies the dataset."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from common import MIN_USABLE_FRAMES, PipelineError, find_tool, list_images, min_duration_s, usable_frames

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"}

# Limits come from docs/SOP.md. Errors block the run; warnings are recorded.
MIN_SHORT_SIDE = 720
MIN_DURATION_S = 20
WARN_DURATION_S = 30
MAX_DURATION_S = 900
MIN_FPS = 24
MIN_PHOTOS = 40
MIN_FREE_GB = 10


@dataclass
class Issue:
    level: str  # "error" | "warn"
    message: str


def doctor(trainer: str, gpu: bool = True) -> list[tuple[str, bool, str]]:
    """Check every dependency the chosen configuration needs. Returns (name, ok, hint) rows."""
    win = sys.platform == "win32"
    rows: list[tuple[str, bool, str]] = []

    def row(name: str, found: bool, hint: str):
        rows.append((name, found, "" if found else hint))

    row("ffmpeg", bool(find_tool("ffmpeg", False)),
        "winget install Gyan.FFmpeg" if win else "sudo apt install ffmpeg")
    row("ffprobe", bool(find_tool("ffprobe", False)), "ships with ffmpeg")
    row("colmap", bool(find_tool("colmap", False)),
        "run scripts/setup_tools.ps1" if win else "sudo apt install colmap (or scripts/setup_tools.sh)")
    if trainer == "brush":
        row("brush_app", bool(find_tool("brush_app", False)),
            "run scripts/setup_tools.ps1" if win else "run scripts/setup_tools.sh")
    else:
        row("ns-train", bool(find_tool("ns-train", False)), "pip install nerfstudio (CUDA PyTorch env; see docs/TRAINING.md)")
        row("ns-export", bool(find_tool("ns-export", False)), "installed with nerfstudio")
    for mod in ("cv2", "numpy"):
        try:
            __import__(mod)
            row(f"python:{mod}", True, "")
        except ImportError:
            row(f"python:{mod}", False, "pip install opencv-python-headless numpy")
    if gpu and shutil.which("nvidia-smi"):
        out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
                             capture_output=True, text=True).stdout.strip()
        row(f"gpu ({out.splitlines()[0] if out else 'unknown'})", True, "")
    elif gpu:
        row("nvidia GPU (nvidia-smi)", False, "COLMAP's CUDA build needs an NVIDIA GPU; use --cpu with the no-CUDA build")
    return rows


def print_doctor(rows: list[tuple[str, bool, str]]) -> bool:
    ok = True
    for name, found, hint in rows:
        print(f"  [{'OK ' if found else 'MISSING'}] {name}" + (f"  ->  {hint}" if hint else ""))
        ok &= found
    return ok


def probe_video(video: Path) -> dict:
    out = subprocess.run(
        [find_tool("ffprobe"), "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,r_frame_rate,codec_name,nb_frames:stream_tags=rotate:"
         "stream_side_data=rotation:format=duration", "-of", "json", str(video)],
        capture_output=True, text=True)
    if out.returncode != 0 or not out.stdout.strip():
        raise PipelineError(f"{video.name}: ffprobe could not read it ({out.stderr.strip()[:200]}). Is it a valid video?")
    j = json.loads(out.stdout)
    if not j.get("streams"):
        raise PipelineError(f"{video.name}: no video stream found.")
    s = j["streams"][0]
    num, _, den = s.get("r_frame_rate", "0/1").partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 0.0
    return {"width": int(s["width"]), "height": int(s["height"]), "fps": round(fps, 2), "codec": s.get("codec_name"),
            "duration": float(j.get("format", {}).get("duration") or 0)}


def validate_video(video: Path, work: Path, sample_fps: float) -> tuple[dict, list[Issue]]:
    issues: list[Issue] = []
    if not video.exists():
        raise PipelineError(f"Input not found: {video}")
    if video.suffix.lower() not in VIDEO_EXT:
        issues.append(Issue("warn", f"unusual video extension {video.suffix!r}; trying anyway"))
    info = probe_video(video)
    short = min(info["width"], info["height"])
    if short < MIN_SHORT_SIDE:
        issues.append(Issue("error", f"resolution {info['width']}x{info['height']} is too low (short side < {MIN_SHORT_SIDE}). Re-shoot at 1080p or 4K."))
    if info["duration"] < MIN_DURATION_S:
        issues.append(Issue("error", f"only {info['duration']:.0f}s of video; a room needs at least {MIN_DURATION_S}s following the SOP path."))
    elif info["duration"] < WARN_DURATION_S:
        issues.append(Issue("warn", f"{info['duration']:.0f}s is short; coverage may be thin."))
    expected = usable_frames(info["duration"], sample_fps)
    info["expected_usable_frames"] = expected
    if info["duration"] >= MIN_DURATION_S and expected < MIN_USABLE_FRAMES:
        issues.append(Issue("error", f"{info['duration']:.0f}s at --fps {sample_fps:g} gives ~{expected} usable frames after blur "
                                     f"removal; need {MIN_USABLE_FRAMES}. Film at least {min_duration_s(sample_fps)}s or raise --fps."))
    if info["duration"] > MAX_DURATION_S:
        issues.append(Issue("error", f"{info['duration']:.0f}s is too long for one run; split per room (limit {MAX_DURATION_S}s)."))
    if info["fps"] and info["fps"] < MIN_FPS:
        issues.append(Issue("warn", f"{info['fps']} fps is low; fast pans will blur. Use 30 fps."))
    issues += disk_issues(work)
    return info, issues


def validate_photos(folder: Path, work: Path) -> tuple[dict, list[Issue]]:
    import cv2

    issues: list[Issue] = []
    files = list_images(folder)
    heic = [p.name for p in folder.iterdir() if p.suffix.lower() in {".heic", ".heif"}]
    if heic:
        issues.append(Issue("warn", f"{len(heic)} HEIC/HEIF files ignored (COLMAP cannot read them), e.g. {heic[:3]}. "
                                    "Export as JPG, or set iPhone Camera > Formats > Most Compatible."))
    if len(files) < MIN_PHOTOS:
        issues.append(Issue("error", f"{len(files)} photos found, need at least {MIN_PHOTOS}."))
    sizes: dict[tuple[int, int], int] = {}
    unreadable = []
    for f in files:
        img = cv2.imread(str(f))
        if img is None:
            unreadable.append(f.name)
        else:
            sizes[img.shape[1::-1]] = sizes.get(img.shape[1::-1], 0) + 1
    if unreadable:
        issues.append(Issue("error", f"{len(unreadable)} unreadable images, e.g. {unreadable[:3]}"))
    if len(sizes) > 1:
        issues.append(Issue("warn", f"mixed image sizes {dict(sizes)}; one camera at one resolution works best."))
    issues += disk_issues(work)
    return {"count": len(files), "sizes": {f"{w}x{h}": n for (w, h), n in sizes.items()}}, issues


def disk_issues(work: Path) -> list[Issue]:
    probe = work
    while not probe.exists():
        probe = probe.parent
    free = shutil.disk_usage(probe).free / 1e9
    if free < MIN_FREE_GB:
        return [Issue("error", f"only {free:.1f} GB free on the work drive; need at least {MIN_FREE_GB} GB.")]
    return []


def report_issues(issues: list[Issue]) -> bool:
    """Print issues; return True if none are blocking."""
    for i in issues:
        print(f"  [{'FAIL' if i.level == 'error' else 'WARN'}] {i.message}")
    return not any(i.level == "error" for i in issues)
