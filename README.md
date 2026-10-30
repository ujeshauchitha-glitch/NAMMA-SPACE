# Namma Space

> **Turn physical spaces into navigable digital environments.**
> Unified Product Integration · Release Branch: `finalashwinintegration`

Namma Space is an integrated spatial twin platform that converts ordinary smartphone photographs, recorded video, or live scans into navigable digital environments with verified walkable navigation layers, points-of-interest (POI) search, and photorealistic 3D visual representations.

---

## The Public User Experience

When you open Namma Space, you are guided through one cohesive workflow:

1. **Explore a space**: Open an available digital twin (`The Amber Hall` procedural venue, `The Amber Hall` GLB textured mesh, or `Synthetic Splat fixture` SOG 3D Gaussian Splat).
2. **Create a space**: Start with photographs, smartphone video, or live camera streaming in Capture Studio.
3. **How to get started**:
   - **Step 1 — Create a project & room**: Define the space and initial viewpoints.
   - **Step 2 — Upload or capture**: Multi-image drag-and-drop, MP4/MOV video, or phone pairing.
   - **Step 3 — Review and prepare observations**: Automatic validation, SHA-256 hashing, and observation manifest generation.
   - **Step 4 — Run supported reconstruction**: COLMAP camera estimation, dense meshing, Gaussian Splatting, and walkable grid synthesis.
   - **Step 5 — Explore the generated scene**: First-person walkthrough, 8-directional A* pathfinding, and POI search.

---

## Unified System Architecture

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

| Subsystem | Technology | Responsibility |
| :--- | :--- | :--- |
| **Shell & State** | React 19, TypeScript, Vite | Tabbed workspace navigation, polite live regions, and IndexedDB persistence. |
| **Capture Studio** | Web APIs, `fflate`, WebCrypto | Client-side drag-and-drop ingest, viewpoint grouping, ZIP bundle packaging. |
| **Observation Preprocessing** | Python 3.13+, `ffmpeg` | Strict frame sampling, blur and coverage validation, timestamp preservation. |
| **Spatial 3D Engine** | PlayCanvas (`playcanvas`), WebGL | Unified rendering for procedural rooms, GLB meshes, and SOG Gaussian splats. |
| **Navigation & Search** | TypeScript, A* Algorithm | 8-directional obstacle avoidance, Euclidean heuristic, POI approach routing. |
| **Camera Pairing** | WebRTC DataChannels, QR | Direct browser-to-browser frame transfer with verifiable SHA-256 chunk acks. |
| **Data Contracts** | Zod, Python Schemas | Canonical JSON schema contracts for manifests, navigation grids, and POI indexes. |

---

## Test & Validation Verification

All automated tests and quality gates pass with zero regressions on branch `finalashwinintegration`:

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

## Quickstart & Local Setup

### 1. Prerequisites
- **Node.js**: 20+ (tested on Node 26.3.1 / npm 12.0.1)
- **Python**: 3.13+ (tested on 3.15.2 with `uv`)
- **FFmpeg**: Required for video frame extraction (`brew install ffmpeg`)
- **COLMAP**: 4.2.1+ for local Structure-from-Motion (`brew install colmap`)

### 2. Development Startup
```bash
# Clone and checkout integration branch
git clone https://github.com/ujeshauchitha-glitch/NAMMA-SPACE.git
cd NAMMA-SPACE
git checkout finalashwinintegration

# Install frontend dependencies
cd apps/studio
npm ci

# Launch local development server
npm run dev
# Open http://localhost:5173
```

To enable local phone-to-desktop WebRTC camera pairing:
```bash
npm run dev:lan
```

### 3. Production Build
```bash
cd apps/studio
npm run build
npm run preview
```

---

## Vercel Deployment

The project is configured for single-repository static hosting on Vercel via the root `vercel.json`:
- **Build Command**: `cd apps/studio && npm run build`
- **Output Directory**: `apps/studio/dist`
- **Framework Preset**: `Vite`
- **Routing**: Static asset caching on `/scenes/*` (`Cache-Control: public, max-age=31536000, immutable`) and SPA rewrite fallback to `/index.html`.

---

## Disclosed Limitations & Hardware Boundaries

- **BLK-001 (Reconstruction Worker)**: Dense 3D Gaussian Splatting (Brush) and high-density Structure-from-Motion (COLMAP) require external GPU compute with CUDA or Apple Metal. In-browser preprocessing honestly packages captures without faking asynchronous server-side execution. The application ships with verified synthetic fixtures (`The Amber Hall` and `Synthetic Splat fixture`) so every feature of the viewer, POI search, and A* navigation is fully functional without external GPU compute.
- **BLK-002 (Live Scan Relay)**: The WebSocket signaling relay used for mobile device pairing runs in local development mode (`npm run dev:lan`). On hosted environments, the tab is transparently labeled `Live Scan · dev only`.

---

## Project Artifacts & Logs

- Comprehensive Audit: [`submission/FINAL_INTEGRATION_AUDIT.md`](submission/FINAL_INTEGRATION_AUDIT.md)
- Subsystem Selection Matrix: [`logs/final-integration/INTEGRATION_MATRIX.md`](logs/final-integration/INTEGRATION_MATRIX.md)
- Branch Audit: [`logs/final-integration/BRANCH_AUDIT.md`](logs/final-integration/BRANCH_AUDIT.md)
- Engineering Decisions: [`logs/final-integration/DECISIONS.md`](logs/final-integration/DECISIONS.md)
- Developer Handoff: [`logs/final-integration/HANDOFF.md`](logs/final-integration/HANDOFF.md)
- Commands and Tests: [`logs/final-integration/COMMANDS_AND_TESTS.md`](logs/final-integration/COMMANDS_AND_TESTS.md)
