"""Smartphone video (or photos) -> Gaussian splat for the Namma Space viewer.

    python pipeline/run_pipeline.py --doctor                       # check dependencies
    python pipeline/run_pipeline.py capture.mp4 --out work/room1 --check   # validate input only
    python pipeline/run_pipeline.py capture.mp4 --out work/room1           # full run
    python pipeline/run_pipeline.py --approve work/room1 --note "walked it, no major holes"

Stages (each is skipped if its output exists; use --force to redo):
  validate  input checks (resolution, duration, disk) -> report.json
  frames    ffmpeg sampling + blurry-frame removal
  sfm       COLMAP features, matching, mapping, undistortion + registration checks
  train     Brush (default) or Nerfstudio splatfacto + splat file checks
  compress  .ply -> .sog (or .spz) under --max-mb with splat-transform; always re-run
  publish   compressed splat + scene.json into work/<name>/web/ and viewer/dev-assets/models/ (dev server only).
            The raw .ply is never copied into the viewer.

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
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import checks  # noqa: E402
import compress  # noqa: E402
import preflight  # noqa: E402
from common import (AWAITING_INSPECTION, BLUR_DROP, FAILED, INSPECTED_OK, MIN_USABLE_FRAMES, ROOT,  # noqa: E402
                    PipelineError, Report, Timer, find_tool, list_images, run)


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


def drop_blurry(frames: Path, drop: float = BLUR_DROP) -> int:
    """Remove the blurriest fraction by variance of the Laplacian; returns the number kept."""
    import cv2

    scores = []
    for f in sorted(frames.glob("*.jpg")):
        g = cv2.imread(str(f), cv2.IMREAD_GRAYSCALE)
        if g is None:
            f.unlink()
            continue
        scores.append((cv2.Laplacian(g, cv2.CV_64F).var(), f))
    scores.sort(key=lambda s: s[0])
    cut = int(len(scores) * drop)
    for _, f in scores[:cut]:
        f.unlink()
    kept = len(scores) - cut
    print(f"frames: kept {kept}/{len(scores)} (dropped {cut} blurriest)")
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
def sfm(work: Path, matcher: str, gpu: bool, report: Report, log: Path) -> Path:
    colmap = find_tool("colmap")
    db, images, sparse, dataset = work / "colmap.db", work / "frames", work / "sparse", work / "dataset"
    total = len(list_images(images))
    if (dataset / "sparse").exists():
        print("sfm: already done")
        return dataset
    use_gpu = "1" if gpu else "0"
    if db.exists():
        db.unlink()  # a half-finished database from a failed run poisons matching
    run([colmap, "feature_extractor", "--database_path", str(db), "--image_path", str(images),
         "--ImageReader.single_camera", "1", "--ImageReader.camera_model", "OPENCV",
         "--FeatureExtraction.use_gpu", use_gpu], log, "COLMAP feature extraction")
    # sequential matching suits walk-through video; exhaustive suits unordered photo sets.
    run([colmap, f"{matcher}_matcher", "--database_path", str(db), "--FeatureMatching.use_gpu", use_gpu],
        log, "COLMAP matching")
    shutil.rmtree(sparse, ignore_errors=True)
    sparse.mkdir()
    run([colmap, "mapper", "--database_path", str(db), "--image_path", str(images), "--output_path", str(sparse)],
        log, "COLMAP mapping")
    models = sorted(p for p in sparse.iterdir() if p.is_dir())
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
        report.data["sfm"]["ignored_fragment_images"] = scraps  # tiny leftover models, not a split of the room
        report.save()
    run([colmap, "image_undistorter", "--image_path", str(images), "--input_path", str(best),
         "--output_path", str(dataset), "--output_type", "COLMAP"], log, "COLMAP undistortion")
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


TRAINERS = {"brush": train_brush, "nerfstudio": train_nerfstudio}


def train_fingerprint(dataset: Path, trainer: str, steps: int) -> dict:
    """What a trained splat depends on. A splat is reused only if all of this is unchanged."""
    model = sorted(p for p in dataset.rglob("images.*") if p.suffix in (".bin", ".txt"))
    stat = model[0].stat() if model else None
    return {"trainer": trainer, "steps": steps,
            "flags": BRUSH_FLAGS if trainer == "brush" else [],
            "masks": len(list_images(dataset / "masks")),
            "model": str(model[0]) if model else None,
            "model_size": stat.st_size if stat else None, "model_mtime": stat.st_mtime if stat else None}


def train(dataset: Path, work: Path, steps: int, trainer: str, report: Report, log: Path) -> Path:
    export = work / f"splat_{trainer}"
    want = train_fingerprint(dataset, trainer, steps)
    done = report.data.get("train_output", {})
    if done.get("fingerprint") == want and Path(done.get("ply", "")).is_file() \
            and Path(done["ply"]).stat().st_size == done.get("bytes"):
        print(f"train: reusing {done['ply']} (same COLMAP model, trainer and steps)")
        return Path(done["ply"])
    # Anything else in the export folder is stale (other steps, trainer run, or an interrupted run): never reuse it.
    report.data.pop("train_output", None)
    shutil.rmtree(export, ignore_errors=True)
    export.mkdir(parents=True)
    check_dataset(dataset, report)
    TRAINERS[trainer](dataset, export, steps, log)
    plys = sorted(export.rglob("*.ply"), key=lambda p: p.stat().st_mtime)
    if not plys:
        raise PipelineError(f"{trainer} finished but wrote no .ply into {export}. See {log}")
    ply = plys[-1]
    report.data["train_output"] = {"ply": str(ply), "bytes": ply.stat().st_size, "fingerprint": want}
    report.save()
    return ply


# ---------------------------------------------------------------- publish
DEV_MODELS = ROOT / "viewer" / "dev-assets" / "models"  # git-ignored; served by `npm run dev` only


def publish(web_splat: Path, title: str, report: Report, work: Path, sparse: Path | None = None) -> None:
    """Write scene.json next to the compressed splat and copy both to the dev server for inspection.

    With the COLMAP model (`sparse`) the scene is aligned automatically from the camera poses.

    Production never reads these: viewer/public/models/scene.json points at the uploaded copy on external storage.
    """
    centre = report.data.get("splat", {}).get("centre", [0, 0, 0])
    cfg = {"title": title, "splat": f"dev-assets/models/{web_splat.name}",
           "spawn": [0, 0, 0], "spawnYaw": 0, "eyeHeight": 1.6, "rotation": [3.141592653589793, 0, 0], "scale": 1,
           "_note": f"AUTO-GENERATED, UNALIGNED. Model centre {centre}. Set spawn/scale/rotation by hand; see docs/SOP.md."}
    if sparse is not None:
        try:
            import room_coverage
            _, _, cams, axes = room_coverage.load_model(sparse, work / "coverage" / "sparse_txt")
            align = room_coverage.viewer_alignment(cams, axes)
            cfg.update({k: align[k] for k in ("rotation", "spawn", "spawnYaw", "eyeHeight", "bounds", "walkPath", "walkRadius")})
            cfg["_note"] = ("AUTO-ALIGNED from camera poses: floor levelled, spawn at a real camera position, bounds "
                            "around the walked path. Scale is NOT metric (scale 1 = COLMAP units).")
        except Exception as e:
            print(f"publish: auto-alignment failed ({e}); scene.json left unaligned")
        # Bundle for the studio viewer: metric (estimated) scale and a navigation grid for collision.
        try:
            import scene_bundle
            report.data["bundle"] = scene_bundle.build(sparse, web_splat, work / "bundle", title)
            print(f"publish: studio bundle -> {work / 'bundle'} (copy to public/scenes/<name>/ in the studio app)")
        except Exception as e:
            print(f"publish: studio bundle failed ({e})")
    (web_splat.parent / "scene.json").write_text(json.dumps(cfg, indent=2))
    shutil.rmtree(DEV_MODELS, ignore_errors=True)
    DEV_MODELS.mkdir(parents=True)
    shutil.copy2(web_splat, DEV_MODELS / web_splat.name)
    shutil.copy2(web_splat.parent / "scene.json", DEV_MODELS / "scene.json")
    aligned = "auto-aligned" if "bounds" in cfg else "needs manual alignment"
    print(f"publish: {web_splat} -> viewer/dev-assets/models/ (scene.json {aligned})\n"
          f"  inspect: cd viewer; npm run dev  ->  http://localhost:5173/?scene=dev-assets/models/scene.json")


# ---------------------------------------------------------------- commands
def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def cmd_doctor(trainer: str, gpu: bool) -> int:
    print(f"Dependency check (trainer={trainer}):")
    return 0 if preflight.print_doctor(preflight.doctor(trainer, gpu)) else 1


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
    ap.add_argument("--fps", type=float, default=3.0, help="frames sampled per second of video")
    ap.add_argument("--width", type=int, default=1600, help="max frame width in px")
    ap.add_argument("--matcher", choices=["sequential", "exhaustive"], default=None,
                    help="default: sequential for video, exhaustive for photos")
    ap.add_argument("--steps", type=int, default=30000, help="Gaussian-splat training steps")
    ap.add_argument("--trainer", choices=sorted(TRAINERS), default="brush",
                    help="brush: single exe, any WebGPU GPU. nerfstudio: needs CUDA PyTorch (Linux/WSL2)")
    ap.add_argument("--title", default="Namma Space")
    ap.add_argument("--max-mb", type=float, default=compress.DEFAULT_MAX_MB, help="size budget for the web splat")
    ap.add_argument("--cpu", action="store_true", help="disable COLMAP GPU (use with the no-CUDA build)")
    ap.add_argument("--mask-people", action="store_true",
                    help="mask people out of training frames (YOLO segmentation) so walkers leave no ghosts")
    ap.add_argument("--force", action="store_true", help="delete previous outputs in --out and start over")
    ap.add_argument("--check", action="store_true", help="validate dependencies and input, then stop")
    ap.add_argument("--doctor", action="store_true", help="check dependencies, then stop")
    ap.add_argument("--approve", type=Path, metavar="WORKDIR", help="mark a run inspected_ok after viewing it")
    ap.add_argument("--note", default="", help="inspection note stored with --approve")
    a = ap.parse_args()

    if a.doctor:
        return cmd_doctor(a.trainer, not a.cpu)
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
        report.data.update(status=FAILED, input=str(a.input), trainer=a.trainer,
                           params={"fps": a.fps, "width": a.width, "steps": a.steps})
        report.save()

    try:
        print("== dependencies")
        if not preflight.print_doctor(preflight.doctor(a.trainer, not a.cpu)):
            raise PipelineError("Missing dependencies listed above. See docs/TRAINING.md.")

        print("== input validation")
        is_dir = a.input.is_dir()
        if not a.input.exists():
            raise PipelineError(f"Input not found: {a.input}")
        if is_dir:
            info, issues = preflight.validate_photos(a.input, work)
        else:
            info, issues = preflight.validate_video(a.input, work, a.fps)
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

        matcher = a.matcher or ("exhaustive" if is_dir else "sequential")
        with Timer() as t:
            if is_dir:
                n = copy_photos(a.input, work / "frames")
            else:
                n = extract_frames(a.input, work, a.fps, a.width, log)
        report.stage("frames", t.seconds, kept=n)
        min_frames = preflight.MIN_PHOTOS if is_dir else MIN_USABLE_FRAMES
        if n < min_frames:
            raise PipelineError(f"Only {n} usable frames (need {min_frames}). Film longer or raise --fps.")

        with Timer() as t:
            auto = a.matcher is None and not is_dir
            try:
                dataset = sfm(work, matcher, not a.cpu, report, log)
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
                dataset = sfm(work, "exhaustive", not a.cpu, report, log)
        report.stage("sfm", t.seconds)

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
            splat = train(dataset, work, a.steps, a.trainer, report, log)
        report.stage("train", t.seconds, steps=a.steps)

        print("== clean splat")
        import clean_splat
        with Timer() as t:
            cleaned = splat.with_name(splat.stem + "_clean.ply")
            cams, radius = None, 0.0
            try:
                cams, radius = clean_splat.camera_path(sparse, work / "coverage" / "sparse_txt")
            except Exception as e:  # no poses: skip only the floater pass
                print(f"clean splat: no camera path ({e}); floaters kept")
            report.data["clean_splat"] = clean_splat.clean(splat, cleaned, cameras=cams, camera_radius=radius)
            splat = cleaned
        report.stage("clean", t.seconds)

        print("== output checks")
        if not checks.check_splat(report, splat):
            raise PipelineError(f"Splat output failed checks: {report.blocking_failures()}. See report.json.")

        print("== compress for the web")
        with Timer() as t:
            web_splat = compress.compress(splat, work, report, log, a.max_mb)
        report.stage("compress", t.seconds, mb=report.data["web_splat"]["mb"])

        publish(web_splat, a.title, report, work, sparse)
        report.data["status"] = AWAITING_INSPECTION
        report.save()
        print(f"\nDONE, NOT YET VERIFIED. Output exists and passes automated checks:\n  {splat} (source)\n"
              f"  {web_splat} (web, {report.data['web_splat']['mb']} MB)\n"
              "Next: check viewer/dev-assets/models/scene.json, run `npm run dev` in viewer/, open\n"
              "  http://localhost:5173/?scene=dev-assets/models/scene.json, walk the whole room, then\n"
              f"  python pipeline/run_pipeline.py --approve {work} --note \"what you checked\"")
        return 0
    except PipelineError as e:
        if a.check:
            report.data["last_check"] = {"ok": False, "input": str(a.input), "at": now(), "error": str(e)}
        else:
            report.data["status"] = FAILED
            report.data["error"] = str(e)
        report.save()
        print(f"\nFAILED: {e}\nReport: {report.path}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
