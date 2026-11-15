"""Shared helpers: tool lookup, logged subprocess runs, and the per-run report."""
from __future__ import annotations

import json
import math
import os
import re
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


def tool_env_var(name: str) -> str:
    """Environment variable that overrides where a tool is found, e.g. NAMMA_COLMAP=/opt/colmap/bin/colmap."""
    return "NAMMA_" + name.upper().replace("-", "_")


def find_tool(name: str, required: bool = True) -> str | None:
    """Locate an executable: $NAMMA_<NAME> first, then ./tools (Windows setup script), then PATH.

    Works the same on Windows, Linux (Kaggle, WSL2) and macOS; nothing here assumes PowerShell.
    """
    override = os.environ.get(tool_env_var(name))
    if override:
        if Path(override).is_file() or shutil.which(override):
            return shutil.which(override) or override
        if required:
            raise PipelineError(f"{tool_env_var(name)}={override!r} does not point to an executable.")
        return None
    exe = name + (".exe" if sys.platform == "win32" else "")
    if TOOLS.exists():
        for p in TOOLS.rglob(exe):
            if p.is_file() and (sys.platform == "win32" or os.access(p, os.X_OK)):
                return str(p)
    found = shutil.which(name)
    if found:
        return found
    if required:
        raise PipelineError(f"'{name}' not found. Set {tool_env_var(name)} or put it on PATH; "
                            "`python pipeline/run_pipeline.py --doctor` lists install steps.")
    return None


def module_version(name: str) -> str | None:
    """Installed version of a Python distribution WITHOUT importing it (importing torch and pycolmap in one
    process can abort: each bundles its own OpenMP runtime)."""
    from importlib import metadata
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def torch_cuda_probe() -> dict:
    """Ask a child Python whether torch sees CUDA (keeps torch out of this process)."""
    code = ("import json, torch; ok = torch.cuda.is_available(); "
            "print(json.dumps({'cuda': ok, 'gpu': torch.cuda.get_device_name(0) if ok else None, "
            "'torch_cuda': torch.version.cuda, 'capability': list(torch.cuda.get_device_capability(0)) if ok else None}))")
    try:
        out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=300)
        return json.loads(out.stdout.strip().splitlines()[-1]) if out.returncode == 0 else {"error": out.stderr[-500:]}
    except (OSError, subprocess.TimeoutExpired, ValueError, IndexError) as e:
        return {"error": str(e)}


# ---------------------------------------------------------------- COLMAP versions
# COLMAP 3.x and 4.x name the GPU switches differently; 4.0 moved them from SiftExtraction/SiftMatching to
# FeatureExtraction/FeatureMatching (the old names are rejected by 4.x). Checked against the 4.2.1 sources.
COLMAP_GPU_OPTIONS = {
    3: {"extract_gpu": "--SiftExtraction.use_gpu", "match_gpu": "--SiftMatching.use_gpu"},
    4: {"extract_gpu": "--FeatureExtraction.use_gpu", "match_gpu": "--FeatureMatching.use_gpu"},
}


def parse_colmap_version(text: str) -> tuple[int, int, int] | None:
    """'COLMAP 3.9.1 (Commit ...)' or 'COLMAP 4.2.1 -- Structure-from-Motion ...' -> (3, 9, 1)."""
    m = re.search(r"COLMAP\s+(\d+)\.(\d+)(?:\.(\d+))?", text)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)) if m else None


def colmap_version(colmap: str) -> tuple[int, int, int] | None:
    """Ask the COLMAP binary its version (`colmap version` on 3.7+, else the help banner)."""
    for args in (["version"], ["-h"]):
        try:
            out = subprocess.run([colmap, *args], capture_output=True, text=True, timeout=60)
        except (OSError, subprocess.TimeoutExpired):
            continue
        v = parse_colmap_version(out.stdout + out.stderr)
        if v:
            return v
    return None


def colmap_gpu_options(version: tuple[int, int, int] | None) -> dict[str, str]:
    """Option names for this COLMAP; unknown versions get the 4.x names (what setup_tools installs)."""
    major = version[0] if version else 4
    return COLMAP_GPU_OPTIONS[3 if major <= 3 else 4]


def run(cmd: list[str], log: Path | None = None, stage: str = "", env: dict | None = None) -> str:
    """Run a command, stream its output, tee it to `log`, and raise PipelineError on failure. `env` adds to
    (or overrides) this process's environment for the child."""
    print(f"\n$ {' '.join(cmd)}", flush=True)
    lines: list[str] = []
    fh = open(log, "a", encoding="utf-8") if log else None
    try:
        if fh:
            fh.write(f"\n$ {' '.join(cmd)}\n")
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                encoding="utf-8", errors="replace", env={**os.environ, **env} if env else None)
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


def json_safe(v):
    """Replace non-finite floats (inf, nan) with None, recursively, so the result is valid JSON."""
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if isinstance(v, dict):
        return {k: json_safe(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [json_safe(x) for x in v]
    return v


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
        # allow_nan=False: Python would otherwise write Infinity/NaN, which is not JSON (browsers reject it).
        self.path.write_text(json.dumps(json_safe(self.data), indent=2, default=str, allow_nan=False))

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
