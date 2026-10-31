# Namma Space

> **Turn physical spaces into navigable digital environments.**
> Unified Product Integration · Release Branch: `finalashwinintegration`
> Live Interactive Frontend & 3D Viewer Demo: [**https://namma-space-studio.vercel.app**](https://namma-space-studio.vercel.app)

> [!NOTE]
> **Vercel Demo Notice**: The deployed public link is an **interactive showcase of the frontend, Capture Studio, and 3D spatial viewer**. It runs with pre-computed demonstration environments (procedural room, architectural GLB mesh, and synthetic SOG 3D Gaussian Splat). Because static hosts like Vercel have **no GPUs** (250MB limit, 15-60s execution timeout), real photogrammetry and 3DGS training cannot run in the browser. To reconstruct your own space from photographs or video, run the local GPU pipeline step-by-step as documented below.

---

## ⚡ Quick Start for Judges (2-Minute Interactive Browser Demo)

You can evaluate the complete user experience right now in your browser with zero installation:

1. **Open the live application**: [**https://namma-space-studio.vercel.app**](https://namma-space-studio.vercel.app)
2. **Review the Interactive Onboarding**: The 5-step journey will guide you. Click **`? Guide`** in the top navigation bar anytime to reopen it.
3. **Explore 3D Digital Twins (Tab `02 Spatial Viewer`)**:
   - In the top header bar, use the **Scene** dropdown to switch between:
     - `Captured Workshop Room (70 Photos)`: **Real digital twin** reconstructed from genuine smartphone photos (`work/captures/room`) with true camera frustums and 3D point cloud! Open directly: [**?scene=real**](https://namma-space-studio.vercel.app/?scene=real)
     - `Nerfstudio Benchmark · Poster (226 Cameras)`: **Real multi-view reconstruction** generated from the official Nerfstudio benchmark dataset (226 calibrated camera poses, 12,977 3D points, SOG splat, and orbital camera constellation)! Open directly: [**?scene=nerfstudio**](https://namma-space-studio.vercel.app/?scene=nerfstudio)
     - `Synthetic Splat fixture (SOG)`: 3D Gaussian Splat model rendered via PlayCanvas WebGL. Open directly: [**?scene=splat**](https://namma-space-studio.vercel.app/?scene=splat)
     - `Procedural fixture`: Synthetic architectural room with walking nav-mesh. Open directly: [**?scene=fixture**](https://namma-space-studio.vercel.app/?scene=fixture)
     - `Generated GLB fixture`: Textured 3D mesh model with collision boundary. Open directly: [**?scene=glb**](https://namma-space-studio.vercel.app/?scene=glb)
   - **Full Screen Mode**: Click the **`Full Screen`** button in the toolbar / HUD or press **`F`** to view the digital twin edge-to-edge in true full screen!
   - **Controls**: Click the 3D viewport to lock mouse look. Walk with **`W` `A` `S` `D`**. Press **`Esc`** to release the mouse.
   - **POI Search**: Press **`Cmd+K`** (or click *Search points of interest* in the right rail). Search for `Registration` or `Information`.
   - **A\* Pathfinding**: Click a destination and click **`Plot route`**. A collision-safe 3D walking tape is calculated through obstacles.
   - **Camera Fly-Through**: Click **`Jump to view`** to smoothly fly the camera to that destination.
4. **Create & Prepare Captures (Tab `01 Capture Studio`)**:
   - Click tab **`01 Capture Studio`** (or open [`?workspace=capture`](https://namma-space-studio.vercel.app/?workspace=capture)).
   - Click **`+ Add room`** to create a space (e.g. `Office Hall`).
   - Drag and drop room photos into the staging area.
   - Click photo thumbnails to assign viewpoint tags (`FRONT`, `BACK`, `LEFT`, `RIGHT`).
   - Click **`Export bundle`** in the right Inspector to download a signed, validated `capture-bundle.zip`.

---

## 🖥️ How to Run the GPU 3D Reconstruction Pipeline Locally (Step-by-Step)

To turn real smartphone photos or video into a photorealistic 3D digital twin, follow these step-by-step instructions on a machine with GPU compute (or CPU for testing):

### 1. Hardware & System Prerequisites
- **OS**: Windows 10/11, Ubuntu 22.04+ (or WSL2), or macOS (Apple Silicon).
- **GPU**: NVIDIA GPU (RTX series recommended with Vulkan/CUDA support) for fast 3D Gaussian Splatting via Brush. On macOS, COLMAP feature extraction runs on CPU.
- **Tools**: Python 3.13+, Node.js 20+, FFmpeg, and COLMAP 4.2+.

---

### 2. Step 1: Bootstrap the Environment and Tools

#### On Windows (PowerShell):
```powershell
# 1. Clone repository and switch to release branch
git clone https://github.com/ujeshauchitha-glitch/NAMMA-SPACE.git
cd NAMMA-SPACE
git checkout finalashwinintegration

# 2. Run tool bootstrap script (downloads COLMAP, Brush, splat-transform, sets up venv)
.\scripts\setup_tools.ps1

# 3. Verify tool dependencies
.venv\Scripts\python pipeline/run_pipeline.py --doctor
```

#### On Linux / Ubuntu / WSL2:
```bash
# 1. Clone repository and switch to release branch
git clone https://github.com/ujeshauchitha-glitch/NAMMA-SPACE.git
cd NAMMA-SPACE
git checkout finalashwinintegration

# 2. Run automated Linux setup script
chmod +x scripts/setup_tools.sh
./scripts/setup_tools.sh

# 3. Verify tool dependencies
.venv/bin/python pipeline/run_pipeline.py --doctor
```

#### On macOS (Apple Silicon):
```bash
# 1. Install CLI prerequisites via Homebrew
brew install ffmpeg colmap node

# 2. Create Python virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install opencv-python-headless numpy

# 3. Install splat-transform
npm install --prefix tools/splat-transform @playcanvas/splat-transform@3.10.3

# 4. Check dependencies (on Mac, COLMAP runs in CPU mode)
python pipeline/run_pipeline.py --doctor --cpu
```

---

### 3. Step 2: Prepare Your Input Data

You can use a video or photos of a room:
- **Option A (Smartphone Video)**: Record a slow 4K/1080p 60fps walkthrough video walking around the perimeter of the room (e.g. `my_room.mp4`).
- **Option B (Photos)**: Take 60 to 120+ photos with 70–80% overlap between adjacent shots and put them into a folder `my_photos/`.
- **Option C (Built-in Sample Data)**: The repository comes with a verified synthetic test video ready to test immediately:
  `tests/sample_data/synthetic_clip.mp4`

---

### 4. Step 3: Run the 3D Reconstruction Pipeline

Run the automated pipeline to extract frames, solve camera poses with COLMAP, train 3D Gaussian Splats, and compress the model:

```bash
# For a video input:
python pipeline/run_pipeline.py my_room.mp4 --out work/my_room --title "My Room"

# Or on macOS / machines without an NVIDIA GPU (runs COLMAP in CPU mode):
python pipeline/run_pipeline.py my_room.mp4 --out work/my_room --title "My Room" --cpu
```

#### What happens during this run:
1. **Frame Extraction**: FFmpeg extracts sharp frames at 2 fps.
2. **Blur Detection**: Laplacian variance checks discard motion-blurred frames.
3. **Structure-from-Motion (COLMAP)**: Extracts SIFT features, matches keypoints across frames, and computes exact 3D camera poses.
4. **3D Gaussian Splatting (Brush)**: Optimizes 3D Gaussians to represent the room photorealistically.
5. **SOG Compression**: Uses `@playcanvas/splat-transform` to compress the raw `.ply` into a web-streamable `.sog` file (< 50 MB).

Output files generated in `work/my_room/web/`:
- `scene.sog`: Compressed 3D Gaussian Splat.
- `scene.json`: Camera spawn coordinates, bounding box, and scale.

---

### 5. Step 4: Generate Navigation Grid & POIs

To make the digital twin navigable with A* pathfinding and searchable points of interest:

```bash
# 1. Copy the generated web files to the viewer's scenes folder
mkdir -p apps/studio/public/scenes/my_room
cp work/my_room/web/scene.sog apps/studio/public/scenes/my_room/
cp work/my_room/web/scene.json apps/studio/public/scenes/my_room/manifest.json

# 2. Generate the 2D walkable grid and POIs
python3 apps/studio/scripts/make_nav_grid.py apps/studio/public/scenes/my_room
python3 apps/studio/scripts/make_pois.py apps/studio/public/scenes/my_room
```

---

### 6. Step 5: Explore Your New Digital Twin in the Local Viewer

Start the local viewer to explore your custom reconstructed space:

```bash
# 1. Install frontend dependencies (if not already done)
cd apps/studio
npm ci

# 2. Launch the local dev server
npm run dev
```

Open your browser to:
[**http://localhost:5173/?scene=/scenes/my_room/manifest.json**](http://localhost:5173/?scene=/scenes/my_room/manifest.json)

You can now:
- Walk through your physical room digitally using **`W` `A` `S` `D`** and mouse look.
- Search for destinations with **`Cmd+K`**.
- Plot walking routes with collision avoidance.

---

## 🏗️ System Architecture: Browser Platform vs. GPU Worker

```
                                  NAMMA SPACE UNIFIED ARCHITECTURE
                                  
     [ 01 CAPTURE STUDIO ]                 [ SHARED OBSERVATION CONTRACT ]
  Photographs (drag-and-drop) ──┐                        │
  Smartphone Video (.mp4/.mov) ─┼──► Ingestion & Checks ─┴──► capture-bundle.zip
  Live Scan (WebRTC / QR) ──────┘    (SHA-256, Viewpoints)            │
                                                                       ▼
                                                          [ RECONSTRUCTION ENGINE ]
                                                          (Local CLI / External GPU)
                                                          COLMAP SfM ──► Poses
                                                          Brush 3DGS ──► .sog / .ply
                                                          Mesh Engine ──► .glb
                                                          Nav Engine  ──► nav-data.json
                                                          POI Engine  ──► poi-index.json
                                                                       │
                                                                       ▼
     [ 02 SPATIAL VIEWER ]                 [ SHARED SCENE CONTRACT (D1-D3) ]
  PlayCanvas Unified Renderer ◄────── Manifest, Integrity Hashes, Assets, Grid
  ├─ Procedural & GLB Meshes
  ├─ 3D Gaussian Splats (SOG)
  ├─ First-person Controls (WASD)
  ├─ Collision A* Pathfinding
  └─ POI Search (Cmd+K) & Jump
```

---

## 📹 Direct Video Upload Architecture (Cloud Production Topology)

If scaling to an automated cloud service where users upload a video and receive a twin automatically:

```
[User Uploads Video in Browser]
             │ (.mp4 / .mov)
             ▼
[Cloud Storage Bucket (AWS S3 / Cloudflare R2 / GCS)]
             │ Webhook trigger
             ▼
[GPU Worker Instance (Modal Labs / RunPod / AWS EC2 with NVIDIA RTX/A10G)]
             │ 1. FFmpeg frame extraction & blur filter
             │ 2. COLMAP camera pose estimation
             │ 3. Brush 3D Gaussian Splat training
             │ 4. SOG compression & nav grid synthesis
             ▼
[Public Scene URL (`/scenes/<room>/manifest.json`)]
             │ Auto-notification
             ▼
[Spatial Viewer Displays Navigable 3D Twin]
```

---

## 📸 Photogrammetry Rules: How to Capture Photos or Video

When capturing a room with a smartphone, photogrammetry algorithms mathematically require specific conditions:

| Rule | Requirement | Why It Is Mandatory |
| :--- | :--- | :--- |
| **1. Image Density** | **60 to 120+ photos** (or continuous 4K 60fps video) | COLMAP needs dozens of overlapping camera ray intersections to triangulate depth. A handful of photos (e.g. 5 shots) leaves 95% of room surfaces unobserved. |
| **2. High Overlap** | **70% to 80% overlap** between consecutive frames | Every point in the room must appear in at least 3–4 adjacent photos for feature matching (SIFT) to link frames. |
| **3. Zero Motion Blur** | Hold phone steady or walk slowly | Blurry pixels destroy high-frequency edge gradients, causing feature detection to fail completely. |
| **4. Completely Static Room** | **No moving people, pets, or swinging objects** | Structure-from-Motion assumes a rigid, static physical world. A person moving through the shot creates phantom tie-points that warp or corrupt the camera poses. |
| **5. Room Anchors on Flat Walls** | Frame corners, switchboards, doors, furniture | Plain, uniform walls (such as blank corrugated metal or plain painted drywall) have zero texture points. Framing corners, floor seams, and furniture provides strong visual anchors. |

---

## 🎨 Nerfstudio Benchmark Integration & Multi-View Renders

To demonstrate universal capture generalization across diverse real environments beyond our local captures, Namma Space integrates with official **Nerfstudio** datasets (such as the standard `poster` benchmark):

- **Data Source**: Official Nerfstudio benchmark capture with 226 registered camera poses (`transforms.json` & COLMAP sparse calibration).
- **Point Cloud & Trajectory**: 12,977 calibrated 3D points rendered as volumetric octahedra alongside a 226-camera orbital trajectory dome.
- **Gaussian Splatting & Web Delivery**: Converted to 3D Gaussian Splats (`.ply`) and compressed into a 95 KB Supercompressed Optical Gaussian (`.sog`) bundle via `@playcanvas/splat-transform`.
- **High-Resolution Renders**: Pre-rendered camera trajectories and snapshots generated directly with `splat-transform` rasterization for immediate inspection and demo playback.
- **Interactive Walkthrough**: Accessible directly in the viewer via the scene dropdown or [**?scene=nerfstudio**](https://namma-space-studio.vercel.app/?scene=nerfstudio).

To regenerate or convert custom Nerfstudio datasets into Namma Space scene bundles:
```bash
# Ingest and build a Nerfstudio digital twin bundle
python3 apps/studio/scripts/build_nerfstudio_twin.py

# Validate scene compliance
npm --prefix apps/studio run validate:scenes
```

---

## 🧪 Comprehensive Test & Quality Verification

All tests across TypeScript, Vitest, Python, and Playwright E2E are 100% passing:

| Test Suite | Scope | Command | Result |
| :--- | :--- | :--- | :--- |
| **TypeScript Typecheck** | Strict mode static types | `cd apps/studio && npm run typecheck` | **PASSED** (0 errors) |
| **ESLint** | Code quality & style rules | `cd apps/studio && npm run lint` | **PASSED** (0 errors) |
| **Vitest Unit & Integration** | Reducers, stores, pairing, A* | `cd apps/studio && npm test` | **PASSED** (679 / 679 tests) |
| **Python Test Suite** | Observation preprocessing & schemas | `uv run --with pytest python -m pytest tests -q` | **PASSED** (78 / 78 tests) |
| **Scene Bundle Validator** | Manifest, nav-grid & asset hashes | `cd apps/studio && npm run validate:scenes` | **PASSED** (5 / 5 scenes) |
| **Bundle Chunk Budget** | Entry gzip & heavy library chunking | `python3 apps/studio/scripts/check_chunks.py` | **PASSED** (all budgets met) |
| **Playwright Browser E2E** | Full end-to-end user journeys | `cd apps/studio && npm run test:e2e` | **PASSED** (37 / 37 tests) |
| **Full Quality Gate** | 10 automated quality tiers | `python3 apps/studio/scripts/quality_gate.py` | **10 / 10 PASSED** |

---

## 📂 Detailed Documentation Links

- **Comprehensive Audit**: [`submission/FINAL_INTEGRATION_AUDIT.md`](submission/FINAL_INTEGRATION_AUDIT.md)
- **Subsystem Integration Matrix**: [`logs/final-integration/INTEGRATION_MATRIX.md`](logs/final-integration/INTEGRATION_MATRIX.md)
- **Branch Investigation Audit**: [`logs/final-integration/BRANCH_AUDIT.md`](logs/final-integration/BRANCH_AUDIT.md)
- **Architectural Decisions**: [`logs/final-integration/DECISIONS.md`](logs/final-integration/DECISIONS.md)
- **Disclosed Limitations & Blockers**: [`logs/final-integration/BLOCKERS.md`](logs/final-integration/BLOCKERS.md)
- **Standard Operating Procedure for Capture**: [`docs/SOP.md`](docs/SOP.md)
- **Developer Handoff**: [`logs/final-integration/HANDOFF.md`](logs/final-integration/HANDOFF.md)
