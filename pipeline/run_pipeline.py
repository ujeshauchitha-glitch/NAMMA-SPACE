"""Smartphone video (or photos) -> Gaussian splat for the Namma Space viewer.

    python pipeline/run_pipeline.py --doctor                       # check dependencies
    python pipeline/run_pipeline.py capture.mp4 --out work/room1 --check   # validate input only
    python pipeline/run_pipeline.py capture.mp4 --out work/room1           # full run
    python pipeline/run_pipeline.py --approve work/room1 --note "walked it, no major holes"

Stages (each is skipped if its output exists; use --force to redo):
  validate  input checks (resolution, duration, disk) -> report.json
  frames    ffmpeg sampling + blurry-frame removal
  sfm       COLMAP features, matching, mapping, undistortion + registration checks. Backend: the `colmap`
            executable (Windows setup) or pycolmap (Linux/Kaggle: pip install pycolmap-cuda12), chosen by --sfm.
  train     Brush (Windows default), gsplat (Linux default; CUDA PyTorch) or Nerfstudio splatfacto + checks
  world     bake the bundle's world frame (levelled, metres) into the cleaned .ply (scene_bundle.bake_ply)
  compress  .ply -> .sog (or .compressed.ply) under --max-mb; always re-run
  publish   studio scene bundle (manifest, compressed splat, navigation grid, start POI) in work/<name>/bundle/.
            The raw .ply is never published.

Profiles (--profile): preview = <=720p frames, 7k steps, 0.75M splats (aim: <=30 min on a Kaggle T4);
final = 1080p, 30k steps, 1.5M splats. Explicit flags override the profile. report.json records every
stage's wall time plus the GPU, tool versions and frame/registration counts (see environment_info()).

report.json status:
  failed                                       a blocking check failed
  automated_checks_passed_awaiting_inspection  files exist and pass checks, but nobody has looked at them
  inspected_ok                                 set only by --approve, after a person walked the result in the viewer
Reconstruction is never called successful before `inspected_ok`.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import checks  # noqa: E402
import compress  # noqa: E402
import preflight  # noqa: E402
from common import (AWAITING_INSPECTION, BLUR_DROP, FAILED, INSPECTED_OK, MIN_USABLE_FRAMES, ROOT,  # noqa: E402
                    PipelineError, Report, Timer, colmap_gpu_options, colmap_version, find_tool, list_images,
                    module_version, run)


# ---------------------------------------------------------------- frames
def extract_frames(video: Path, out: Path, fps: float, width: int, log: Path) -> int:
    frames = out / "frames"
    if frames.exists() and any(frames.glob("*.jpg")):
        print("frames: already extracted")
        return len(list(frames.glob("*.jpg")))
    frames.mkdir(parents=True, exist_ok=True)
    run([find_tool("ffmpeg"), "-y", "-i", str(video), "-vf", f"fps={fps},scale='min({width},iw)':-2",
         "-qscale:v", "2", str(frames / "%05d.jpg")], log, "frame extraction")
    return drop_blurry(frames)


def blur_drop_indices(scores: list[float], drop: float = BLUR_DROP) -> set[int]:
    """Which frames (indices in video order) to drop: the blurriest, but never two neighbours.

    Blur clusters where the phone turned fast, and those are exactly the frames that link one part of the
    walk to the next. Dropping the blurriest 15% outright removed whole turns (frames 23-29, 72-75 and
    100-104 of the sample clip) and split SfM into three disconnected models (43+25+24 of 92 frames);
    keeping every other frame through a blurry run kept all 92 kept frames in one model. Only frames
    below half the median sharpness are candidates, so fewer than `drop` may be removed."""
    target = int(len(scores) * drop)
    # Only frames clearly blurrier than typical are candidates: topping up the quota with sharp frames
    # would just throw away views.
    cutoff = 0.5 * float(sorted(scores)[len(scores) // 2]) if scores else 0.0
    dropped: set[int] = set()
    for i in sorted(range(len(scores)), key=lambda i: scores[i]):
        if len(dropped) >= target or scores[i] >= cutoff:
            break
        if i - 1 in dropped or i + 1 in dropped:
            continue
        dropped.add(i)
    return dropped


def drop_blurry(frames: Path, drop: float = BLUR_DROP) -> int:
    """Remove blurry frames by variance of the Laplacian (see blur_drop_indices); returns the number kept."""
    import cv2

    files, scores = [], []
    for f in sorted(frames.glob("*.jpg")):
        g = cv2.imread(str(f), cv2.IMREAD_GRAYSCALE)
        if g is None:
            f.unlink()
            continue
        files.append(f)
        scores.append(cv2.Laplacian(g, cv2.CV_64F).var())
    dropped = blur_drop_indices(scores, drop)
    for i in dropped:
        files[i].unlink()
    kept = len(files) - len(dropped)
    print(f"frames: kept {kept}/{len(files)} (dropped {len(dropped)} blurriest, never two in a row)")
    return kept


def copy_photos(src: Path, frames: Path) -> int:
    """Copy only the image files from `src` (COLMAP would trip over videos, .HEIC, sidecars)."""
    frames.mkdir(parents=True, exist_ok=True)
    images = list_images(src)
    for f in images:
        if not (frames / f.name).exists():
            shutil.copy2(f, frames / f.name)
    skipped = sum(1 for p in src.iterdir() if p.is_file()) - len(images)
    print(f"frames: copied {len(images)} photos" + (f" (ignored {skipped} non-image files)" if skipped else ""))
    return len(list_images(frames))


# ---------------------------------------------------------------- sfm
def sfm(work: Path, matcher: str, gpu: bool, report: Report, log: Path, mapper: str = "incremental",
        backend: str = "colmap", loop_closure: bool = True, max_image_size: int = 1920) -> Path:
    if backend == "pycolmap":
        return sfm_with_pycolmap(work, matcher, gpu, report, log, mapper, loop_closure, max_image_size)
    colmap = find_tool("colmap")
    version = colmap_version(colmap)
    opt = colmap_gpu_options(version)
    report.data.setdefault("versions", {})["colmap"] = ".".join(map(str, version)) if version else "unknown"
    if mapper == "global" and (version or (4,))[0] < 4:
        print("sfm: COLMAP < 4 has no global mapper; using the incremental mapper")
        mapper = "incremental"
    db, images, sparse, dataset = work / "colmap.db", work / "frames", work / "sparse", work / "dataset"
    total = len(list_images(images))
    if (dataset / "sparse").exists():
        print("sfm: already done")
        return dataset
    use_gpu = "1" if gpu else "0"
    if db.exists():
        db.unlink()  # a half-finished database from a failed run poisons matching
    # OPENCV's 2-focal + 4-distortion single-camera calibration fails initial-pair/BA on real photos:
    # 2-20/70 vs 50-59/70 with SIMPLE_RADIAL, verified 2026-10-29. Keep the value explicit.
    run([colmap, "feature_extractor", "--database_path", str(db), "--image_path", str(images),
         "--ImageReader.single_camera", "1", "--ImageReader.camera_model", "SIMPLE_RADIAL",
         opt["extract_gpu"], use_gpu], log, "COLMAP feature extraction")
    # sequential matching suits walk-through video; exhaustive suits unordered photo sets.
    run([colmap, f"{matcher}_matcher", "--database_path", str(db), opt["match_gpu"], use_gpu],
        log, "COLMAP matching")
    shutil.rmtree(sparse, ignore_errors=True)
    sparse.mkdir()
    run([colmap, "global_mapper" if mapper == "global" else "mapper", "--database_path", str(db),
         "--image_path", str(images), "--output_path", str(sparse)], log, f"COLMAP {mapper} mapping")
    best = pick_model(sorted(p for p in sparse.iterdir() if p.is_dir()), total, report, log)
    run([colmap, "image_undistorter", "--image_path", str(images), "--input_path", str(best),
         "--output_path", str(dataset), "--output_type", "COLMAP"], log, "COLMAP undistortion")
    return dataset


def pick_model(models: list[Path], total: int, report: Report, log: Path) -> Path:
    """Best (most registered) model, its checks, and the scraps; raises PipelineError if checks fail."""
    if not models:
        raise PipelineError("COLMAP produced no model. Typical causes: motion blur, too little overlap, "
                            "plain walls. Re-shoot slower following docs/SOP.md.")
    stats = [(checks.colmap_model_stats(m, log), m) for m in models]
    best_stats, best = max(stats, key=lambda s: s[0]["registered_images"] or 0)
    extra_sizes = [s["registered_images"] or 0 for s, m in stats if m != best]
    significant, scraps = checks.split_extra_models(extra_sizes, total)
    if not checks.check_sfm(report, best_stats, total, significant):
        raise PipelineError("SfM checks failed (see report.json). Not training on a bad camera solution.")
    if scraps:
        report.data["sfm"]["ignored_fragment_images"] = scraps
        report.save()
    return best


GLOBAL_SEEDS = (1, 2)  # global mapping attempts before the incremental fallback


def attempt_name(mapper: str, seed: int | None) -> str:
    return f"{mapper} (seed {seed})" if seed is not None else mapper


def sfm_with_pycolmap(work: Path, matcher: str, gpu: bool, report: Report, log: Path, mapper: str,
                      loop_closure: bool, max_image_size: int) -> Path:
    """pycolmap backend (see sfm_pycolmap.py for why). Matches once, then maps on a fresh copy of the
    matched database per attempt: the global mapper with each of GLOBAL_SEEDS while its positioning solve
    ends unconverged, and, if that or a registration below MIN_REGISTRATION remains, the incremental mapper
    on the same matches."""
    import sfm_pycolmap as sp

    pycolmap = sp.import_pycolmap()
    report.data.setdefault("versions", {}).update(sp.versions())
    if gpu and not getattr(pycolmap, "has_cuda", False):
        raise PipelineError("This pycolmap has no CUDA support. Install pycolmap-cuda12 (Linux) or run with --cpu.")
    images, sparse, dataset = work / "frames", work / "sparse", work / "dataset"
    matched = work / f"colmap_{matcher}.db"
    total = len(list_images(images))
    pos = report.data.get("sfm_global_positioning") or {}
    if (dataset / "sparse").exists() and report.data.get("sfm", {}).get("mapper") == "global" \
            and pos.get("converged") is False:
        print("sfm: the cached poses come from an unconverged global positioning solve; mapping again")
        shutil.rmtree(dataset, ignore_errors=True)
    if (dataset / "sparse").exists():
        print("sfm: already done")
        return dataset
    settings = sp.SfmSettings(gpu=gpu, matcher=matcher, loop_closure=loop_closure and matcher == "sequential",
                              mapper=mapper, max_image_size=max_image_size)
    vocab = sp.ensure_vocab_tree(ROOT / "tools" / "colmap") if settings.loop_closure else None
    t = time.time()
    if not matched.exists():
        tmp = matched.with_suffix(".partial.db")
        tmp.unlink(missing_ok=True)
        sp.extract_and_match(pycolmap, tmp, images, sp.build_options(pycolmap, settings, vocab), matcher)
        tmp.replace(matched)
    report.data.setdefault("sfm_timing", {})[f"extract_match_{matcher}_s"] = round(time.time() - t, 1)
    # Global positioning starts from random positions: an unconverged solve is retried with other fixed
    # seeds, then the incremental mapper (slower, deterministic) maps the same matches.
    attempts = [(m, None) for m in [mapper]] if mapper != "global" else \
        [("global", seed) for seed in GLOBAL_SEEDS] + [("incremental", None)]
    report.data.pop("sfm_global_attempts", None)
    for n, (m, seed) in enumerate(attempts):
        nxt = attempt_name(*attempts[n + 1]) if n + 1 < len(attempts) else ""
        db = work / "colmap.db"
        shutil.copy2(matched, db)  # every mapper sees exactly the matched database
        t = time.time()
        opts = sp.build_options(pycolmap, sp.SfmSettings(gpu=gpu, matcher=matcher, loop_closure=False, mapper=m,
                                                         seed=seed or 1), None)
        models, positioning = sp.map_poses(pycolmap, db, images, sparse, opts, m, log)
        key = f"map_{m}_s" if seed in (None, GLOBAL_SEEDS[0]) else f"map_{m}_seed{seed}_s"
        report.data["sfm_timing"][key] = round(time.time() - t, 1)
        if m == "global":
            report.data.setdefault("sfm_global_attempts", []).append({"seed": seed, **(positioning or {})})
            report.data["sfm_global_positioning"] = positioning
            report.save()
            # A positioning solve that hit its iteration cap leaves poses that look plausible (every frame
            # registered, ~8.6k points) but trained into a diverged splat twice on the Kaggle smoke test.
            # Never train on them.
            if positioning is not None and not positioning["converged"]:
                if n + 1 < len(attempts):
                    print(f"sfm: global positioning (seed {seed}) ended {positioning['termination']} after "
                          f"{positioning['iterations']} iterations; retrying with {nxt}")
                    continue
                raise PipelineError(f"Global positioning ended {positioning['termination']} after "
                                    f"{positioning['iterations']} iterations; not training on unconverged poses. "
                                    "Re-run with --mapper incremental.")
        try:
            best = pick_model(models, total, report, log)
        except PipelineError:
            if n + 1 < len(attempts):
                print(f"sfm: {m} mapping failed its checks; retrying with {nxt}")
                continue
            raise
        ratio = report.data["sfm"]["registration_ratio"]
        report.data["sfm"]["mapper"] = m
        if seed is not None:
            report.data["sfm"]["global_seed"] = seed
        if ratio < checks.MIN_REGISTRATION and n + 1 < len(attempts):
            print(f"sfm: {m} mapping registered {ratio:.0%}; retrying with {nxt}")
            continue
        break
    sp.undistort(best, images, dataset)
    return dataset


# ---------------------------------------------------------------- train
def check_dataset(dataset: Path, report: Report) -> None:
    """Fail with a clear message if Brush would mis-read the undistorted COLMAP dataset.

    Brush 0.3 (brush-dataset/src/formats/colmap.rs, mod.rs) takes the first cameras.bin/.txt it finds
    anywhere in the folder, so sparse/ and sparse/0/ both work; it silently skips images it cannot find,
    and uses any single .ply in the folder as the initial splat.
    """
    cams = [p for p in dataset.rglob("cameras.*") if p.suffix in (".bin", ".txt")]
    if not cams:
        raise PipelineError(f"No COLMAP model in {dataset} (expected sparse/cameras.bin or sparse/0/cameras.bin). "
                            f"Re-run with --force so COLMAP undistortion runs again.")
    if len(cams) > 1:
        raise PipelineError(f"{len(cams)} COLMAP models in {dataset} ({[str(c.parent) for c in cams]}); Brush would pick "
                            "one at random. Re-run with --force.")
    images = list_images(dataset / "images")
    registered = report.data.get("sfm", {}).get("registered_images")
    if not images or (registered and len(images) < registered):
        raise PipelineError(f"{dataset / 'images'} has {len(images)} images but COLMAP registered {registered}; Brush "
                            "would silently train on fewer views. Re-run with --force.")
    stray = sorted(dataset.rglob("*.ply"))
    if stray:
        raise PipelineError(f"Found {[str(p) for p in stray]} inside the dataset; Brush would start from it instead of "
                            "the COLMAP points. Delete it (or re-run with --force).")


# Brush's default penalties are ~1e-9/1e-8, which let thousands of near-transparent splats pile up as
# floating fog. On the first classroom these values gave a cleaner room with 29% fewer splats; 1e-7/1e-6
# was too strong (155k splats, blurry). Tested on one scene only.
BRUSH_FLAGS = ["--opac-loss-weight", "1e-8", "--scale-loss-weight", "1e-7", "--max-splats", "1500000"]


def train_brush(dataset: Path, export: Path, steps: int, log: Path) -> None:
    # Flags checked against Brush v0.3.0 source (brush-cli, brush-process/src/config.rs). A positional source
    # runs headless; export_every == total_steps writes exactly one file, at the last step. A masks/ folder
    # next to images/ (see mask_people.py) makes Brush ignore the masked pixels.
    run([find_tool("brush_app"), str(dataset), "--total-steps", str(steps), "--export-path", str(export),
         "--export-every", str(steps), "--export-name", "splat.ply", *BRUSH_FLAGS], log, "Brush training")


def train_nerfstudio(dataset: Path, export: Path, steps: int, log: Path) -> None:
    """Nerfstudio splatfacto (gsplat). Needs a CUDA PyTorch env: Linux, or WSL2 on Windows."""
    runs = export.parent / "ns_runs"
    # image_undistorter writes sparse/ (not sparse/0) and images/ inside the dataset folder.
    run([find_tool("ns-train"), "splatfacto", "--data", str(dataset), "--output-dir", str(runs),
         "--max-num-iterations", str(steps), "--viewer.quit-on-train-completion", "True",
         "colmap", "--colmap-path", "sparse", "--images-path", "images"], log, "Nerfstudio training")
    configs = sorted(runs.rglob("config.yml"), key=lambda p: p.stat().st_mtime)
    if not configs:
        raise PipelineError(f"Nerfstudio wrote no config.yml under {runs}; see {log}")
    run([find_tool("ns-export"), "gaussian-splat", "--load-config", str(configs[-1]),
         "--output-dir", str(export)], log, "Nerfstudio export")


def train_gsplat(dataset: Path, export: Path, steps: int, log: Path, max_width: int = 1920,
                 max_splats: int = 1_500_000) -> None:
    """gsplat (CUDA PyTorch), MCMC + scale/anisotropy regularisation + antialiasing; see train_gsplat.py.
    Run as a child process so the GPU memory is returned before compression and publishing."""
    stats = export / "train_stats.json"
    try:
        run([sys.executable, str(Path(__file__).with_name("train_gsplat.py")), str(dataset), str(export / "splat.ply"),
             "--steps", str(steps), "--max-width", str(max_width), "--max-splats", str(max_splats),
             "--stats", str(stats)], log, "gsplat training")
    except PipelineError as e:
        info = json.loads(stats.read_text()) if stats.is_file() else {}
        if info.get("diverged"):
            raise PipelineError(f"gsplat training diverged and was stopped: {info['diverged']} (final loss "
                                f"{info.get('final_loss')}, minimum {info.get('min_loss')}). No splat was kept. "
                                "Usual cause: a bad camera solution; check report.json sfm / sfm_global_positioning, "
                                "or re-run with --mapper incremental.") from e
        raise


TRAINERS = {"brush": train_brush, "gsplat": train_gsplat, "nerfstudio": train_nerfstudio}
DEFAULT_TRAINER = "brush" if sys.platform == "win32" else "gsplat"

# --profile presets. Explicit flags win. fps x clip length sets the frame count; width sets SfM and training
# resolution; steps and max_splats set training time (the biggest stage).
PROFILES = {
    # preview keeps 3 fps: at 2 fps a 36 s clip (the smoke-test sample) falls under MIN_USABLE_FRAMES.
    "preview": {"fps": 3.0, "width": 1280, "steps": 7000, "max_splats": 750_000},
    "final": {"fps": 3.0, "width": 1920, "steps": 30000, "max_splats": 1_500_000},
}
DEFAULTS = {"fps": 3.0, "width": 1920, "steps": 30000, "max_splats": 1_500_000}


def resolve_params(args: argparse.Namespace) -> dict:
    """Profile values, then anything given explicitly on the command line."""
    params = dict(PROFILES[args.profile] if args.profile else DEFAULTS)
    for k in params:
        v = getattr(args, k, None)
        if v is not None:
            params[k] = v
    return params


def train_fingerprint(dataset: Path, trainer: str, steps: int, extra: dict | None = None) -> dict:
    """What a trained splat depends on. A splat is reused only if all of this is unchanged."""
    model = sorted(p for p in dataset.rglob("images.*") if p.suffix in (".bin", ".txt"))
    stat = model[0].stat() if model else None
    return {"trainer": trainer, "steps": steps, **(extra or {}),
            "flags": BRUSH_FLAGS if trainer == "brush" else [],
            "masks": len(list_images(dataset / "masks")),
            "model": str(model[0]) if model else None,
            "model_size": stat.st_size if stat else None, "model_mtime": stat.st_mtime if stat else None}


def reusable_splat(report: Report, want: dict, trainer: str) -> tuple[Path | None, str]:
    """The cached splat.ply if it may be reused, else (None, why not). Reused only when it was trained from
    the same inputs, is byte-identical to what was recorded, a gsplat run's train_stats.json shows a healthy
    final loss, and cleaning that very file succeeded. A diverged splat once passed the first two and was
    reused on a rerun."""
    done = report.data.get("train_output", {})
    ply = Path(done.get("ply", ""))
    if done.get("fingerprint") != want:
        return None, "inputs changed" if done else "no earlier training"
    if not ply.is_file() or ply.stat().st_size != done.get("bytes"):
        return None, "the trained file is missing or changed"
    if trainer == "gsplat":
        stats_file = ply.with_name("train_stats.json")
        try:
            stats = json.loads(stats_file.read_text())
        except (OSError, ValueError):
            return None, f"no readable {stats_file.name}"
        if stats.get("healthy") is not True:
            return None, (f"its training was not healthy (final loss {stats.get('final_loss')}, "
                          f"minimum {stats.get('min_loss')})")
    clean = report.data.get("clean_splat", {})
    if not (clean.get("ok") and clean.get("src") == str(ply)):
        return None, "cleaning it did not succeed"
    return ply, ""


def train(dataset: Path, work: Path, steps: int, trainer: str, report: Report, log: Path,
          max_width: int = 1920, max_splats: int = 1_500_000, force: bool = False) -> Path:
    export = work / f"splat_{trainer}"
    extra = {"max_width": max_width, "max_splats": max_splats} if trainer == "gsplat" else {}
    want = train_fingerprint(dataset, trainer, steps, extra)
    ply, why = reusable_splat(report, want, trainer)
    if ply and not force:
        print(f"train: reusing {ply} (same COLMAP model, trainer and steps; healthy loss; cleaned OK)")
        return ply
    if report.data.get("train_output"):
        print(f"train: not reusing the earlier splat ({'--force-train' if force else why}); training again")
    # Anything else in the export folder is stale (other steps, trainer run, or an interrupted run): never reuse it.
    report.data.pop("train_output", None)
    report.data.pop("clean_splat", None)
    report.data.pop("train_stats", None)
    shutil.rmtree(export, ignore_errors=True)
    export.mkdir(parents=True)
    check_dataset(dataset, report)
    if trainer == "gsplat":
        train_gsplat(dataset, export, steps, log, max_width, max_splats)
        stats = export / "train_stats.json"
        if stats.is_file():
            report.data["train_stats"] = {k: v for k, v in json.loads(stats.read_text()).items()
                                          if k not in ("config", "loss_history")}
    else:
        TRAINERS[trainer](dataset, export, steps, log)
    plys = sorted(export.rglob("*.ply"), key=lambda p: p.stat().st_mtime)
    if not plys:
        raise PipelineError(f"{trainer} finished but wrote no .ply into {export}. See {log}")
    ply = plys[-1]
    report.data["train_output"] = {"ply": str(ply), "bytes": ply.stat().st_size, "fingerprint": want}
    report.save()
    return ply


# ---------------------------------------------------------------- publish
def publish(web_splat: Path, title: str, report: Report, work: Path, sparse: Path | None = None) -> None:
    """Build the studio scene bundle (manifest, splat, navigation grid, start POI, quality report) in
    work/<name>/bundle/ from the COLMAP model. Copy that folder to apps/studio/public/scenes/<name>/ to open it."""
    if sparse is None:
        print("publish: no COLMAP model, so no scene bundle (the compressed splat is in web/)")
        return
    try:
        import scene_bundle
        report.data["bundle"] = scene_bundle.build(sparse, web_splat, work / "bundle", title)
    except Exception as e:  # noqa: BLE001 (a bundle failure must not lose the trained splat)
        report.check("bundle", False, f"scene bundle failed: {e}", "warn")
        return
    print(f"publish: studio bundle -> {work / 'bundle'}\n"
          f"  inspect: copy it to apps/studio/public/scenes/{work.name}/, run `npm run dev` in apps/studio, open\n"
          f"  http://localhost:5173/?scene=/scenes/{work.name}/manifest.json&edit=1")


# ---------------------------------------------------------------- environment
def _version(cmd: list[str], pattern: str = r"(\d+\.\d+(?:\.\d+)?)") -> str | None:
    import re
    import subprocess
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(pattern, out.stdout + out.stderr)
    return m.group(1) if m else None


def environment_info(trainer: str) -> dict:
    """GPU and tool versions for report.json, so timings can be compared between machines."""
    import platform
    import subprocess
    info: dict = {"platform": platform.platform(), "python": platform.python_version()}
    if shutil.which("nvidia-smi"):
        out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
                             capture_output=True, text=True).stdout.strip().splitlines()
        info["gpus"] = out
    versions: dict = {}
    ff = find_tool("ffmpeg", False)
    if ff:
        versions["ffmpeg"] = _version([ff, "-version"], r"ffmpeg version (\S+)")
    node = find_tool("node", False)
    if node:
        versions["node"] = _version([node, "--version"])
    versions["splat_transform"] = compress.installed_version()
    # Versions from package metadata, never by importing: torch and pycolmap must not share a process.
    for dist in ("pycolmap-cuda12", "pycolmap", "torch", "gsplat", "numpy", "opencv-python-headless", "ultralytics"):
        v = module_version(dist)
        if v:
            versions[dist] = v
    info["versions"] = versions
    info["trainer"] = trainer
    return info


# ---------------------------------------------------------------- commands
def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def cmd_doctor(trainer: str, gpu: bool, sfm_backend: str = "colmap") -> int:
    print(f"Dependency check (trainer={trainer}, sfm={sfm_backend}):")
    return 0 if preflight.print_doctor(preflight.doctor(trainer, gpu, sfm_backend)) else 1


def cmd_approve(work: Path, note: str) -> int:
    report = Report.load(work)
    if report.data.get("status") != AWAITING_INSPECTION:
        print(f"Cannot approve: status is {report.data.get('status')!r}, expected {AWAITING_INSPECTION!r}.")
        return 1
    report.data["status"] = INSPECTED_OK
    report.data["inspection"] = {"note": note, "at": now()}
    report.save()
    print(f"{work}: marked {INSPECTED_OK}.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", nargs="?", type=Path, help="video file, or a folder of photos")
    ap.add_argument("--out", type=Path, default=ROOT / "work" / "scene")
    ap.add_argument("--profile", choices=sorted(PROFILES), default=None,
                    help="preview: <=720p, 7k steps (fast check); final: 1080p, 30k steps. Flags below override it.")
    ap.add_argument("--fps", type=float, default=None, help="frames sampled per second of video (default 3)")
    # 1920 = full 1080p width and Brush's own --max-resolution, so training sees every pixel filmed.
    ap.add_argument("--width", type=int, default=None, help="max frame width in px (default 1920)")
    ap.add_argument("--matcher", choices=["sequential", "exhaustive"], default=None,
                    help="default: sequential (+ loop closure) for video, exhaustive for photos")
    ap.add_argument("--exhaustive", action="store_true", help="match every frame pair (slow, O(n^2)); same as --matcher exhaustive")
    ap.add_argument("--no-loop-closure", action="store_true", help="sequential matching without vocabulary-tree loop detection")
    ap.add_argument("--sfm", choices=["auto", "colmap", "pycolmap"], default="auto",
                    help="auto: the colmap executable if found, else pycolmap (pip install pycolmap-cuda12)")
    ap.add_argument("--mapper", choices=["global", "incremental"], default=None,
                    help="default: global (GLOMAP, falls back to incremental) when available, else incremental")
    ap.add_argument("--steps", type=int, default=None, help="Gaussian-splat training steps (default 30000)")
    ap.add_argument("--max-splats", type=int, default=None, help="cap on the splat count, gsplat only (default 1.5M)")
    ap.add_argument("--trainer", choices=sorted(TRAINERS), default=DEFAULT_TRAINER,
                    help="brush: single exe, any WebGPU GPU (Windows default). gsplat: CUDA PyTorch (Linux default). "
                         "nerfstudio: CUDA PyTorch")
    ap.add_argument("--title", default="Namma Space")
    ap.add_argument("--max-mb", type=float, default=compress.DEFAULT_MAX_MB, help="size budget for the web splat")
    ap.add_argument("--cpu", action="store_true", help="disable COLMAP GPU (use with the no-CUDA build)")
    ap.add_argument("--mask-people", action="store_true",
                    help="mask people out of training frames (YOLO segmentation) so walkers leave no ghosts")
    ap.add_argument("--force", action="store_true", help="delete previous outputs in --out and start over")
    ap.add_argument("--force-train", action="store_true",
                    help="retrain even if a healthy, cleaned splat from the same inputs exists (keeps frames and poses)")
    ap.add_argument("--sog-on-cpu", action="store_true",
                    help="with no WebGPU adapter, encode SOG on the CPU (30+ min on Kaggle) instead of writing "
                         ".compressed.ply")
    ap.add_argument("--check", action="store_true", help="validate dependencies and input, then stop")
    ap.add_argument("--doctor", action="store_true", help="check dependencies, then stop")
    ap.add_argument("--approve", type=Path, metavar="WORKDIR", help="mark a run inspected_ok after viewing it")
    ap.add_argument("--note", default="", help="inspection note stored with --approve")
    a = ap.parse_args()

    params = resolve_params(a)
    backend = a.sfm if a.sfm != "auto" else ("colmap" if find_tool("colmap", False) else "pycolmap")
    if a.doctor:
        return cmd_doctor(a.trainer, not a.cpu, backend)
    if a.approve:
        if not a.note:
            print("--approve needs --note describing what you checked in the viewer.")
            return 2
        return cmd_approve(a.approve, a.note)
    if not a.input:
        ap.error("input is required (or use --doctor / --approve)")

    work = a.out
    if a.force and work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True, exist_ok=True)
    (work / "logs").mkdir(exist_ok=True)
    log = work / "logs" / "pipeline.log"
    report = Report.load(work)
    # --check only validates: it records its result under last_check and never touches the run's status.
    if not a.check:
        report.data.update(status=FAILED, input=str(a.input), trainer=a.trainer, profile=a.profile,
                           params={**params, "sfm": backend}, started=now())
        report.data["environment"] = environment_info(a.trainer)
        report.save()
    started = time.time()

    try:
        print("== dependencies")
        if not preflight.print_doctor(preflight.doctor(a.trainer, not a.cpu, backend)):
            raise PipelineError("Missing dependencies listed above. See docs/TRAINING.md.")

        print("== input validation")
        is_dir = a.input.is_dir()
        if not a.input.exists():
            raise PipelineError(f"Input not found: {a.input}")
        if is_dir:
            info, issues = preflight.validate_photos(a.input, work)
        else:
            info, issues = preflight.validate_video(a.input, work, params["fps"])
        report.data["input_info"] = info
        for k in [k for k in report.data.get("checks", {}) if k.startswith("input:")]:
            del report.data["checks"][k]  # drop stale input checks from a previous run
        if not a.check:
            report.data.pop("error", None)
        if not issues:
            print("  [PASS] input looks usable")
        for n, i in enumerate(issues):
            report.check(f"input:{n}", False, i.message, i.level)  # prints and records each issue
        if any(i.level == "error" for i in issues):
            raise PipelineError("Input failed validation (see above). Fix the capture, not the thresholds.")
        if a.check:
            report.data["last_check"] = {"ok": True, "input": str(a.input), "at": now()}
            report.save()
            print("\nOK: dependencies and input look usable. Nothing was processed (--check).")
            return 0

        matcher = "exhaustive" if a.exhaustive else (a.matcher or ("exhaustive" if is_dir else "sequential"))
        mapper = a.mapper or "global"  # sfm() falls back to incremental where there is no global mapper
        sfm_args = dict(mapper=mapper, backend=backend, loop_closure=not a.no_loop_closure, max_image_size=params["width"])
        with Timer() as t:
            if is_dir:
                n = copy_photos(a.input, work / "frames")
            else:
                n = extract_frames(a.input, work, params["fps"], params["width"], log)
        report.stage("frames", t.seconds, kept=n)
        min_frames = preflight.MIN_PHOTOS if is_dir else MIN_USABLE_FRAMES
        if n < min_frames:
            raise PipelineError(f"Only {n} usable frames (need {min_frames}). Film longer or raise --fps.")

        with Timer() as t:
            auto = a.matcher is None and not a.exhaustive and not is_dir
            try:
                dataset = sfm(work, matcher, not a.cpu, report, log, **sfm_args)
            except PipelineError:
                # Only a low registration ratio is worth an exhaustive retry; anything else (no model,
                # too few points) fails the same way again, and there is no dataset to fall through to.
                ratio = report.data.get("sfm", {}).get("registration_ratio")
                if not (auto and ratio is not None and ratio < checks.MIN_REGISTRATION):
                    raise
                dataset = work / "dataset"
            ratio = report.data.get("sfm", {}).get("registration_ratio")
            if auto and ratio is not None and ratio < checks.MIN_REGISTRATION:
                # Sequential matching only links neighbouring frames; big rooms with loops need all pairs.
                print(f"sfm: sequential matching registered {ratio:.0%}; retrying with exhaustive matching")
                report.data["sfm_sequential_ratio"] = ratio
                shutil.rmtree(dataset, ignore_errors=True)
                shutil.rmtree(work / "sparse", ignore_errors=True)
                dataset = sfm(work, "exhaustive", not a.cpu, report, log, **sfm_args)
        sfm_info = report.data.get("sfm", {})
        report.stage("sfm", t.seconds, backend=backend, frames=sfm_info.get("frames_total"),
                     registered=sfm_info.get("registered_images"), mapper=sfm_info.get("mapper", mapper))

        print("== coverage")
        sparse = dataset / "sparse" / "0" if (dataset / "sparse" / "0").exists() else dataset / "sparse"
        try:
            import room_coverage  # needs opencv + scipy; imported here so --doctor/--check stay light
            cov = room_coverage.analyse(sparse, work / "coverage")
            report.data["coverage"] = {k: v for k, v in cov.items() if k != "gaps"} | {"gaps": cov["gaps"][:15]}
            report.check("coverage:room_closed", cov["verified"],
                         "every face of the room observed" if cov["verified"]
                         else f"gaps remain; what to film is in {work / 'coverage' / 'RECAPTURE.txt'}", "warn")
        except Exception as e:  # coverage is advice, never a reason to lose a run
            report.check("coverage:room_closed", False, f"coverage could not run: {e}", "warn")

        if a.mask_people:
            with Timer() as t:
                masked = work / "dataset_masked"
                if len(list_images(masked / "masks")) == len(list_images(dataset / "images")) > 0:
                    print("mask_people: already done")
                else:
                    try:
                        import mask_people
                    except ImportError as e:
                        raise PipelineError(f"--mask-people needs ultralytics: pip install ultralytics ({e})") from e
                    shutil.rmtree(masked, ignore_errors=True)
                    report.data["mask_people"] = mask_people.main(dataset, masked)
                dataset = masked
            report.stage("mask_people", t.seconds)

        with Timer() as t:
            splat = train(dataset, work, params["steps"], a.trainer, report, log, params["width"], params["max_splats"],
                          force=a.force_train)
        report.stage("train", t.seconds, steps=params["steps"])

        print("== clean splat")
        import clean_splat
        with Timer() as t:
            cleaned = splat.with_name(splat.stem + "_clean.ply")
            geometry = {}
            try:
                geometry = clean_splat.scene_geometry(sparse, work / "coverage" / "sparse_txt")
            except Exception as e:  # no poses: skip only the floater and room-box passes
                print(f"clean splat: no scene geometry ({e}); floaters and outside splats kept")
            try:
                stats = clean_splat.clean(splat, cleaned, **geometry)
            except clean_splat.CleanRefused as e:
                report.data["clean_splat"] = {"ok": False, "src": str(splat), "error": str(e), **e.stats}
                raise PipelineError(str(e)) from e
            report.data["clean_splat"] = {"ok": True, "src": str(splat), **stats}
            report.save()
            splat = cleaned
        report.stage("clean", t.seconds)

        print("== output checks")
        if not checks.check_splat(report, splat):
            raise PipelineError(f"Splat output failed checks: {report.blocking_failures()}. See report.json.")

        print("== world frame")
        # The viewer applies no worldFromReconstruction transform, so the published splat is moved into the
        # bundle's world frame (levelled, metres, floor at y=0) here and the manifest says identity.
        publish_sparse = None
        with Timer() as t:
            try:
                import scene_bundle
                al = scene_bundle.world_alignment(sparse, work / "coverage" / "sparse_txt_world")
                world = work / "world" / "splat_world.ply"
                world.parent.mkdir(exist_ok=True)
                scene_bundle.bake_ply(splat, world, al["s"], al["R"], al["t"])
                report.data["world_frame"] = {"file": str(world), "metres_per_unit": round(al["s"], 4),
                                              "world_from_reconstruction": scene_bundle.world_matrix(al).round(6).tolist()}
                splat, publish_sparse = world, sparse
            except Exception as e:  # noqa: BLE001 (no alignment: still compress, but publish no bundle)
                report.check("world_frame", False, f"could not align the splat to the world frame: {e}; "
                             "no scene bundle", "warn")
        report.stage("world_frame", t.seconds)

        print("== compress for the web")
        t_compress = time.time()
        try:
            web_splat = compress.compress(splat, work, report, log, a.max_mb, sog_on_cpu=a.sog_on_cpu)
        finally:
            ws = report.data.get("web_splat", {})
            report.stage("compress", time.time() - t_compress, mb=ws.get("mb"), format=ws.get("format"),
                         encoder=ws.get("encoder"))

        with Timer() as t:
            publish(web_splat, a.title, report, work, publish_sparse)
        report.stage("publish", t.seconds)
        report.data["total_seconds"] = round(time.time() - started, 1)
        report.data["status"] = AWAITING_INSPECTION
        report.save()
        print(f"\nDONE, NOT YET VERIFIED. Output exists and passes automated checks:\n  {splat} (source)\n"
              f"  {web_splat} (web, {report.data['web_splat']['mb']} MB)\n  {work / 'bundle'} (studio scene bundle)\n"
              f"Next: copy the bundle to apps/studio/public/scenes/{work.name}/, run `npm run dev` in apps/studio, open\n"
              f"  http://localhost:5173/?scene=/scenes/{work.name}/manifest.json, walk the whole room, then\n"
              f"  python pipeline/run_pipeline.py --approve {work} --note \"what you checked\"")
        return 0
    except Exception as e:  # noqa: BLE001 (a crash, not only a PipelineError, must land in report.json)
        import traceback
        message = str(e) if isinstance(e, PipelineError) else f"{type(e).__name__}: {e}"
        if not isinstance(e, PipelineError):
            traceback.print_exc()
            with open(log, "a", encoding="utf-8") as fh:
                fh.write(traceback.format_exc())
        if a.check:
            report.data["last_check"] = {"ok": False, "input": str(a.input), "at": now(), "error": message}
        else:
            report.data["status"] = FAILED
            report.data["error"] = message
            report.data["total_seconds"] = round(time.time() - started, 1)
        report.save()
        print(f"\nFAILED: {message}\nReport: {report.path}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
