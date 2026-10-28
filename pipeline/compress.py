"""Web delivery: Brush .ply -> compressed .sog (or .spz) under a size budget, via @playcanvas/splat-transform.

The raw .ply stays in the work folder as the source of truth; only the compressed copy is published.
splat-transform is installed into tools/splat-transform by scripts/setup_tools.ps1 and run with node directly
(no npx), so Windows paths with spaces are passed as plain arguments.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from common import TOOLS, PipelineError, Report, find_tool, run

SPLAT_TRANSFORM_VERSION = "3.10.3"
SPLAT_TRANSFORM_CLI = TOOLS / "splat-transform" / "node_modules" / "@playcanvas" / "splat-transform" / "bin" / "cli.mjs"
DEFAULT_MAX_MB = 50.0

# Tried in order until one fits the budget: fewer spherical-harmonic bands = smaller file, flatter view-dependent colour.
SH_STEPS: list[list[str]] = [[], ["-H", "2"], ["-H", "1"], ["-H", "0"]]
MAGIC = {".sog": b"PK", ".spz": b"\x1f\x8b"}


def cli() -> list[str]:
    if not SPLAT_TRANSFORM_CLI.is_file():
        raise PipelineError(f"splat-transform not installed at {SPLAT_TRANSFORM_CLI}. Run scripts/setup_tools.ps1.")
    return [find_tool("node"), str(SPLAT_TRANSFORM_CLI)]


def convert(src: Path, out: Path, extra: list[str], log: Path, gpu: str | None = None) -> float:
    """One splat-transform call; returns the output size in MB."""
    cmd = [*cli(), "-w", *(["-g", gpu] if gpu else []), str(src), "-N", *extra]
    if out.suffix == ".spz":
        cmd += ["--spz-version", "3"]  # v3 is the version every Spark release reads
    run([*cmd, str(out)], log, f"splat-transform -> {out.name}")
    if not out.is_file() or out.stat().st_size == 0:
        raise PipelineError(f"splat-transform reported success but wrote no {out}. See {log}")
    with open(out, "rb") as f:
        if not f.read(2).startswith(MAGIC[out.suffix]):
            raise PipelineError(f"{out} is not a valid {out.suffix} file. See {log}")
    return out.stat().st_size / 1e6


def pick_format(src: Path, web: Path, log: Path) -> tuple[Path, str | None]:
    """SOG is ~10x smaller but its encoder needs WebGPU; fall back to the CPU, then to SPZ."""
    for out, gpu in ((web / "scene.sog", None), (web / "scene.sog", "cpu"), (web / "scene.spz", None)):
        try:
            convert(src, out, [], log, gpu)
            return out, gpu
        except PipelineError as e:
            print(f"compress: {out.suffix} (gpu={gpu or 'default'}) failed: {str(e).splitlines()[0]}")
            out.unlink(missing_ok=True)
    raise PipelineError(f"splat-transform could not write .sog or .spz. See {log}")


def compress(ply: Path, work: Path, report: Report, log: Path, max_mb: float = DEFAULT_MAX_MB) -> Path:
    web = work / "web"
    shutil.rmtree(web, ignore_errors=True)
    web.mkdir(parents=True)
    out, gpu = pick_format(ply, web, log)
    mb, sh, src, decimated_to = out.stat().st_size / 1e6, [], ply, None
    for step in SH_STEPS[1:]:
        if mb <= max_mb:
            break
        sh = step
        mb = convert(src, out, sh, log, gpu)
    count = report.data.get("splat", {}).get("count")
    for _ in range(3):  # still too big with no SH: drop splats uniformly, aiming 10% under the budget
        if mb <= max_mb or not count:
            break
        decimated_to = int((decimated_to or count) * max_mb / mb * 0.9)
        src = web / "decimated.ply"
        run([*cli(), "-w", str(ply), "-N", "-d", str(decimated_to), str(src)], log, "splat-transform decimate")
        sh = ["-H", "0"]
        mb = convert(src, out, sh, log, gpu)
    (web / "decimated.ply").unlink(missing_ok=True)

    report.data["web_splat"] = {"file": str(out), "mb": round(mb, 1), "format": out.suffix[1:],
                                "sh": " ".join(sh) or "full", "decimated_to": decimated_to,
                                "splat_transform": SPLAT_TRANSFORM_VERSION}
    if not report.check("web_splat_size", mb <= max_mb, f"{out.name} is {mb:.1f} MB; budget {max_mb:g} MB"):
        raise PipelineError(f"Could not get the splat under {max_mb:g} MB. Crop the room or train fewer splats.")
    print(f"compress: {ply.name} ({ply.stat().st_size / 1e6:.0f} MB) -> {out.name} ({mb:.1f} MB)")
    return out
