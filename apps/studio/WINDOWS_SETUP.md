# Windows Setup Guide — Namma Space Pipeline

This guide covers installing the external tools needed to run the full
capture-to-scene pipeline on Windows 10/11.

## 1. Python 3.10+

Check first:
```
python --version
```

If not installed: https://www.python.org/downloads/
- Tick "Add Python to PATH" during setup.
- Recommended: Python 3.10 or 3.11 (Open3D is not yet compatible with 3.13).

---

## 2. Node.js 20+ and npm

Check first:
```
node --version
npm --version
```

If not installed: https://nodejs.org/en/download (LTS version)

After installing Node, install project dependencies from the repo root:
```
npm ci
```

---

## 3. FFmpeg

FFmpeg is needed to extract frames from video (Stage 1).

Check first:
```
ffmpeg -version
```

**Option A — Chocolatey (recommended):**
```powershell
# Install Chocolatey first if not present: https://chocolatey.org/install
choco install ffmpeg -y
```

**Option B — Manual:**
1. Download a Windows build from https://www.gyan.dev/ffmpeg/builds/
   (choose the `ffmpeg-release-essentials.zip`)
2. Extract to `C:\ffmpeg`
3. Add `C:\ffmpeg\bin` to your system PATH.

Test:
```
ffmpeg -version
```

---

## 4. COLMAP

COLMAP is needed for Structure-from-Motion (Stage 2).

**Option A — Prebuilt binary (easiest):**
1. Go to https://github.com/colmap/colmap/releases
2. Download the latest `COLMAP-x.x.x-windows-no-cuda.zip` (CPU-only, no GPU needed for Round 1).
3. Extract to `C:\colmap`
4. Add `C:\colmap\bin` to your system PATH.

**Option B — Chocolatey:**
```powershell
choco install colmap -y
```

Test:
```
colmap -h
```

You should see the COLMAP help text. The preflight check also verifies this:
```
npm run preflight:reconstruction
```

**GPU vs CPU:**
- Without an NVIDIA GPU (or without CUDA), COLMAP uses CPU SIFT.
  This is slower (~10-30 minutes for 100 frames on a laptop) but works.
- The reconstruct_colmap.py script defaults to `SiftExtraction.use_gpu=0`
  and `SiftMatching.use_gpu=0` for compatibility.

---

## 5. Open3D (optional but recommended)

Open3D converts the COLMAP dense point cloud into a textured GLB mesh
using Poisson surface reconstruction (Stage 3).

Without Open3D, the pipeline falls back to `ply_to_glb.py` which converts
the raw point cloud directly to GLB (no surface reconstruction — will look
like a cloud of dots in the viewer). Open3D produces a solid mesh surface.

Install:
```
pip install open3d
```

Or for a specific Python version:
```
py -3.10 -m pip install open3d
```

Test:
```
python -c "import open3d; print(open3d.__version__)"
```

Note: Open3D may not support Python 3.13+. Use Python 3.10–3.12.

---

## 6. Full Pipeline — Step by Step

After all tools are installed, run from the repo root:

### Step 1 — Prepare capture frames

From a video:
```
python scripts\prepare_capture.py .\my-capture.mp4 --output .\pipeline-output\capture --fps 2 --limit 120
```

From an image folder:
```
python scripts\prepare_capture.py .\my-photos --output .\pipeline-output\capture
```

Output: `pipeline-output\capture\frames\` + `frame-manifest.json`

---

### Step 2 — Check COLMAP is available

```
npm run preflight:reconstruction
```

If COLMAP is missing, install it first (Section 4 above).

---

### Step 3 — Run COLMAP reconstruction

Sparse only (faster, no mesh):
```
npm run reconstruct:colmap -- --frames .\pipeline-output\capture\frames --output .\pipeline-output\colmap
```

Sparse + Dense + Mesh (recommended for best quality):
```
npm run reconstruct:colmap -- --frames .\pipeline-output\capture\frames --output .\pipeline-output\colmap --dense --mesh
```

Output: `pipeline-output\colmap\dense\fused.ply` and optionally `meshed-poisson.ply`

Expect this to take 10–45 minutes depending on frame count and CPU.

---

### Step 4 — Convert point cloud / mesh to GLB

With Open3D (recommended):
```
python scripts\process_geometry.py --input-ply .\pipeline-output\colmap\dense\fused.ply --output-dir .\pipeline-output\geometry
```

Without Open3D (fallback):
```
python scripts\ply_to_glb.py .\pipeline-output\colmap\dense\fused.ply .\pipeline-output\geometry\reconstructed-mesh.glb
```

Output: `pipeline-output\geometry\reconstructed-mesh.glb` + `geometry-report.json`

---

### Step 5 — Generate navigation grid

```
python scripts\make_nav_grid.py --geometry-report .\pipeline-output\geometry\geometry-report.json --output .\pipeline-output\nav\nav-data.json
```

Then EDIT the `nav-data.json` file to mark obstacle cells (walls, furniture) before publishing.
The `blocked` array contains flat cell indices: `row * width + col`.

---

### Step 6 — Author Points of Interest

```
python scripts\make_pois.py --output .\pipeline-output\semantic\pois.json
```

Follow the prompts to enter POI labels, categories, world positions, and approach points.

---

### Step 7 — Package the scene bundle

```
python scripts\generate_scene_bundle.py ^
  --output .\public\scenes\venue-2026 ^
  --visual-asset .\pipeline-output\geometry\reconstructed-mesh.glb ^
  --geometry-report .\pipeline-output\geometry\geometry-report.json ^
  --semantic .\pipeline-output\semantic\pois.json ^
  --navigation .\pipeline-output\nav\nav-data.json ^
  --scene-id venue-2026 ^
  --display-name "Main Hall" ^
  --source "Phone capture, Techfest 2026"
```

---

### Step 8 — Validate and run

```
python scripts\validate_scene.py .\public\scenes\venue-2026
npm run dev
```

Open http://localhost:5173, select "02 Spatial Viewer", and explore the scene.

---

## One-Command Pipeline

Once all tools are installed, you can run all steps with:

```
python scripts\run_pipeline.py ^
  --input .\my-capture.mp4 ^
  --output .\pipeline-output ^
  --scene-id venue-2026 ^
  --display-name "Main Hall" ^
  --source "Phone capture" ^
  --dense --mesh
```

Note: This runs non-interactively. Edit `nav-data.json` and run `make_pois.py` afterwards.

---

## Troubleshooting

**"colmap is not recognized"**
- COLMAP is not on PATH. Add `C:\colmap\bin` to your system PATH and restart the terminal.

**"ffmpeg is not recognized"**
- FFmpeg is not on PATH. Add `C:\ffmpeg\bin` to your system PATH.

**COLMAP fails with "No images provided"**
- Check that the frames directory contains .jpg or .png files.
- Run prepare_capture.py first to extract frames from video.

**COLMAP sparse reconstruction produces 0 images registered**
- This means insufficient overlap or texture. Recapture the space:
  - Move slower.
  - Ensure 2/3 overlap between consecutive frames.
  - Avoid plain white walls or mirrored surfaces.

**Open3D import fails**
- Check Python version: Open3D requires Python 3.10–3.12.
- Try: `py -3.10 -m pip install open3d`

**GLB does not appear in the viewer**
- Check the browser console for asset load errors.
- Verify the manifest.json visual asset URI is correct.
- Run `python scripts\validate_scene.py <scene-dir>` to check the bundle.
