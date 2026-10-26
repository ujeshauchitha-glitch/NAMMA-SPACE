#!/usr/bin/env bash
# Linux / WSL2 (Ubuntu or Debian) setup. UNTESTED: written on Windows, to be verified on the team's Linux machines.
#   ffmpeg, COLMAP  : apt
#   Brush           : prebuilt release into ./tools/brush
#   Python deps     : venv in ./.venv
# Nerfstudio (optional trainer) is NOT installed here: it needs a CUDA PyTorch env, see docs/TRAINING.md.
set -euo pipefail
cd "$(dirname "$0")/../.."   # repository root (this script is reconstruction/scripts/)

sudo apt-get update
sudo apt-get install -y ffmpeg colmap python3-venv python3-pip xz-utils curl

BRUSH_VERSION="v0.3.0"
if [ ! -x tools/brush/brush_app ]; then
  mkdir -p tools/brush
  curl -L "https://github.com/ArthurBrussee/brush/releases/download/${BRUSH_VERSION}/brush-app-x86_64-unknown-linux-gnu.tar.xz" \
    | tar -xJ -C tools/brush --strip-components=1
  chmod +x tools/brush/brush_app
fi

python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install opencv-python-headless numpy

cat <<'EOF'

Done. Notes:
  * Ubuntu's apt `colmap` is usually built WITHOUT CUDA. Run the pipeline with --cpu (slower feature
    extraction/matching, fine for ~200 frames), or install a CUDA build (conda-forge `colmap`, or build from source).
  * Brush needs a Vulkan-capable driver (NVIDIA proprietary driver is fine).
  * Check everything:   .venv/bin/python reconstruction/pipeline/run_pipeline.py --doctor --cpu
EOF
