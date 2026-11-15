# Where to run what

**Status: every command below is UNTESTED.** Only COLMAP 4.2.1 and Brush 0.3.0 have been launched (`--help`) on the Windows laptop; no reconstruction has run yet. Record real results in `STATUS.md`.

The pipeline is split so heavy work can move between machines. The hand-off is a folder (`work/<name>/dataset`, produced by COLMAP): copy it, train anywhere, copy the `.ply` back.

| Machine | Role | Trainer | Notes |
|---|---|---|---|
| Team laptop, Linux (RTX 5060, 8 GB) | capture processing, dev, viewer | Nerfstudio or Brush | Blackwell (sm_120) needs a PyTorch build with CUDA 12.8+ |
| Lab PC, Windows (A4000, 16 GB) | heavy training | **Brush** (zero setup), or Nerfstudio inside **WSL2** | native-Windows gsplat needs MSVC build tools + CUDA toolkit; avoid unless required |
| Any laptop | viewer only | none | WebGL2 browser is enough |

## 1. Windows A4000 machine, Brush (recommended first)
```powershell
./scripts/setup_tools.ps1
py -3.12 pipeline/run_pipeline.py clip.mp4 --out work/room1 --trainer brush --steps 30000
```
Brush uses WebGPU, so it needs no CUDA toolkit. Use `--max-resolution` / `--max-splats` (Brush flags) if VRAM runs out.

## 2. Windows A4000 machine, Nerfstudio via WSL2
1. In PowerShell as admin: `wsl --install -d Ubuntu-24.04`, reboot. Needs a recent NVIDIA Windows driver; do **not** install a Linux GPU driver inside WSL.
2. Inside Ubuntu follow section 3 below.
3. Windows files are at `/mnt/c/...`, but training from `~/` (the Linux filesystem) is much faster.

## 3. Linux (laptop, or WSL2), Nerfstudio
Outline only, verify versions when running:
```bash
sudo apt install colmap ffmpeg python3-venv build-essential     # apt colmap is usually CPU-only: pass --cpu, or use conda-forge's CUDA build
python3 -m venv ~/ns && source ~/ns/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128   # cu128+ required for RTX 50-series
pip install nerfstudio opencv-python-headless
python pipeline/run_pipeline.py clip.mp4 --out work/room1 --trainer nerfstudio --steps 30000
```
gsplat compiles CUDA kernels on first use. That needs `nvcc` matching the PyTorch CUDA version (install the CUDA toolkit); expect this step to be where problems show up.

## 4. Kaggle (Linux, T4), pycolmap + gsplat
Open `notebooks/kaggle_reconstruct.ipynb` on Kaggle; its first cell lists the five clicks and the pinned versions
(pycolmap-cuda12 4.2.1, gsplat 1.5.3, splat-transform 3.11.2, Node 22). Use **GPU T4 x2**, not P100 (Kaggle's
PyTorch needs compute capability >= 7.0). The same stack works on any Linux box via `scripts/setup_tools.sh`:
```bash
python pipeline/run_pipeline.py clip.mp4 --out work/room --profile preview   # <=720p, 7k steps: a quick look
python pipeline/run_pipeline.py clip.mp4 --out work/room --profile final     # 1080p, 30k steps, <=1.5M splats
```
On Linux the defaults are `--sfm pycolmap` (when there is no `colmap` executable) and `--trainer gsplat`:
sequential matching with vocabulary-tree loop closure, the global mapper (falls back to incremental), then gsplat
with MCMC, scale/anisotropy regularisation and antialiasing. `--exhaustive` matches all pairs. Every stage's wall
time, the GPU and tool versions, and frame/registration counts are in `report.json`. Without Node or WebGPU the
web splat falls back to a compressed PLY (`pipeline/compressed_ply.py`), which the studio loads.

## Moving between machines
```text
work/<name>/dataset/   <- copy this folder (images/ + sparse/) to the training machine
work/<name>/splat_*/   <- copy the resulting .ply back, then `npm run dev` in viewer/
```
To train an already-processed dataset, point `--out` at the copied work folder; finished stages are skipped.

## Before switching the laptop to Linux
- Commit the work and push it (nothing is committed yet; `git add -A && git commit`). The `tools/` folder holds Windows binaries and will not run on Linux; `scripts/setup_tools.ps1` is Windows-only (a Linux setup script is still to be written).
- If you want to keep Windows, dual-boot instead of replacing it, and keep this repo on a drive that survives the install.
