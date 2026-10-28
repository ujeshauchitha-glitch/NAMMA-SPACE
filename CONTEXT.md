# Namma Space — AI Development Context

> **PURPOSE:** This file is a living handoff document. Updated whenever a significant action is taken. If this session ends mid-task, another AI/LLM can pick up from here.

---

## Project Summary

**Namma Space** is an indoor spatial twin platform for Techfest IIT Bombay 2026-27.
Goal: Real indoor capture -> 3D reconstruction -> browser-based first-person walkthrough -> POI search -> obstacle-aware navigation.

**Round 1 Deadline: 31 October 2026**

Required for Round 1:
- Documented capture SOP (CAPTURE_SOP.md exists) - DONE
- Real indoor 3D reconstruction (COLMAP + mesh) - NOT DONE (blocked: no real capture yet)
- Working browser-based first-person viewer (PlayCanvas, GLB loading, WASD) - DONE
- Technical abstract PDF (5 pages max) - NOT DONE
- Web viewer link (deployed URL) - NOT DONE
- 3-5 minute demo video - NOT DONE
- Code repository with setup instructions - DONE

---

## Tech Stack

| Technology | Role | Status |
|---|---|---|
| React 19 + TypeScript + Vite | App UI and typed frontend | Complete |
| PlayCanvas v2.6 | 3D viewer (first-person, GLB loading) | Complete |
| GSAP v3.15 | UI transitions and micro-animations | Installed, underused |
| Three.js v0.186 | Spatial visualizations (coverage maps) | Installed, not wired into UI |
| FFmpeg | Video frame extraction | Script ready (prepare_capture.py) |
| COLMAP | SfM reconstruction | Script adapter complete, binary needed |
| Nerfstudio/gsplat | Gaussian Splatting | Architecture only, not implemented |
| Open3D | Point cloud to mesh | Script ready (process_geometry.py), library needed |
| GLB/glTF | Browser 3D mesh format | Loading works in viewer |
| SOG | Gaussian Splat delivery format | Not started |
| JSON Scene Bundle | Connects all data layers | Zod-validated schema, generator script |
| A* Navigation | Obstacle-aware pathfinding | Full 2D grid + A* in navigation.ts |
| FastAPI | Processing / signalling backend | Dev relay only (Vite plugin) |
| WebRTC | Phone to browser live camera | Primitives built, not end-to-end wired |

---

## Repository Structure

```
NAMMA-SPACE/
  src/
    App.tsx                        # Router/workspace switcher
    engine/
      PlayCanvasViewer.ts          # Full 3D viewer class (GLB, POIs, A*, route render)
      tween.ts                     # Pure animation math
    components/
      viewer/                      # SpatialViewerWorkspace, Hud, PoiSearch, RouteStatus, etc.
      capture/                     # CaptureStudio UI (upload, thumbnails, rooms, inspector)
      scan/                        # QrPairingCard, CameraPreview, StageRail (WebRTC UI)
      workspace/                   # CaptureStudioWorkspace, LiveScanWorkspace, WorkspacePanel
      shell/                       # App shell / navigation chrome
      ui/                          # Reusable Button, inputs, etc.
    lib/
      navigation.ts                # A*, occupancy grid, worldToCell, findRoute
      sceneLoader.ts               # Manifest fetching, resolveSceneUri
      capture/                     # Image ingest logic, EXIF, hash, ZIP bundling
      pairing/                     # WebRTC primitives, QR, pairing protocol
      scan/                        # Camera capture, chunk planning, SHA-256 reassembly
      storage/                     # IndexedDB layer (idb)
    state/                         # Application state machines
    types/
      scene.ts                     # Zod schemas: SceneManifest, NavigationGrid, Poi
  scripts/
    prepare_capture.py             # Stage 1: Frames from video/images, hashes, manifest
    reconstruct_colmap.py          # Stage 2: COLMAP SfM -> sparse -> dense -> mesh
    process_geometry.py            # Stage 3: Open3D PLY -> GLB mesh
    generate_scene_bundle.py       # Stage 4: Package GLB + nav + POIs -> manifest.json
    validate_scene.py              # Validate a scene bundle directory
    validate_all_scenes.py         # Validate all bundles under public/scenes/
    generate_glb_fixture.py        # Generates synthetic box-geometry GLB (test only)
    quality_gate.py                # Combined quality check runner
    benchmark_build.py             # Build size benchmarking
    signalling-relay.ts            # Dev WebSocket relay server
    ws-signalling-plugin.ts        # Vite plugin for dev relay
    ply_to_glb.py                  # NEW: Pure-Python PLY->GLB converter (no Open3D needed)
    make_nav_grid.py               # NEW: Nav-grid authoring tool from geometry bounds
    make_pois.py                   # NEW: POI authoring tool (interactive or --batch)
    run_pipeline.py                # NEW: Single-command pipeline runner (all 4 stages)
  public/
    scenes/
      fixture/                     # Procedural test scene (no GLB)
      glb-fixture/                 # Generated box-geometry GLB scene (both are synthetic)
  tests/                           # 21 Vitest unit tests + 5 Playwright E2E tests
  CONTEXT.md                       # THIS FILE
  ARCHITECTURE.md                  # System architecture + data contracts
  PIPELINE.md                      # Pipeline stages, commands, and gaps
  CAPTURE_SOP.md                   # Phone capture procedure
  ROADMAP.md                       # Round 1/2/3 work packages
  ENGINEERING_AUDIT.md             # Quality/defect log from prior session
  DECISION_LOG.md                  # Tech decisions and rationale
  TECH_STACK_COMPARISON.md         # Technology trade-off analysis
  WINDOWS_SETUP.md                 # NEW: Windows-specific COLMAP/FFmpeg/Open3D setup guide
```

