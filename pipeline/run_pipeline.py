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
  publish   copy the splat and scene.json into viewer/public/models

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
import preflight  # noqa: E402
from common import (AWAITING_INSPECTION, FAILED, INSPECTED_OK, ROOT, PipelineError, Report, Timer,  # noqa: E402
                    find_tool, run)

MIN_USABLE_FRAMES = 80


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


def drop_blurry(frames: Path, drop: float = 0.15) -> int:
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


# ---------------------------------------------------------------- sfm
def sfm(work: Path, matcher: str, gpu: bool, report: Report, log: Path) -> Path:
    colmap = find_tool("colmap")
    db, images, sparse, dataset = work / "colmap.db", work / "frames", work / "sparse", work / "dataset"
    total = len(list(images.glob("*.jpg"))) + len(list(images.glob("*.png")))
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
    if not checks.check_sfm(report, best_stats, total, len(models) - 1):
        raise PipelineError("SfM checks failed (see report.json). Not training on a bad camera solution.")
    run([colmap, "image_undistorter", "--image_path", str(images), "--input_path", str(best),
         "--output_path", str(dataset), "--output_type", "COLMAP"], log, "COLMAP undistortion")
    return dataset


# ---------------------------------------------------------------- train
def train_brush(dataset: Path, export: Path, steps: int, log: Path) -> None:
    run([find_tool("brush_app"), str(dataset), "--total-steps", str(steps),
         "--export-path", str(export), "--export-every", str(steps)], log, "Brush training")


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


def train(dataset: Path, work: Path, steps: int, trainer: str, log: Path) -> Path:
    export = work / f"splat_{trainer}"
    plys = sorted(export.glob("*.ply")) if export.exists() else []
    if plys:
        print("train: already done")
        return plys[-1]
    export.mkdir(parents=True, exist_ok=True)
    TRAINERS[trainer](dataset, export, steps, log)
    plys = sorted(export.glob("*.ply"), key=lambda p: p.stat().st_mtime)
    if not plys:
        raise PipelineError(f"{trainer} finished but wrote no .ply into {export}. See {log}")
    return plys[-1]


# ---------------------------------------------------------------- publish
def publish(splat: Path, title: str, report: Report) -> None:
    models = ROOT / "viewer" / "public" / "models"
    models.mkdir(parents=True, exist_ok=True)
    shutil.copy2(splat, models / "scene.ply")
    centre = report.data.get("splat", {}).get("centre", [0, 0, 0])
    cfg = {"title": title, "splat": "models/scene.ply",
           "spawn": [0, 0, 0], "spawnYaw": 0, "eyeHeight": 1.6, "rotation": [3.141592653589793, 0, 0], "scale": 1,
           "_note": f"AUTO-GENERATED, UNALIGNED. Model centre {centre}. Set spawn/scale/rotation by hand; see docs/SOP.md."}
    (models / "scene.json").write_text(json.dumps(cfg, indent=2))
    print(f"publish: {splat.name} -> viewer/public/models/scene.ply (scene.json needs manual alignment)")


# ---------------------------------------------------------------- commands
def cmd_doctor(trainer: str, gpu: bool) -> int:
    print(f"Dependency check (trainer={trainer}):")
    return 0 if preflight.print_doctor(preflight.doctor(trainer, gpu)) else 1


def cmd_approve(work: Path, note: str) -> int:
    report = Report.load(work)
    if report.data.get("status") != AWAITING_INSPECTION:
        print(f"Cannot approve: status is {report.data.get('status')!r}, expected {AWAITING_INSPECTION!r}.")
        return 1
    report.data["status"] = INSPECTED_OK
    report.data["inspection"] = {"note": note, "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
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
    ap.add_argument("--cpu", action="store_true", help="disable COLMAP GPU (use with the no-CUDA build)")
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
        info, issues = (preflight.validate_photos if is_dir else preflight.validate_video)(a.input, work)
        report.data["input_info"] = info
        for k in [k for k in report.data.get("checks", {}) if k.startswith("input:")]:
            del report.data["checks"][k]  # drop stale input checks from a previous run
        report.data.pop("error", None)
        if not issues:
            print("  [PASS] input looks usable")
        for n, i in enumerate(issues):
            report.check(f"input:{n}", False, i.message, i.level)  # prints and records each issue
        if any(i.level == "error" for i in issues):
            raise PipelineError("Input failed validation (see above). Fix the capture, not the thresholds.")
        if a.check:
            print("\nOK: dependencies and input look usable. Nothing was processed (--check).")
            return 0

        matcher = a.matcher or ("exhaustive" if is_dir else "sequential")
        with Timer() as t:
            if is_dir:
                shutil.copytree(a.input, work / "frames", dirs_exist_ok=True)
                n = len(list((work / "frames").iterdir()))
            else:
                n = extract_frames(a.input, work, a.fps, a.width, log)
        report.stage("frames", t.seconds, kept=n)
        if n < MIN_USABLE_FRAMES:
            raise PipelineError(f"Only {n} usable frames (need {MIN_USABLE_FRAMES}). Film longer or raise --fps.")

        with Timer() as t:
            dataset = sfm(work, matcher, not a.cpu, report, log)
        report.stage("sfm", t.seconds)

        with Timer() as t:
            splat = train(dataset, work, a.steps, a.trainer, log)
        report.stage("train", t.seconds, steps=a.steps)

        print("== output checks")
        if not checks.check_splat(report, splat):
            raise PipelineError(f"Splat output failed checks: {report.blocking_failures()}. See report.json.")

        publish(splat, a.title, report)
        report.data["status"] = AWAITING_INSPECTION
        report.save()
        print(f"\nDONE, NOT YET VERIFIED. Output exists and passes automated checks: {splat}\n"
              "Next: align scene.json, run `npm run dev` in viewer/, walk the whole room, then\n"
              f"  python pipeline/run_pipeline.py --approve {work} --note \"what you checked\"")
        return 0
    except PipelineError as e:
        report.data["status"] = FAILED
        report.data["error"] = str(e)
        report.save()
        print(f"\nFAILED: {e}\nReport: {report.path}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
