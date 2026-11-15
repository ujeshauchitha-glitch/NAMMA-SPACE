#!/usr/bin/env bash
# Linux / WSL2 setup (Ubuntu 22.04+). Kaggle uses notebooks/kaggle_reconstruct.ipynb instead, with the same pins.
#   ffmpeg            : apt
#   camera poses      : pycolmap-cuda12 (pip, prebuilt CUDA 12 COLMAP; no `colmap` executable needed)
#   training          : gsplat (pip; compiles its CUDA kernels on first use, needs nvcc) - the Linux default
#   web compression   : @playcanvas/splat-transform (npm, Node >= 22) into ./tools/splat-transform
#   Brush             : optional (--trainer brush), prebuilt release into ./tools/brush
# Assumes an NVIDIA driver and a CUDA build of PyTorch. Without a GPU, run the pipeline with --cpu (poses only;
# gsplat cannot train on the CPU).
set -euo pipefail
cd "$(dirname "$0")/.."

PYCOLMAP_VERSION="4.2.1"
GSPLAT_VERSION="1.5.3"
SPLAT_TRANSFORM_VERSION="3.11.2"
BRUSH_VERSION="v0.3.0"

if ! command -v ffmpeg >/dev/null; then
  sudo apt-get update && sudo apt-get install -y ffmpeg
fi

python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install opencv-python-headless numpy scipy "pycolmap-cuda12==${PYCOLMAP_VERSION}"
if .venv/bin/python -c "import torch" 2>/dev/null; then
  .venv/bin/pip install "gsplat==${GSPLAT_VERSION}"
else
  echo "NOTE: no PyTorch in .venv. Install a CUDA build (https://pytorch.org/get-started/locally/), then:"
  echo "      .venv/bin/pip install gsplat==${GSPLAT_VERSION}"
fi

# splat-transform (web compression stage) needs Node.js >= 22.
NODE_MAJOR=$(node --version 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/' || echo 0)
if [ "${NODE_MAJOR:-0}" -lt 22 ]; then
  echo "NOTE: Node.js >= 22 is required for splat-transform (found: $(node --version 2>/dev/null || echo none))."
  echo "      Without it the pipeline still writes a compressed PLY with pipeline/compressed_ply.py."
elif [ ! -f tools/splat-transform/.complete ] || ! grep -q "\"version\": \"${SPLAT_TRANSFORM_VERSION}\"" \
    tools/splat-transform/node_modules/@playcanvas/splat-transform/package.json 2>/dev/null; then
  rm -rf ./tools/splat-transform
  npm install --prefix tools/splat-transform --no-audit --no-fund "@playcanvas/splat-transform@${SPLAT_TRANSFORM_VERSION}"
  touch tools/splat-transform/.complete
fi

if [ "${WITH_BRUSH:-0}" = "1" ] && [ ! -x tools/brush/brush_app ]; then
  mkdir -p tools/brush
  curl -L "https://github.com/ArthurBrussee/brush/releases/download/${BRUSH_VERSION}/brush-app-x86_64-unknown-linux-gnu.tar.xz" \
    | tar -xJ -C tools/brush --strip-components=1
  chmod +x tools/brush/brush_app
fi

cat <<'MSG'

Done. Check everything:   .venv/bin/python pipeline/run_pipeline.py --doctor
Run (preview, ~30 min on a T4):
  .venv/bin/python pipeline/run_pipeline.py capture.mp4 --out work/room --profile preview
Tool locations can be overridden with NAMMA_<TOOL> (e.g. NAMMA_FFMPEG, NAMMA_COLMAP) and NAMMA_SPLAT_TRANSFORM_CLI.
MSG