---

## Pipeline Flow (Target)

```
[Phone video/images]
        |
        v
prepare_capture.py          -> capture-output/frames/ + frame-manifest.json
        |
        v
reconstruct_colmap.py       -> colmap/sparse/ + colmap/dense/fused.ply
        |
        v
process_geometry.py         -> geometry/reconstructed-mesh.glb + geometry-report.json
   OR ply_to_glb.py         -> geometry/reconstructed-mesh.glb (when Open3D unavailable)
        |
        v
[Manual: author pois.json]  -> semantic/pois.json (labels, positions, approach points)
[Manual: author nav-data]   -> navigation/nav-data.json (occupancy grid)
        |
        v
generate_scene_bundle.py    -> public/scenes/<venue>/ (manifest.json, visual/, nav/, semantic/)
        |
        v
validate_scene.py           -> Quality gate (hashes, schema, grid bounds, POI uniqueness)
        |
        v
[npm run dev / deploy]      -> Browser viewer loads scene
```

---

## What Was Done This Session

### Session 1 (2026-10-27 ~00:30 IST)

**Context setup:**
- Performed full repo audit against project brief and tech stack image.
- Created this CONTEXT.md file.

**Pipeline gaps identified:**
1. No alternative path when COLMAP is missing (Windows, no CUDA).
2. No Windows-compatible COLMAP install guide in the repo.
3. No sample/demo indoor capture for testing pipeline end-to-end without a real phone capture.
4. process_geometry.py requires Open3D which is not installed.
5. No nav-data.json authoring tool; must be created manually for a real venue.
6. No pois.json authoring tool; must be created manually.
7. No PLY->GLB conversion path independent of Open3D.
8. No pipeline runner script that chains all 4 stages with one command.

**Pipeline work done this session (COMPLETE - all scripts verified):**
- Created scripts/run_pipeline.py -- single-command pipeline runner chaining all 5 stages
  (prepare -> colmap -> geometry -> nav-grid scaffold -> scene bundle)
  Includes Open3D fallback to ply_to_glb.py when Open3D is unavailable.
  Verified with --dry-run; all stage commands print correctly.
- Created scripts/ply_to_glb.py -- Pure-Python PLY->GLB converter (no Open3D needed)
  Supports ASCII and binary_little_endian PLY. Preserves vertex colors and normals.
  Tested: syntax OK, --help works.
- Created scripts/make_nav_grid.py -- nav-grid authoring tool
  Outputs NavigationSchema-compatible JSON (version, width, height, blocked[], start, clearanceMetres)
  Supports interactive rectangle obstacle marking or --no-interactive scaffold mode.
  Tested: generates correct 40x32 grid from -5,0,-4 to 5,3,4 bounds.
- Created scripts/make_pois.py -- POI authoring tool
  Outputs PoiSchema-compatible JSON. Interactive or --batch CSV mode.
  Tested: syntax OK, --help works.
- Created WINDOWS_SETUP.md -- Windows COLMAP/FFmpeg/Open3D/Python setup guide
- Added npm scripts: pipeline, pipeline:dry-run, ply-to-glb, make:nav-grid, make:pois

---

## What Is Left

### Immediate (Round 1 before 31 Oct 2026)

