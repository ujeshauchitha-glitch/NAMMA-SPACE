"""Web delivery: trained .ply -> compressed .sog (or compressed .ply) under a size budget, via @playcanvas/splat-transform.

The raw .ply stays in the work folder as the source of truth; only the compressed copy is published.
splat-transform is installed into tools/splat-transform by scripts/setup_tools.{ps1,sh} (or anywhere, pointed
to by $NAMMA_SPLAT_TRANSFORM_CLI) and run with node directly (no npx), so paths with spaces are plain arguments.

Headless Linux (Kaggle) and macOS 14: SOG's encoder uses WebGPU through Dawn's node bindings. Kaggle has no
WebGPU adapter (the `-g cpu` SOG encoder then ran 30+ min on the smoke test), and on macOS 14 splat-transform
cannot even start (its Dawn binary is built for macOS 15+). So SOG is tried once on the default adapter; if
that fails, the run writes `*.compressed.ply` with pipeline/compressed_ply.py (numpy, ~1 s for 0.5M splats,
121 MB -> 30 MB on Kaggle) and goes on to the bundle. `--sog-on-cpu` opts back into the slow CPU SOG encoder.
The studio's PlayCanvas engine loads compressed PLY natively (GSplatCompressedData). SPZ is not used:
PlayCanvas 2.23 cannot load it.
"""
from __future__ import annotations

import json
import os
import shutil
import time
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


def format_ladder(sog_on_cpu: bool = False) -> list[tuple[str, str | None]]:
    """Tried in order: SOG on the default WebGPU adapter, (opt-in) SOG on the CPU, then the compressed PLY
    from pipeline/compressed_ply.py, which needs no Node, GPU or network."""
    return [("scene.sog", None), *([("scene.sog", "cpu")] if sog_on_cpu else []), ("scene.compressed.ply", "python")]


def pick_format(src: Path, web: Path, log: Path, sog_on_cpu: bool = False,
                attempts: list | None = None) -> tuple[Path, str | None]:
    """SOG is ~10x smaller but its encoder wants WebGPU; without an adapter, write a compressed PLY."""
    attempts = [] if attempts is None else attempts
    for name, gpu in format_ladder(sog_on_cpu):
        out = web / name
        t = time.time()
        try:
            convert(src, out, [], log, gpu)
            attempts.append({"file": name, "encoder": gpu or "default", "ok": True, "seconds": round(time.time() - t, 1)})
            return out, gpu
        except PipelineError as e:
            first = str(e).splitlines()[0]
            attempts.append({"file": name, "encoder": gpu or "default", "ok": False,
                             "seconds": round(time.time() - t, 1), "error": first[:300]})
            print(f"compress: {out.suffix} (gpu={gpu or 'default'}) failed: {first}")
            if gpu is None and name.endswith(".sog") and not sog_on_cpu:
                print("compress: no usable WebGPU adapter for SOG; writing .compressed.ply instead "
                      "(--sog-on-cpu to encode SOG on the CPU, 30+ min)")
            out.unlink(missing_ok=True)
    raise PipelineError(f"Could not write .sog or .compressed.ply. See {log}")


def decimate(src: Path, dst: Path, keep: int, log: Path, gpu: str | None) -> None:
    """Uniformly keep `keep` splats: splat-transform when it runs, else numpy (same idea, seeded)."""
    if gpu != "python":
        run([*cli(), "-w", str(src), "-N", "-d", str(keep), str(dst)], log, "splat-transform decimate")
        return
    import clean_splat
    import numpy as np
    header, _, data = clean_splat.read_ply(src)
    idx = np.sort(np.random.default_rng(0).choice(len(data), size=min(keep, len(data)), replace=False))
    clean_splat.write_ply(dst, header, data[idx])


def compress(ply: Path, work: Path, report: Report, log: Path, max_mb: float = DEFAULT_MAX_MB,
             sog_on_cpu: bool = False) -> Path:
    t0 = time.time()
    web = work / "web"
    shutil.rmtree(web, ignore_errors=True)
    web.mkdir(parents=True)
    attempts: list = []
    report.data["compress_attempts"] = attempts
    try:
        out, gpu = pick_format(ply, web, log, sog_on_cpu, attempts)
    finally:
        report.save()
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
        decimate(ply, src, decimated_to, log, gpu)
        sh = ["-H", "0"]
        mb = convert(src, out, sh, log, gpu)
    (web / "decimated.ply").unlink(missing_ok=True)

    report.data["web_splat"] = {"file": str(out), "mb": round(mb, 1),
                                "format": "compressed.ply" if out.name.endswith(".compressed.ply") else out.suffix[1:],
                                "encoder": gpu or "default", "sh": " ".join(sh) or "full", "decimated_to": decimated_to,
                                "splat_transform": installed_version() or SPLAT_TRANSFORM_VERSION,
                                "seconds": round(time.time() - t0, 1)}
    if not report.check("web_splat_size", mb <= max_mb, f"{out.name} is {mb:.1f} MB; budget {max_mb:g} MB"):
        raise PipelineError(f"Could not get the splat under {max_mb:g} MB. Crop the room or train fewer splats.")
    print(f"compress: {ply.name} ({ply.stat().st_size / 1e6:.0f} MB) -> {out.name} ({mb:.1f} MB)")
    return out
