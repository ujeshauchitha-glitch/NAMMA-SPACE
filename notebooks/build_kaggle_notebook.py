"""Generate notebooks/kaggle_reconstruct.ipynb (keeps the notebook reviewable as plain Python).

    python notebooks/build_kaggle_notebook.py
"""
import json
from pathlib import Path

# Pins (checked 2026-11-15). Sources are listed in the notebook's first cell.
PINS = {
    "pycolmap-cuda12": "4.2.1",
    "gsplat": "1.5.3",
    "splat-transform": "3.11.2",
    "node": "22.23.5",
    "ultralytics": "8.4.213",
}

INTRO = f"""# Namma Space: phone video → web scene bundle on Kaggle

Runs `pipeline/run_pipeline.py` end to end on a Kaggle GPU: frames → camera poses (COLMAP via pycolmap, CUDA) →
Gaussian splat training (gsplat) → cleanup → web compression → studio scene bundle, timing every stage.

## What you do on Kaggle (5 steps)
1. **New notebook → File → Import notebook**, upload this `kaggle_reconstruct.ipynb`.
2. **Settings → Accelerator → GPU T4 x2.** Not P100: Kaggle's current PyTorch needs compute capability ≥ 7.0 and
   the P100 is 6.0 ([Kaggle/docker-python#1546](https://github.com/Kaggle/docker-python/issues/1546)).
   **Settings → Internet → On** (pip, npm, the repo and COLMAP's vocabulary tree are downloaded).
3. **Add Input → Upload** a dataset with your video (optional) and set `INPUT_VIDEO` in the config cell to its
   path under `/kaggle/input/...`. Left empty, the repo's 36 s sample clip is used as a smoke test.
4. **Run All.** The install cell takes several minutes (gsplat compiles its CUDA kernels for the T4 once).
5. **Download `scene_bundle.zip`** (and `report.json`) from the Output panel (`/kaggle/working`) when it finishes.
   Unzip into `apps/studio/public/scenes/<name>/` to open it in the studio.

## Pinned versions and sources
| Component | Pin | Why / source |
|---|---|---|
| pycolmap-cuda12 | {PINS['pycolmap-cuda12']} | prebuilt CUDA 12 COLMAP wheel (manylinux_2_28, cp310–cp314), no source build: [PyPI](https://pypi.org/project/pycolmap-cuda12/), [COLMAP install docs](https://colmap.github.io/install.html) |
| COLMAP vocabulary tree | faiss 256K (3.11.1 release) | loop closure in sequential matching; URI and sha256 from COLMAP 4.2.1 `src/colmap/retrieval/resources.h`: [release asset](https://github.com/colmap/colmap/releases/tag/3.11.1) |
| global mapper (GLOMAP) | in COLMAP 4.x | [COLMAP 4.0 notes](https://radiancefields.com/colmap-4.0-introduces-major-performance-and-infrastructure-updates), [4.2.0 notes](https://radiancefields.com/colmap-4.2.0-adds-multi-component-global-mapping-and-loma-learned-matching) |
| gsplat | {PINS['gsplat']} | latest on PyPI (2025-07-04); MCMC strategy, antialiased mode. Prebuilt wheels exist only for torch 2.4/cu124/py3.10, so it JIT-compiles here: [PyPI](https://pypi.org/project/gsplat/), [wheel index](https://docs.gsplat.studio/whl/), [repo](https://github.com/nerfstudio-project/gsplat), [paper](https://arxiv.org/abs/2409.06765) |
| @playcanvas/splat-transform | {PINS['splat-transform']} | SOG/compressed-PLY writer, needs Node ≥ 22: [npm](https://www.npmjs.com/package/@playcanvas/splat-transform), [SOG format](https://blog.playcanvas.com/playcanvas-open-sources-sog-format-for-gaussian-splatting/) |
| Node.js | {PINS['node']} (22 LTS) | [nodejs.org](https://nodejs.org/dist/v{PINS['node']}/) |
| ultralytics (optional) | {PINS['ultralytics']} | only with `MASK_PEOPLE = True`: [PyPI](https://pypi.org/project/ultralytics/) |
| PyTorch, CUDA | Kaggle's preinstalled | printed by the install cell and stored in report.json |

Expected time for a ~2 min 1080p clip with `PROFILE = "final"` on one T4: install ~10 min, frames ~2 min, poses
~10–20 min, training 30k steps ~60–80 min, the rest a few minutes. These are estimates, not measurements:
the per-stage times this run actually took are printed at the end and saved in `report.json`.
"""

