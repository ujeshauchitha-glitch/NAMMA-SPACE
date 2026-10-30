# Namma Space

> **Turn physical spaces into navigable digital environments.**
> Unified Product Integration · Release Branch: `finalashwinintegration`
> Live Public Deployment: [**https://namma-space-studio.vercel.app**](https://namma-space-studio.vercel.app)

Namma Space is an integrated spatial computing platform that converts ordinary smartphone photographs, recorded walkthrough videos, or live camera feeds into navigable 3D digital environments featuring photorealistic Gaussian Splats, verified walkable navigation layers, and point-of-interest (POI) search.

---

## ⚡ Quick Start for Judges (2-Minute Interactive Evaluation)

You can test the entire platform right now in your browser with zero installation:

1. **Open the live application**: [**https://namma-space-studio.vercel.app**](https://namma-space-studio.vercel.app)
2. **Review the Interactive Onboarding**: The 5-step journey will guide you. Click **`? Guide`** in the top navigation bar anytime to reopen it.
3. **Explore 3D Digital Twins (Tab `02 Spatial Viewer`)**:
   - In the top header bar, use the **Scene** dropdown to switch between:
     - `Procedural fixture`: Synthetic architectural room.
     - `Generated GLB fixture`: Textured 3D mesh model with collision boundary.
     - `Synthetic Splat fixture (SOG)`: 718 KB 3D Gaussian Splat model.
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

## 🏗️ System Architecture & Compute Reality

A common pitfall in 3D web applications is pretending that heavy photogrammetry runs inside a browser tab. Namma Space maintains strict engineering integrity by delineating the **Browser Platform** from the **GPU Reconstruction Worker**:

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

### Why the 2-Stage Architecture?
- **Stage 1: Web Frontend (Capture Studio & Viewer on Vercel)**:
  - Handles client-side photo ingestion, video upload, viewpoint organization, blur checking, and bundle export.
  - Hosts the high-performance PlayCanvas 3D spatial viewer, WebGL context, A* pathfinding, and POI search.
  - Vercel Serverless Functions have a 250 MB execution size limit, a 15–60s execution timeout, and **no NVIDIA GPUs**.
- **Stage 2: Reconstruction Engine (GPU Worker)**:
  - Structure-from-Motion (COLMAP) and 3D Gaussian Splatting (Brush / NeRF) require intensive GPU matrix multiplication (CUDA or high-memory Metal).
  - Preflight checks honestly diagnose the presence of `colmap` and `ffmpeg` without faking reconstruction.

---

## 📹 Direct Video Upload to 3D Digital Twin: How It Works

### Can a user directly upload a smartphone video and get a 3D digital twin?
**Yes!** In production, Namma Space is architected for direct video-to-twin workflows via a cloud GPU worker:

```
[Smartphone Video Upload] 
         │ (.mp4 / .mov)
         ▼
[Direct Cloud Storage (S3 / Cloudflare R2 / GCS)]
         │ Webhook trigger
         ▼
[GPU Worker Pool (Modal / RunPod / AWS EC2 with NVIDIA RTX/A10G)]
         │ 1. FFmpeg: Frame extraction & sampling (2-4 fps)
         │ 2. Blur & Exposure Filter: Discards motion-blurred frames
         │ 3. COLMAP SfM: Solves camera positions & sparse point cloud
         │ 4. Brush 3DGS: Trains 3D Gaussian Splats
         │ 5. SOG Compression: Compresses to web-streamable .sog
         │ 6. Nav Engine: Generates 2D walkable grid & POI approach points
         ▼
[Public Scene URL (`/scenes/<room>/manifest.json`)]
         │ Auto-pushed / Webhook notification
         ▼
[Spatial Viewer Displays Navigable 3D Twin]
```

### Running the Video Worker Locally
If you have a video of a room on your machine:
```bash
# Extract frames, solve camera poses, train the 3D model, and generate nav-grid:
python3 apps/studio/scripts/run_pipeline.py path/to/video.mp4 --title "My Room" --out public/scenes/my_room
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

## 🧪 Comprehensive Test & Quality Verification

All tests across TypeScript, Vitest, Python, and Playwright E2E are 100% passing:

| Test Suite | Scope | Command | Result |
| :--- | :--- | :--- | :--- |
| **TypeScript Typecheck** | Strict mode static types | `cd apps/studio && npm run typecheck` | **PASSED** (0 errors) |
| **ESLint** | Code quality & style rules | `cd apps/studio && npm run lint` | **PASSED** (0 errors) |
| **Vitest Unit & Integration** | Reducers, stores, pairing, A* | `cd apps/studio && npm test` | **PASSED** (679 / 679 tests) |
| **Python Test Suite** | Observation preprocessing & schemas | `uv run --with pytest python -m pytest tests -q` | **PASSED** (78 / 78 tests) |
| **Scene Bundle Validator** | Manifest, nav-grid & asset hashes | `cd apps/studio && npm run validate:scenes` | **PASSED** (3 / 3 scenes) |
| **Bundle Chunk Budget** | Entry gzip & heavy library chunking | `python3 apps/studio/scripts/check_chunks.py` | **PASSED** (all budgets met) |
| **Playwright Browser E2E** | Full end-to-end user journeys | `cd apps/studio && npm run test:e2e` | **PASSED** (37 / 37 tests) |
| **Full Quality Gate** | 10 automated quality tiers | `python3 apps/studio/scripts/quality_gate.py` | **10 / 10 PASSED** |

---

## 💻 Running the Entire Project from Scratch (Zero to Hero)

### 1. Prerequisites
- **Node.js**: v20+ (tested on Node 26.3.1 / npm 12.0.1)
- **Python**: 3.13+ (tested on 3.15.2 with `uv`)
- **FFmpeg**: For video frame extraction (`brew install ffmpeg` on macOS / `apt install ffmpeg` on Linux)
- **COLMAP**: 4.2.1+ for local Structure-from-Motion (`brew install colmap` on macOS)

### 2. Clone and Setup
```bash
# Clone the repository and checkout the verified release branch
git clone https://github.com/ujeshauchitha-glitch/NAMMA-SPACE.git
cd NAMMA-SPACE
git checkout finalashwinintegration

# Install frontend dependencies
cd apps/studio
npm ci
```

### 3. Launch Development Server
```bash
npm run dev
# Open http://localhost:5173
```
To test mobile phone camera pairing over your local WiFi network:
```bash
npm run dev:lan
```

### 4. Execute Full Automated Quality Gate
```bash
python3 scripts/quality_gate.py
```
This single command runs all 10 automated checks (heuristics, types, lint, unit tests, scene validation, build, chunk budgets, reconstruction preflight, and Playwright browser E2E).

---

## 🚢 Production Deployment

The project is deployed on Vercel:
- **Production URL**: [https://namma-space-studio.vercel.app](https://namma-space-studio.vercel.app)
- **Configuration**: Root [`vercel.json`](vercel.json) targeting `apps/studio` with production build output in `apps/studio/dist`.
- **Static Caching**: Immutable headers on `/scenes/*` for lightning-fast asset streaming.

To trigger a manual Vercel deployment:
```bash
cd apps/studio
npx vercel --prod --yes
```

---

## 📂 Detailed Documentation Links

- **Comprehensive Audit**: [`submission/FINAL_INTEGRATION_AUDIT.md`](submission/FINAL_INTEGRATION_AUDIT.md)
- **Subsystem Integration Matrix**: [`logs/final-integration/INTEGRATION_MATRIX.md`](logs/final-integration/INTEGRATION_MATRIX.md)
- **Branch Investigation Audit**: [`logs/final-integration/BRANCH_AUDIT.md`](logs/final-integration/BRANCH_AUDIT.md)
- **Architectural Decisions**: [`logs/final-integration/DECISIONS.md`](logs/final-integration/DECISIONS.md)
- **Disclosed Limitations & Blockers**: [`logs/final-integration/BLOCKERS.md`](logs/final-integration/BLOCKERS.md)
- **Standard Operating Procedure for Capture**: [`docs/SOP.md`](docs/SOP.md)
- **Developer Handoff**: [`logs/final-integration/HANDOFF.md`](logs/final-integration/HANDOFF.md)
