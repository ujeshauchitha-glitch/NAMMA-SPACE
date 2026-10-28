# Capture-to-scene pipeline

## Current implemented stages

### 1. Input preparation

`prepare_capture.py` accepts a studio bundle ZIP, a video, or an image directory, validates extensions and limits, extracts/samples frames, computes hashes, and writes a `frame-manifest.json`.

```bash
python3 scripts/prepare_capture.py ./capture.mp4 --output ./capture-output --fps 2 --limit 120
python3 scripts/prepare_capture.py ./photos --output ./capture-output
python3 scripts/prepare_capture.py ./bundle.zip --output ./capture-output   # ZIP exported by Capture Studio (T13)
```

The video route requires `ffmpeg` on `PATH`. The image-folder and bundle-ZIP routes are CPU-only and use Python standard-library file operations (the ZIP route verifies every manifest digest before extracting a deterministic flat `frames/`, commit `6a7654a`; round-trip covered by vitest `tests/prepare-capture-zip.test.ts`). The command reports missing dependencies and never labels frame preparation as reconstruction.

### 2. Reconstruction adapter boundary

The intended interface is:

```text
FrameSet + ReconstructionConfig → ReconstructionResult
```

The first production adapter should invoke COLMAP in an isolated worker/environment and preserve its camera/geometry outputs. VGGT and AMB3R can later implement the same boundary. As of 2026-10-29 this environment **does** have COLMAP 4.2.1 (Homebrew, CPU-only) and real photo captures under `work/captures/` (gitignored): the adapter has run over them and failed honestly at the SfM registration gate — 57% of a 70-photo set registered, split across two disconnected models, against a ≥60% single-model gate (`logs/round1-rescue/BLOCKERS.md` BLK-001, re-shoot required per the capture SOP). No successful real reconstruction is claimed.

The implemented COLMAP boundary is:

```bash
npm run preflight:reconstruction
npm run reconstruct:colmap -- --frames ./capture-output/frames --output ./capture-output/colmap
```

It runs feature extraction, exhaustive matching, and sparse mapping with GPU SIFT/matching disabled for a conservative CPU-compatible baseline. Each stage records its command, exit code, duration, stdout/stderr tail, and timestamp in `reconstruction-report.json`. If COLMAP is missing, the command writes a blocked report instead of returning a fake success.

Optional dense stages are implemented behind `--dense`:

```text
image_undistorter → patch_match_stereo → stereo_fusion → fused.ply
```

The adapter checks for a complete sparse model (`cameras.bin`, `images.bin`, `points3D.bin`) before starting dense processing and checks that the expected dense directories and non-empty `fused.ply` exist after each stage. `--mesh` invokes a supported COLMAP surface mesher (`poisson_mesher`, `delaunay_mesher`, or `advancing_front_mesher`) and validates the resulting PLY. Optional `--simplify` and `--texture` stages invoke COLMAP's mesh simplifier and texture baker when the installed build provides them. The separate `scripts/process_geometry.py` route remains available when Open3D is installed; it filters points, estimates normals, performs Poisson reconstruction, and exports a genuine untextured GLB. Every subprocess record includes the command, return code, duration, output checks, stdout/stderr tails, and status. Sparse results are preserved if a later stage fails.

### 3. Visual branch

The intended visual outputs are a GLB/glTF fallback and, where tested, a Gaussian Splat/SOG asset. Browser delivery must treat visual assets as separate from collision and navigation data. The repository now includes both a procedural fixture and a real generated GLB fixture so the manifest-driven asset path is exercised without pretending either is a phone reconstruction.

### 4. Geometry and navigation branch

Reconstruction geometry should be simplified into a collision-ready mesh and/or floor-aligned occupancy grid. The current fixture includes a verified `24 × 18` x-z occupancy grid with blocked furniture and wall cells. A* returns cells and world coordinates, and the viewer renders the returned route.

### 5. Semantics

The initial POI store is versioned JSON. Each POI has a stable id, label, category, aliases, world-space position, approach point, confidence, and provenance. Automatic object/room extraction is not currently enabled.

### 6. Validation and publication

```bash
npm run validate:scene
python3 scripts/validate_scene.py public/scenes/fixture
```

Validation checks manifest presence and schema-critical fields, blocks unsafe URIs, verifies referenced data files, checks navigation indices and start cell, checks POI identifier uniqueness, validates quality status, and verifies hashes when assets provide them. Since 2026-10-29 (commit `d4acf04`) it also enforces the tightened manifest contract — identity-only `worldFromReconstruction`, null-only `collisionAsset`, bundle-relative POSIX URIs, sha256 format — with the same messages the browser's zod schema produces, so neither side can accept a bundle the other rejects.

When real visual and geometry outputs exist, `scripts/generate_scene_bundle.py` copies only those artifacts into a versioned bundle, derives bounds from the geometry report, records frame and processing provenance, hashes the GLB, and marks a bundle `visual_ready` when trusted navigation is absent. Supplying navigation data produces a validated navigation-capable bundle; the generator never fabricates a grid.

Future publishing must use temporary versioned outputs and atomically promote only bundles that pass validation. A failed job must not replace the last-known-good scene.

## What the Capture Studio export contains (staged, not reconstructed)

The studio's `Export bundle` button (`src/lib/capture/exportBundle.ts`, T13) writes a ZIP with **exactly two kinds of members**:

- `manifest.json` — rooms, view groups, and image metadata with **sha256 digests recomputed from the bytes actually written**.
- `images/<sha256>.jpg` — the staged frames themselves.

It contains **no poses, no camera intrinsics, no geometry, no navigation, and no room-scale claim** — no reconstruction has run at export time. The UI copy says so plainly: *"Prepared capture — staged frames and their manifest only."* (`EXPORT_COPY`, grep-verified by `tests/bundle-integrity.test.ts` so marketing wording cannot creep in). Archive ordering and mtimes are fixed, so the same input always produces a byte-identical ZIP.

The hand-off to reconstruction is step 1 above: `prepare_capture.py bundle.zip` verifies the digests and flattens the frames into `frames/`; every claim about the space is made later, by the CLI stages, or not at all.

## Missing external stages

- COLMAP 4.2.1 is installed (Homebrew, **CPU-only** build — no CUDA), so sparse SfM runs here, but dense stereo/GPU stages do not: `nvidia-smi` is absent on this machine.
- `ffmpeg` is installed at `/opt/homebrew/bin/ffmpeg`, so video frame extraction is available.
- Real photo captures exist under `work/captures/` (gitignored) and have been run; they are blocked at the SfM gate (BLK-001 above) pending a re-shoot, so no real reconstruction has completed.
- Open3D is not installed in the current environment (verified on both `python3` and `.venv/bin/python`), so point-cloud-to-mesh processing is dependency-blocked.
- Nerfstudio/gsplat is not installed (verified: `ModuleNotFoundError` on both interpreters).
- VGGT and AMB3R are not installed and no checkpoints were downloaded.
- No GPU worker or FastAPI service has been added yet.

These are honest environment findings, not hidden fallbacks. The browser fixture and tests remain runnable without them.
