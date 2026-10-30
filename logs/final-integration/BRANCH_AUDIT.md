# Repository & Branch Audit

## 1. Scope of Investigation
To ensure zero lost work and a defensible engineering synthesis, all active and historical remote and local branches were investigated:
1. `ashwinwork` / `origin/ashwinwork` (Commit `baa3888` and history)
2. `origin/ujesha/viewer-unify` & `origin/ujesha/studio-splat-spike`
3. `origin/nks` (Nilesh's reconstruction line)
4. `origin/integration/round1` & `origin/round1-fixes`
5. `main` / `origin/main`

## 2. Findings by Branch

### `ashwinwork` (The Core Monorepo)
- **Architecture**: Complete React 19 + TypeScript + Vite monorepo in `apps/studio/`.
- **Features**:
  - 3-workspace tabbed shell: Capture Studio (01), Spatial Viewer (02), Live Scan (03).
  - Multi-image drag-and-drop ingest with viewpoint classification and SHA-256 content addressing.
  - IndexedDB durable persistence (`idb`) with in-memory fallback.
  - ZIP capture bundle export conforming to strict capture schemas.
  - PlayCanvas engine integration with first-person WASD movement, mouse look, and pointer lock.
  - A* pathfinding over 2D navigation grid with POI search and jump-to-view.
  - WebRTC signaling and data channel camera pairing for phone-to-desktop capture.
  - Quality gate script (`scripts/quality_gate.py`) verifying 10 distinct quality tiers.
- **Verdict**: The most complete, robust, tested, and structurally sound codebase. Selected as the primary integration baseline.

### `origin/ujesha/viewer-unify` & `origin/ujesha/studio-splat-spike`
- **Features**:
  - Investigation into loading 3D Gaussian Splats (`.sog` and `.ply`).
  - Implemented PlayCanvas `gsplat` component loader and tested wall-sliding sub-stepping.
  - Bundled a working 718 KB `synthetic_room.sog` asset.
- **Conflict**: Independent experimental viewer (`viewer/`) built with React Three Fiber / Spark conflicted with the monorepo architecture and had broken Hugging Face asset references (`REPLACE_HF_USER`).
- **Verdict**: Integrated the `synthetic_room.sog` asset into `apps/studio/public/scenes/splat-fixture/` and added native `.sog` / `.ply` Gaussian Splat rendering directly into the PlayCanvas engine. This unifies splat rendering within the main application.

### `origin/nks` (Nilesh's Reconstruction Line)
- **Features**:
  - 5-stage reconstruction pipeline scripts: `run_pipeline.py`, `ply_to_glb.py`, `make_nav_grid.py`, `make_pois.py`.
  - SfM, dense meshing, Poisson reconstruction, and POI synthesis.
- **Verdict**: Already cleanly integrated into `apps/studio/scripts/`. Documented honest boundaries: in-browser bundle prep vs external GPU worker.

### `origin/integration/round1`
- **Features**:
  - Monorepo structure definitions, build script hardening, documentation, and technical abstracts.
- **Verdict**: Retained and aligned with the single root `vercel.json` deployment targeting `apps/studio/dist`.
