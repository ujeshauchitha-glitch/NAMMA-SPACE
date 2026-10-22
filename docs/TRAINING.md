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
sudo apt install colmap ffmpeg python3-venv build-essential     # colmap 3.x from apt is fine for poses
python3 -m venv ~/ns && source ~/ns/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128   # cu128+ required for RTX 50-series
pip install nerfstudio opencv-python-headless
python pipeline/run_pipeline.py clip.mp4 --out work/room1 --trainer nerfstudio --steps 30000
```
gsplat compiles CUDA kernels on first use. That needs `nvcc` matching the PyTorch CUDA version (install the CUDA toolkit); expect this step to be where problems show up.

## Moving between machines
```text
work/<name>/dataset/   <- copy this folder (images/ + sparse/) to the training machine
work/<name>/splat_*/   <- copy the resulting .ply back, then `npm run dev` in viewer/
```
To train an already-processed dataset, point `--out` at the copied work folder; finished stages are skipped.

## Before switching the laptop to Linux
- Commit the work and push it (nothing is committed yet; `git add -A && git commit`). The `tools/` folder holds Windows binaries and will not run on Linux; `scripts/setup_tools.ps1` is Windows-only (a Linux setup script is still to be written).
- If you want to keep Windows, dual-boot instead of replacing it, and keep this repo on a drive that survives the install.