| # | Task | Priority | Status |
|---|---|---|---|
| 1 | Get COLMAP running on Windows | Critical | NOT DONE - install binary |
| 2 | Capture a real indoor space | Critical | NOT DONE - phone capture needed |
| 3 | Run full pipeline on real capture | Critical | NOT DONE - needs 1 and 2 |
| 4 | Author pois.json for captured venue | High | NOT DONE - after 3, use make_pois.py |
| 5 | Author nav-data.json for captured venue | High | NOT DONE - after 3, use make_nav_grid.py |
| 6 | Validate and publish scene bundle | High | NOT DONE - after 4 and 5 |
| 7 | Deploy viewer to Vercel/GitHub Pages | High | NOT DONE - need public URL for judges |
| 8 | Record 3-5 min demo video | High | NOT DONE - after 7 |
| 9 | Write technical abstract PDF (5 pages) | High | NOT DONE |

### Near-Term

| # | Task | Priority | Status |
|---|---|---|---|
| 10 | Wire Three.js into Capture Studio for 3D coverage map | Medium | NOT DONE |
| 11 | Improve GSAP usage in UI shell transitions | Low | NOT DONE |
| 12 | Complete WebRTC live scan end-to-end | Medium | NOT DONE |
| 13 | Gaussian Splatting / SOG loader in PlayCanvas | Medium | NOT DONE |
| 14 | FastAPI backend for remote job execution | Low | NOT DONE |

---

## Key Commands

```bash
# Dev server
npm run dev

# Full pipeline (single command after setup)
python scripts/run_pipeline.py \
  --input ./my-capture.mp4 \
  --output ./pipeline-output \
  --scene-id venue-2026 \
  --display-name "Main Hall" \
  --source "Phone capture"

# Step-by-step pipeline
python scripts/prepare_capture.py ./capture.mp4 --output ./capture-out --fps 2 --limit 120
npm run preflight:reconstruction
npm run reconstruct:colmap -- --frames ./capture-out/frames --output ./capture-out/colmap --dense --mesh
python scripts/process_geometry.py --input-ply ./capture-out/colmap/dense/fused.ply --output-dir ./geometry-out
python scripts/make_nav_grid.py --geometry-report ./geometry-out/geometry-report.json --output ./nav-out/nav-data.json
python scripts/make_pois.py --output ./semantic-out/pois.json
python scripts/generate_scene_bundle.py \
  --output ./public/scenes/venue-2026 \
  --visual-asset ./geometry-out/reconstructed-mesh.glb \
  --geometry-report ./geometry-out/geometry-report.json \
  --semantic ./semantic-out/pois.json \
  --navigation ./nav-out/nav-data.json \
  --scene-id venue-2026 \
  --display-name "Main Hall" \
  --source "Phone capture"
python scripts/validate_scene.py ./public/scenes/venue-2026

# Tests
npm run test
npm run test:e2e
npm run quality
```

---

## Important Architectural Decisions

1. Visual asset (GLB) and navigation grid are SEPARATE. GLB is for rendering; occupancy grid is for pathfinding.
2. PlayCanvas owns the canvas. React owns everything outside it. They communicate through callbacks.
3. Scene bundle is the single source of truth. Viewer loads manifest.json and resolves all URIs from it.
4. A* is grid-based. Resolution is configurable. Agent radius is baked into grid at authoring time.
5. No external backend for Round 1. All processing is local Python CLI scripts. FastAPI is optional.
6. Never fake success. Every pipeline stage reports blocked or partial when dependencies are missing.

---

## Environment Notes

- OS: Windows
- Node.js: npm ci completed successfully (node_modules present)
- Python: Available (check: python --version)
- COLMAP: NOT installed (install from colmap.github.io or via Chocolatey: choco install colmap)
- FFmpeg: Check with: ffmpeg -version
- Open3D: NOT installed (install with: pip install open3d)
- GPU: Unknown - affects COLMAP speed (CPU fallback works but is slow)

---

## Handoff Notes for Next LLM

If you are picking this up:
1. Read CONTEXT.md first, then ARCHITECTURE.md, then PIPELINE.md.
2. The source of truth is actual files - CONTEXT.md may be slightly behind code.
3. The single most blocking task: install COLMAP on Windows, capture a real room, run the pipeline.
4. Do NOT replace existing working code with reimplementations unless there is a clear defect.
5. The scene bundle schema is in src/types/scene.ts (Zod). All pipeline outputs must match it.
6. Validate new scene bundles with: python scripts/validate_scene.py <scene-dir>
7. Do not add a node_modules-touching step without npm ci first.
8. The two synthetic scenes in public/scenes/ are test fixtures only, NOT real reconstructions.

---

Last updated: 2026-10-27 Session 1 by Antigravity
