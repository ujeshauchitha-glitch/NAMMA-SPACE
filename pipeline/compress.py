"""Web delivery: trained .ply -> compressed .sog (or compressed .ply) under a size budget, via @playcanvas/splat-transform.

The raw .ply stays in the work folder as the source of truth; only the compressed copy is published.
splat-transform is installed into tools/splat-transform by scripts/setup_tools.{ps1,sh} (or anywhere, pointed
to by $NAMMA_SPLAT_TRANSFORM_CLI) and run with node directly (no npx), so paths with spaces are plain arguments.

Headless Linux (Kaggle): SOG's encoder uses WebGPU through Dawn's node bindings; with no WebGPU adapter it is
retried on the CPU (`-g cpu`, slower, same file). If SOG still cannot be written, the fallback is
splat-transform's compressed PLY (`*.compressed.ply`, chunked 16-bit quantisation, CPU only), which the
studio's PlayCanvas engine loads natively (GSplatCompressedData). SPZ is not used: PlayCanvas 2.23 cannot load it.
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

from common import TOOLS, PipelineError, Report, find_tool, run

SPLAT_TRANSFORM_VERSION = "3.11.2"  # npm, 2026-11-12; needs Node >= 22
SPLAT_TRANSFORM_CLI = TOOLS / "splat-transform" / "node_modules" / "@playcanvas" / "splat-transform" / "bin" / "cli.mjs"
DEFAULT_MAX_MB = 50.0

# Tried in order until one fits the budget: fewer spherical-harmonic bands = smaller file, flatter view-dependent colour.
SH_STEPS: list[list[str]] = [[], ["-H", "2"], ["-H", "1"], ["-H", "0"]]
MAGIC = {".sog": b"PK", ".spz": b"\x1f\x8b", ".ply": b"ply"}


def cli_path() -> Path:
    """$NAMMA_SPLAT_TRANSFORM_CLI (path to bin/cli.mjs), else the copy setup_tools installs into tools/."""
    env = os.environ.get("NAMMA_SPLAT_TRANSFORM_CLI")
    return Path(env) if env else SPLAT_TRANSFORM_CLI


def installed_version() -> str | None:
    pkg = cli_path().parent.parent / "package.json"
    try:
        return json.loads(pkg.read_text())["version"]
    except (OSError, ValueError, KeyError):
        return None


def cli() -> list[str]:
    path = cli_path()
    if not path.is_file():
        raise PipelineError(f"splat-transform not installed at {path}. Run scripts/setup_tools.sh (Linux) or "
                            ".ps1 (Windows), or set NAMMA_SPLAT_TRANSFORM_CLI to its bin/cli.mjs.")
    return [find_tool("node"), str(path)]


def convert(src: Path, out: Path, extra: list[str], log: Path, gpu: str | None = None) -> float:
    """One splat-transform call (or, with gpu="python", the built-in compressed-PLY writer); returns MB."""
    if gpu == "python":
        import compressed_ply
        bands = int(extra[extra.index("-H") + 1]) if "-H" in extra else None
        try:
            compressed_ply.convert(src, out, bands)
        except (OSError, ValueError) as e:
            raise PipelineError(f"compressed_ply.py could not convert {src}: {e}") from e
        return out.stat().st_size / 1e6
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


# Tried in order: SOG on the default WebGPU adapter, SOG on the CPU, splat-transform's compressed PLY (no GPU),
# and finally the same compressed PLY from pipeline/compressed_ply.py (no Node at all).
FORMAT_LADDER: list[tuple[str, str | None]] = [("scene.sog", None), ("scene.sog", "cpu"),
                                               ("scene.compressed.ply", None), ("scene.compressed.ply", "python")]


def pick_format(src: Path, web: Path, log: Path) -> tuple[Path, str | None]:
    """SOG is ~10x smaller but its encoder wants WebGPU; fall back to the CPU, then to a compressed PLY."""
    for name, gpu in FORMAT_LADDER:
        out = web / name
        try:
            convert(src, out, [], log, gpu)
            return out, gpu
        except PipelineError as e:
            print(f"compress: {out.suffix} (gpu={gpu or 'default'}) failed: {str(e).splitlines()[0]}")
            out.unlink(missing_ok=True)
    raise PipelineError(f"splat-transform could not write .sog or .compressed.ply. See {log}")


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

    report.data["web_splat"] = {"file": str(out), "mb": round(mb, 1),
                                "format": "compressed.ply" if out.name.endswith(".compressed.ply") else out.suffix[1:],
                                "encoder": gpu or "default", "sh": " ".join(sh) or "full", "decimated_to": decimated_to,
                                "splat_transform": installed_version() or SPLAT_TRANSFORM_VERSION}
    if not report.check("web_splat_size", mb <= max_mb, f"{out.name} is {mb:.1f} MB; budget {max_mb:g} MB"):
        raise PipelineError(f"Could not get the splat under {max_mb:g} MB. Crop the room or train fewer splats.")
    print(f"compress: {ply.name} ({ply.stat().st_size / 1e6:.0f} MB) -> {out.name} ({mb:.1f} MB)")
    return out