CONFIG = f"""# ---- configuration -------------------------------------------------------------------------
REPO = "https://github.com/ujeshauchitha-glitch/NAMMA-SPACE"
BRANCH = "round2/kaggle-pipeline"
INPUT_VIDEO = ""            # e.g. "/kaggle/input/my-room/room.mp4"; empty = repo sample (smoke test)
PROFILE = "preview"         # "preview" (≤720p, 7k steps, ~30 min target) or "final" (1080p, 30k steps)
TITLE = "Kaggle reconstruction"
MASK_PEOPLE = False         # True: YOLO-segment people out of the training frames (downloads weights)
EXTRA_ARGS = []             # e.g. ["--exhaustive"] or ["--max-splats", "1000000"]

PINS = {json.dumps(PINS)}
WORK = "/kaggle/working"
"""

INSTALL = """# ---- install (pinned) ------------------------------------------------------------------------
import os, subprocess, sys, time, json, shutil
t0 = time.time()
def sh(cmd, **kw):
    print("$", cmd, flush=True)
    subprocess.run(cmd, shell=True, check=True, **kw)

sh("nvidia-smi --query-gpu=name,memory.total,driver_version,compute_cap --format=csv")
sh("python --version; nvcc --version | tail -2 || true; ffmpeg -version | head -1 || true")
if shutil.which("ffmpeg") is None:
    sh("apt-get -qq update && apt-get -qq install -y ffmpeg")

pkgs = [f"pycolmap-cuda12=={PINS['pycolmap-cuda12']}", f"gsplat=={PINS['gsplat']}", "plyfile"]
if MASK_PEOPLE:
    pkgs.append(f"ultralytics=={PINS['ultralytics']}")
sh(f"pip install -q {' '.join(pkgs)}")

# Node 22 LTS (Kaggle's node, if any, is too old for splat-transform) + splat-transform, both pinned.
node_dir = f"/kaggle/working/tools/node-v{PINS['node']}-linux-x64"
if not os.path.exists(f"{node_dir}/bin/node"):
    os.makedirs("/kaggle/working/tools", exist_ok=True)
    sh(f"curl -fsSL https://nodejs.org/dist/v{PINS['node']}/node-v{PINS['node']}-linux-x64.tar.xz | tar -xJ -C /kaggle/working/tools")
os.environ["PATH"] = f"{node_dir}/bin:" + os.environ["PATH"]
st = "/kaggle/working/tools/splat-transform"
sh(f"npm install -q --prefix {st} --no-audit --no-fund @playcanvas/splat-transform@{PINS['splat-transform']}")
os.environ["NAMMA_SPLAT_TRANSFORM_CLI"] = f"{st}/node_modules/@playcanvas/splat-transform/bin/cli.mjs"

# Compile gsplat's CUDA kernels now, for the T4 only (sm_75): faster than every architecture, and a
# compile error shows up here instead of after the poses stage. Run in a child process, like the pipeline.
os.environ["TORCH_CUDA_ARCH_LIST"] = "7.5"
os.environ.setdefault("MAX_JOBS", "4")
check = "/kaggle/working/tools/check_gpu_stack.py"
open(check, "w").write('''
import torch, gsplat
from gsplat import rasterization
dev = "cuda"
m = torch.zeros(1, 3, device=dev); q = torch.tensor([[1.0, 0, 0, 0]], device=dev)
s = torch.full((1, 3), 0.1, device=dev); o = torch.ones(1, device=dev); c = torch.ones(1, 3, device=dev)
v = torch.eye(4, device=dev)[None]; v[0, 2, 3] = 3.0
K = torch.tensor([[[100.0, 0, 32], [0, 100.0, 32], [0, 0, 1]]], device=dev)
img, _, _ = rasterization(m, q, s, o, c, v, K, 64, 64, rasterize_mode="antialiased")
print("gsplat OK", gsplat.__version__, "| torch", torch.__version__, "cuda", torch.version.cuda,
      "| GPU", torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0), "| render", tuple(img.shape))
''')
t_compile = time.time()
sh(f"python {check}")
print(f"gsplat CUDA build + check: {time.time() - t_compile:.0f} s")
subprocess.run([sys.executable, "-c", "import pycolmap; print('pycolmap', pycolmap.__version__, 'cuda', pycolmap.has_cuda)"], check=True)
print(f"install: {time.time() - t0:.0f} s")
"""

