"""Smartphone video -> Gaussian splat for the Namma Space viewer.

    python pipeline/run_pipeline.py capture.mp4 --out work/home --steps 30000

Stages (each is skipped if its output already exists, so a failed run resumes):
  1. frames   ffmpeg: sample the video, keep the sharpest frame per window
  2. sfm      COLMAP: features -> matches -> sparse reconstruction -> undistort
  3. train    Brush (default) or Nerfstudio splatfacto: train a 3D Gaussian Splat from the COLMAP model
  4. publish  copy the final splat and a scene.json into viewer/public/models

Tools are looked up in ./tools (see scripts/setup_tools.ps1) and then on PATH.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"


def find_tool(name: str) -> str:
    exe = name + (".exe" if sys.platform == "win32" else "")
    for p in TOOLS.rglob(exe):
        return str(p)
    found = shutil.which(name)
    if found:
        return found
    sys.exit(f"'{name}' not found. Run scripts/setup_tools.ps1 or add it to PATH.")


def run(cmd: list[str]) -> None:
    print("\n$", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def extract_frames(video: Path, out: Path, fps: float, width: int) -> None:
    frames = out / "frames"
    if frames.exists() and any(frames.glob("*.jpg")):
        print("frames: already extracted")
        return
    frames.mkdir(parents=True, exist_ok=True)
    # Blur is the main cause of failed SfM on handheld video, so blurry frames are dropped afterwards.
    vf = f"fps={fps},scale={width}:-2"
    run([find_tool("ffmpeg"), "-y", "-i", str(video), "-vf", vf, "-qscale:v", "2", str(frames / "%05d.jpg")])
    drop_blurry(frames)


def drop_blurry(frames: Path, keep: float = 0.85) -> None:
    """Remove the blurriest (1-keep) fraction by variance of the Laplacian."""
    import cv2

    scores = []
    for f in sorted(frames.glob("*.jpg")):
        g = cv2.imread(str(f), cv2.IMREAD_GRAYSCALE)
        scores.append((cv2.Laplacian(g, cv2.CV_64F).var(), f))
    scores.sort(key=lambda s: s[0])
    cut = int(len(scores) * (1 - keep))
    for _, f in scores[:cut]:
        f.unlink()
    print(f"frames: kept {len(scores) - cut}/{len(scores)} (dropped {cut} blurriest)")


def sfm(out: Path, matcher: str, gpu: bool) -> Path:
    colmap = find_tool("colmap")
    db, images, sparse = out / "colmap.db", out / "frames", out / "sparse"
    dense = out / "dataset"
    if (dense / "sparse").exists():
        print("sfm: already done")
        return dense
    use_gpu = "1" if gpu else "0"
    run([colmap, "feature_extractor", "--database_path", str(db), "--image_path", str(images),
         "--ImageReader.single_camera", "1", "--ImageReader.camera_model", "OPENCV",
         "--FeatureExtraction.use_gpu", use_gpu])
    # sequential matching suits walk-through video; exhaustive suits unordered photo sets.
    run([colmap, f"{matcher}_matcher", "--database_path", str(db), "--FeatureMatching.use_gpu", use_gpu])
    sparse.mkdir(exist_ok=True)
    run([colmap, "mapper", "--database_path", str(db), "--image_path", str(images), "--output_path", str(sparse)])
    models = sorted(p for p in sparse.iterdir() if p.is_dir())
    if not models:
        sys.exit("sfm: COLMAP produced no model. Capture more overlap / slow down (see docs/SOP.md).")
    best = max(models, key=lambda m: sum(f.stat().st_size for f in m.glob("images.bin")))
    run([colmap, "image_undistorter", "--image_path", str(images), "--input_path", str(best),
         "--output_path", str(dense), "--output_type", "COLMAP"])
    return dense


def train_brush(dataset: Path, export: Path, steps: int) -> None:
    run([find_tool("brush_app"), str(dataset), "--total-steps", str(steps),
         "--export-path", str(export), "--export-every", str(steps)])


def train_nerfstudio(dataset: Path, export: Path, steps: int) -> None:
    """Nerfstudio splatfacto (gsplat). Needs a CUDA PyTorch env: Linux, or WSL2 on Windows."""
    runs = export.parent / "ns_runs"
    # image_undistorter writes sparse/ (not sparse/0) and images/ inside the dataset folder.
    run([find_tool("ns-train"), "splatfacto", "--data", str(dataset), "--output-dir", str(runs),
         "--max-num-iterations", str(steps), "--viewer.quit-on-train-completion", "True",
         "colmap", "--colmap-path", "sparse", "--images-path", "images"])
    configs = sorted(runs.rglob("config.yml"), key=lambda p: p.stat().st_mtime)
    if not configs:
        sys.exit("train: Nerfstudio wrote no config.yml under " + str(runs))
    run([find_tool("ns-export"), "gaussian-splat", "--load-config", str(configs[-1]),
         "--output-dir", str(export)])


TRAINERS = {"brush": train_brush, "nerfstudio": train_nerfstudio}


def train(dataset: Path, out: Path, steps: int, trainer: str) -> Path:
    export = out / f"splat_{trainer}"
    plys = sorted(export.glob("*.ply")) if export.exists() else []
    if plys:
        print("train: already done")
        return plys[-1]
    export.mkdir(parents=True, exist_ok=True)
    TRAINERS[trainer](dataset, export, steps)
    plys = sorted(export.glob("*.ply"))
    if not plys:
        sys.exit(f"train: {trainer} wrote no .ply into {export}")
    return plys[-1]


def publish(splat: Path, title: str) -> None:
    models = ROOT / "viewer" / "public" / "models"
    models.mkdir(parents=True, exist_ok=True)
    shutil.copy2(splat, models / "scene.ply")
    cfg = {"title": title, "splat": "models/scene.ply", "spawn": [0, 0, 0], "spawnYaw": 0,
           "eyeHeight": 1.6, "rotation": [3.141592653589793, 0, 0], "scale": 1}
    (models / "scene.json").write_text(json.dumps(cfg, indent=2))
    print(f"publish: {splat.name} -> viewer/public/models/scene.ply\n"
          "         edit scene.json (spawn, scale, rotation) to align the model, then `npm run dev`.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", type=Path, help="input video, or a folder of photos (skips frame extraction)")
    ap.add_argument("--out", type=Path, default=ROOT / "work" / "scene")
    ap.add_argument("--fps", type=float, default=3.0, help="frames sampled per second of video")
    ap.add_argument("--width", type=int, default=1600, help="frame width in px")
    ap.add_argument("--matcher", choices=["sequential", "exhaustive"], default="sequential")
    ap.add_argument("--steps", type=int, default=30000, help="Gaussian-splat training steps")
    ap.add_argument("--trainer", choices=sorted(TRAINERS), default="brush",
                    help="brush: single exe, any WebGPU GPU. nerfstudio: splatfacto, needs CUDA PyTorch (Linux/WSL2)")
    ap.add_argument("--title", default="Namma Space")
    ap.add_argument("--cpu", action="store_true", help="disable COLMAP GPU (use with the no-CUDA build)")
    a = ap.parse_args()

    a.out.mkdir(parents=True, exist_ok=True)
    if a.video.is_dir():
        shutil.copytree(a.video, a.out / "frames", dirs_exist_ok=True)
    else:
        extract_frames(a.video, a.out, a.fps, a.width)
    dataset = sfm(a.out, a.matcher, gpu=not a.cpu)
    splat = train(dataset, a.out, a.steps, a.trainer)
    publish(splat, a.title)


if __name__ == "__main__":
    main()
