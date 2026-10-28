"""Shared helpers: tool lookup, logged subprocess runs, and the per-run report."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"

# Report statuses. Nothing is "successful" until a human has looked at the result.
FAILED = "failed"
AWAITING_INSPECTION = "automated_checks_passed_awaiting_inspection"
INSPECTED_OK = "inspected_ok"

# Image types COLMAP reads. Matched case-insensitively (phones write .JPG).
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}


def list_images(folder: Path) -> list[Path]:
    """Image files directly inside `folder`, any extension case; everything else is ignored."""
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXT)


# Frame budget for video input. Validation and extraction both use usable_frames(), so a clip that
# passes --check cannot fail the frame-count check after extraction.
MIN_USABLE_FRAMES = 80
BLUR_DROP = 0.15  # fraction of sampled frames removed as the blurriest


def usable_frames(duration_s: float, fps: float) -> int:
    """Frames left after sampling at `fps` and dropping the blurriest BLUR_DROP fraction."""
    sampled = int(duration_s * fps)
    return sampled - int(sampled * BLUR_DROP)


def min_duration_s(fps: float) -> int:
    """Shortest clip, in whole seconds, that yields MIN_USABLE_FRAMES at `fps`."""
    d = 1
    while usable_frames(d, fps) < MIN_USABLE_FRAMES:
        d += 1
    return d


class PipelineError(RuntimeError):
    """A stage failed in a way the user can act on. The message says what to do."""


def find_tool(name: str, required: bool = True) -> str | None:
    exe = name + (".exe" if sys.platform == "win32" else "")
    if TOOLS.exists():
        for p in TOOLS.rglob(exe):
            if p.is_file():
                return str(p)
    found = shutil.which(name)
    if found:
        return found
    if required:
        raise PipelineError(f"'{name}' not found. Run `python pipeline/run_pipeline.py --doctor` for install steps.")
    return None


def run(cmd: list[str], log: Path | None = None, stage: str = "") -> str:
    """Run a command, stream its output, tee it to `log`, and raise PipelineError on failure."""
    print(f"\n$ {' '.join(cmd)}", flush=True)
    lines: list[str] = []
    fh = open(log, "a", encoding="utf-8") if log else None
    try:
        if fh:
            fh.write(f"\n$ {' '.join(cmd)}\n")
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                encoding="utf-8", errors="replace")
        assert proc.stdout
        for line in proc.stdout:
            print(line, end="", flush=True)
            lines.append(line)
            if fh:
                fh.write(line)
        code = proc.wait()
    except FileNotFoundError as e:
        raise PipelineError(f"{stage or cmd[0]}: cannot execute {cmd[0]!r}: {e}") from e
    finally:
        if fh:
            fh.close()
    out = "".join(lines)
    if code != 0:
        tail = "".join(lines[-15:]).strip()
        where = f" Full log: {log}" if log else ""
        raise PipelineError(f"{stage or cmd[0]} failed with exit code {code}.{where}\n--- last output ---\n{tail}")
    return out


@dataclass
class Report:
    """JSON report written next to the outputs; the single source of truth for a run's state."""

    path: Path
    data: dict = field(default_factory=dict)

    @classmethod
    def load(cls, work: Path) -> "Report":
        p = work / "report.json"
        data = json.loads(p.read_text()) if p.exists() else {"status": FAILED, "stages": {}, "checks": {}}
        return cls(p, data)

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=2, default=str))

    def stage(self, name: str, seconds: float, **info) -> None:
        self.data.setdefault("stages", {})[name] = {"seconds": round(seconds, 1), **info}
        self.save()

    def check(self, name: str, ok: bool, detail: str, level: str = "error") -> bool:
        """Record a check. level='warn' records but never fails the run."""
        self.data.setdefault("checks", {})[name] = {"ok": ok, "level": level, "detail": detail}
        mark = "PASS" if ok else ("WARN" if level == "warn" else "FAIL")
        print(f"  [{mark}] {name}: {detail}")
        self.save()
        return ok or level == "warn"

    def blocking_failures(self) -> list[str]:
        return [k for k, v in self.data.get("checks", {}).items() if not v["ok"] and v["level"] == "error"]


class Timer:
    def __enter__(self):
        self.t = time.time()
        return self

    def __exit__(self, *exc):
        self.seconds = time.time() - self.t