CLONE = """# ---- clone the repository at the branch ---------------------------------------------------------
repo = "/kaggle/working/NAMMA-SPACE"
if not os.path.exists(repo):
    sh(f"git clone -q --depth 1 --branch {BRANCH} {REPO} {repo}")
sh(f"git -C {repo} log -1 --oneline")
video = INPUT_VIDEO or f"{repo}/tests/sample_data/capture_short.mp4"
print("input:", video, f"{os.path.getsize(video) / 1e6:.1f} MB")
"""

RUN = """# ---- run the pipeline (every stage timed into report.json) --------------------------------------
out = f"{WORK}/scene"
args = [sys.executable, f"{repo}/pipeline/run_pipeline.py", video, "--out", out, "--profile", PROFILE,
        "--title", TITLE, "--sfm", "pycolmap", "--trainer", "gsplat", *(["--mask-people"] if MASK_PEOPLE else []), *EXTRA_ARGS]
os.environ["TORCH_CUDA_ARCH_LIST"] = "7.5"
t_run = time.time()
proc = subprocess.run(args)
print(f"\\npipeline exit code {proc.returncode} after {(time.time() - t_run) / 60:.1f} min")
"""

TIMINGS = """# ---- stage timings, GPU, versions, frame/registration counts -------------------------------------
report = json.load(open(f"{out}/report.json"))
print("status:", report.get("status"), "|", report.get("error", "")[:300])
print("total:", round(report.get("total_seconds", 0) / 60, 1), "min")
rows = [(k, v.get("seconds", 0)) for k, v in report.get("stages", {}).items()]
w = max([len(k) for k, _ in rows] + [5])
for k, s in rows:
    print(f"  {k:<{w}} {s / 60:7.1f} min   {json.dumps({kk: vv for kk, vv in report['stages'][k].items() if kk != 'seconds'})}")
print("sfm:", json.dumps(report.get("sfm", {})))
print("sfm timing:", json.dumps(report.get("sfm_timing", {})))
print("training:", json.dumps(report.get("train_stats", {})))
print("web splat:", json.dumps(report.get("web_splat", {})))
print("environment:", json.dumps(report.get("environment", {}), indent=1))
"""

RENDER = """# ---- three rendered views next to the matching photos --------------------------------------------
from IPython.display import Image as IPImage, display
r = subprocess.run([sys.executable, f"{repo}/pipeline/render_views.py", out, "--views", "3"])
if r.returncode == 0:
    import matplotlib.pyplot as plt, matplotlib.image as mpimg, glob
    renders = sorted(glob.glob(f"{out}/renders/render_*.png"))
    fig, axes = plt.subplots(len(renders), 2, figsize=(14, 4 * len(renders)), squeeze=False)
    for i, rpath in enumerate(renders):
        photo = sorted(glob.glob(f"{out}/renders/photo_{i}.*"))[0]
        for ax, path, title in ((axes[i][0], photo, "photo"), (axes[i][1], rpath, "splat render")):
            ax.imshow(mpimg.imread(path)); ax.set_title(f"{title} {i}"); ax.axis("off")
    plt.tight_layout(); plt.show()
"""

ZIP = """# ---- zip the scene bundle to /kaggle/working ------------------------------------------------------
bundle = f"{out}/bundle"
if os.path.exists(f"{bundle}/manifest.json"):
    shutil.copy2(f"{out}/report.json", f"{WORK}/report.json")
    zip_path = shutil.make_archive(f"{WORK}/scene_bundle", "zip", bundle)
    print("download from the Output panel:", zip_path, f"{os.path.getsize(zip_path) / 1e6:.1f} MB")
    print(open(f"{bundle}/manifest.json").read()[:1500])
else:
    print("no bundle: the run failed before publishing; see the status and log above,", f"{out}/logs/pipeline.log")
"""


def code(src: str) -> dict:
    return {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": src.strip("\n").splitlines(keepends=True)}


def md(src: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": src.strip("\n").splitlines(keepends=True)}


def build() -> dict:
    return {
        "nbformat": 4, "nbformat_minor": 5,
        "metadata": {"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"},
                     "language_info": {"name": "python"},
                     "kaggle": {"accelerator": "nvidiaTeslaT4", "isInternetEnabled": True, "isGpuEnabled": True}},
        "cells": [md(INTRO), code(CONFIG), code(INSTALL), code(CLONE), code(RUN), code(TIMINGS), code(RENDER), code(ZIP)],
    }


if __name__ == "__main__":
    path = Path(__file__).with_name("kaggle_reconstruct.ipynb")
    path.write_text(json.dumps(build(), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(path)
