# Validation record

**Record date:** 24 October 2026

## Implemented automated checks

- TypeScript strict type checking.
- ESLint.
- Vitest unit tests for A* routing, blocked and out-of-bounds destinations, world/grid conversion, POI aliases, and deterministic search.
- Python scene-bundle validation.
- Production Vite build.
- Reconstruction preflight and adapter-boundary test.
- Real generated GLB fixture header/hash validation.
- Playwright Chromium browser E2E tests using the local Vite server.
- Dense/mesh subprocess contract test using a controlled fake COLMAP executable; this is not a real reconstruction.

Latest recorded results:

```text
npm run typecheck       PASS
npm run lint            PASS
npm test                PASS — 17 tests
npm run test:e2e        PASS — 6 browser tests
npm run build           PASS — Vite production bundle emitted
npm run validate:scenes PASS — procedural fixture and generated GLB fixture
npm run benchmark:build PASS — 13 artifacts; 2,396,064 bytes / 631,109 gzip bytes
npm run preflight:reconstruction PASS — structured report; COLMAP missing, FFmpeg available, NVIDIA diagnostics optional/missing
npm run quality          PASS — core checks and browser E2E passed; reconstruction preflight BLOCKED on missing COLMAP
```

The build now emits a small initial JavaScript chunk and a lazy PlayCanvas chunk. Current scopes are: initial JavaScript `333,596` bytes / `101,616` gzip; lazy PlayCanvas viewer `2,028,375` bytes / `519,964` gzip; total emitted assets `2,396,064` bytes / `631,109` gzip; generated GLB `13,556` bytes / `1,905` gzip. The initial page scope must not be compared with the total emitted scope as if it were a regression. Vite still warns about the lazy chunk being large.

## Manual browser acceptance checklist

The following must be run against the local Vite server before a Round 1 demo:

- [x] Initial scene manifest, navigation, semantics, and quality data load.
- [x] Synthetic fixture renders in PlayCanvas.
- [ ] `Enter walkthrough` requests pointer lock — manual headed-browser check; headless Chromium does not claim this.
- [ ] WASD/arrow movement updates the coordinate readout — manual headed-browser check requiring canvas focus/pointer lock.
- [ ] `Escape` releases pointer lock while keeping the UI usable — manual headed-browser check.
- [x] Reset returns to the documented start position.
- [x] A* route around fixture obstacles appears after selecting a POI.
- [x] Jump-to moves to the POI approach point and updates status.
- [x] Invalid search produces an empty state and clears the old destination.
- [x] Capture selection validates media types and reports staged files.
- [x] Missing scene data shows a retryable error state.
- [x] The layout remains usable at laptop and narrow viewport widths.

## Current environment evidence

- Node.js and npm are available.
- Python 3.9.6 is available through `python3`.
- FFmpeg is available at `/opt/homebrew/bin/ffmpeg`.
- No `colmap` executable was found during discovery.
- No NVIDIA CUDA utility was found during discovery.
- No real smartphone media is present in the workspace.

Therefore, this environment can validate the CPU-safe fixture and frame-manifest code, but cannot honestly claim a successful real capture-to-reconstruction run yet.

The CPU-safe image-folder ingest path was exercised with a temporary one-file fixture and produced a frame manifest successfully. It was not a real phone image and did not proceed to reconstruction.

The generated GLB fixture was created with `scripts/generate_glb_fixture.py`, has a valid glTF 2.0 header and matching declared file length, and is validated by the scene validator. It is synthetic geometry, not a reconstruction.

Playwright Chromium E2E ran against a fresh Vite server on `127.0.0.1:5183`. It verified synthetic startup, real POI search/click selection, route plotting, jump-to status, invalid-search clearing, file staging, generated GLB loading through `/?scene=glb`, scene switching, reset, missing-manifest recovery, missing-GLB recovery, malformed-manifest recovery, an unreachable-route state, and a 390×844 viewport. All six tests passed. Headless Chromium did not claim pointer lock or WASD movement; those remain targeted manual checks. The single `npm run quality` gate reports the reconstruction preflight as `BLOCKED` while all runnable checks pass.

## Performance evidence

No browser FPS, reconstruction wall-clock, or GPU memory benchmark is recorded yet. Bundle-size measurement is recorded by `npm run benchmark:build` in `benchmark/build-report.json`. Runtime FPS, metadata-to-render timing, and reconstruction performance must be measured on the actual judging laptop and processing GPU.
