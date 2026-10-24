# Namma Space

Namma Space is a browser-first spatial twin prototype for Techfest 2026–27 at IIT Bombay. It turns a scene bundle into an interactive first-person environment with POI search, verified A* routes, and an honest capture-to-processing boundary.

The current prototype includes a **synthetic demonstration fixture**, not a smartphone reconstruction. The fixture uses the same versioned manifest, navigation grid, POI data, quality report, and viewer contracts intended for captured venues.

## Run it

Requirements:

- Node.js 20+ and npm.
- Python 3.10+ for the CPU-safe capture preparation and validation commands.
- A WebGL 2-capable browser.

```bash
npm install
npx playwright install chromium
npm run dev
```

Open the printed local URL, select a destination, plot a route, or enter the walkthrough with the mouse and `WASD`. Press `Escape` to return to the surrounding interface.

For a production-build smoke test:

```bash
npm run build
npm run preview
```

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run validate:scene
npm run validate:scenes
npm run preflight:reconstruction
npm run benchmark:build
npm run quality
```

`npm run quality` is the single local gate. It runs core checks, records the
bundle scopes, runs browser E2E, and prints `PASS`, `FAIL`, or `BLOCKED` for
environment-dependent reconstruction prerequisites. A blocked COLMAP/CUDA
preflight does not hide a failing application test and does not prevent the
fixture gate from completing.

## Current features

- PlayCanvas Engine 2.x rendering a responsive synthetic indoor environment.
- Two manifest-driven fixture scenes: a procedural fixture and a generated, genuine GLB asset fixture.
- First-person camera with WASD/arrow movement, mouse look, pointer lock, reset, and grid-backed movement limits.
- Versioned scene manifest validated with Zod before dependent data is used.
- POI and room search with aliases, category labels, confidence, selection, jump-to, and approach points.
- Deterministic A* routing over a verified occupancy grid with diagonal corner-cut prevention.
- Route visualization built from the actual returned path.
- Scene provenance, quality state, navigation-grid metadata, and synthetic-fixture disclosure.
- Browser-side capture staging for video/photo selection; long-running reconstruction is intentionally not run in the browser.
- CPU-safe Python frame preparation and scene validation commands.
- COLMAP sparse/dense stage adapter with explicit partial/blocked reports when external tools are unavailable.
- Playwright Chromium E2E coverage for startup, GLB loading, search/selection, route planning, jump/reset, media staging, scene recovery, and narrow layout.

## Capture preparation

Prepare an image folder:

```bash
python3 scripts/prepare_capture.py ./my-capture-photos --output ./capture-output
```

Prepare a video when `ffmpeg` is installed:

```bash
python3 scripts/prepare_capture.py ./capture.mp4 --output ./capture-output --fps 2 --limit 120
```

This produces a provenance-preserving `frame-manifest.json`. It does **not** claim to have reconstructed a scene. COLMAP, GPU reconstruction, geometry extraction, and scene publishing remain separate pipeline stages; see [`PIPELINE.md`](./PIPELINE.md).

Generate the local GLB fixture reproducibly:

```bash
python3 scripts/generate_glb_fixture.py \
  --output public/scenes/glb-fixture/visual/architectural-fixture.glb
```

## COLMAP boundary

Run the environment preflight before attempting reconstruction:

```bash
npm run preflight:reconstruction
```

When COLMAP is installed, run the sparse baseline against prepared frames:

```bash
npm run reconstruct:colmap -- \
  --frames ./capture-output/frames \
  --output ./capture-output/colmap
```

The adapter writes `reconstruction-report.json`, a COLMAP database, and a sparse model. It stops with an explicit blocked status when COLMAP is unavailable. It does not publish a scene or pretend that sparse cameras are already a browser-ready visual or collision asset.

When the supported COLMAP installation has dense stereo available:

```bash
npm run reconstruct:colmap -- \
  --frames ./capture-output/frames \
  --output ./capture-output/colmap \
  --dense
```

Add `--mesh` to run COLMAP's optional surface mesher after dense fusion; `--simplify` and `--texture` are available as separate optional stages when supported by the installed COLMAP build. For the Open3D route, invoke `scripts/process_geometry.py` against `dense/fused.ply`; it performs filtering, Poisson reconstruction, PLY export, and generated untextured GLB export. Sparse and dense outputs remain valid if a later mesh stage is blocked.

For a generated captured-scene bundle after a genuine GLB and geometry report exist:

```bash
python3 scripts/generate_scene_bundle.py \
  --output ./capture-output/scene \
  --visual-asset ./capture-output/geometry/reconstructed-mesh.glb \
  --geometry-report ./capture-output/geometry/geometry-report.json \
  --semantic ./capture-output/pois.json \
  --navigation ./capture-output/navigation/nav-data.json \
  --frame-manifest ./capture-output/frame-manifest.json \
  --processing-report ./capture-output/colmap/reconstruction-report.json \
  --scene-id amber-hall-capture \
  --display-name "Amber Hall capture" \
  --source "consented smartphone capture" \
  --scale-status estimated
python3 scripts/validate_scene.py ./capture-output/scene
```

## Scene bundle

The fixture lives at [`public/scenes/fixture`](./public/scenes/fixture):

```text
public/scenes/fixture/
├── manifest.json
├── navigation/nav-data.json
├── quality/report.json
└── semantic/pois.json
```

The manifest supports procedural, GLB/glTF, and future SOG visual asset references. The viewer currently renders the procedural fixture through PlayCanvas and keeps collision/navigation data separate. A captured bundle can replace the visual branch without rewriting search or A*.

## Architecture

```text
capture media → frame manifest → reconstruction adapter → visual asset
                                  ├→ explicit geometry → walkable grid → A*
                                  └→ semantic POIs → browser scene bundle
```

See:

- [`PROJECT_SCOPE.md`](./PROJECT_SCOPE.md)
- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`TECH_STACK_COMPARISON.md`](./TECH_STACK_COMPARISON.md)
- [`ROADMAP.md`](./ROADMAP.md)
- [`DECISION_LOG.md`](./DECISION_LOG.md)
- [`CAPTURE_SOP.md`](./CAPTURE_SOP.md)
- [`PIPELINE.md`](./PIPELINE.md)
- [`VALIDATION.md`](./VALIDATION.md)

## Limitations

- The current visible scene is synthetic and explicitly labelled as such.
- No real smartphone capture was processed in this environment because the workspace has no sample media and no COLMAP executable.
- The browser viewer loads the generated architectural GLB fixture through the manifest-driven path; it is synthetic geometry and not reconstruction output.
- The generated GLB fixture loads through the manifest-driven path; it is synthetic geometry and not reconstruction output.
- PlayCanvas primitive collision is represented by the same verified navigation grid for fixture mode; a reconstructed collision GLB must be added for real venues.
- There is no backend or GPU worker yet. Missing reconstruction dependencies are reported by the CLI rather than hidden behind fake success.
- Dense reconstruction and both COLMAP/Open3D mesh-export routes are implemented as optional adapter stages but remain blocked until COLMAP/Open3D and real capture data are supplied.
- The reconstruction adapter is implemented for COLMAP's sparse stages, but COLMAP is not available in the current environment so no real sparse model has been generated.
- AR, automatic semantic extraction, multi-floor routing, and hosted deployment remain future work.
