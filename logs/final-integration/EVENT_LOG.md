# Final Integration Event Log

## Chronological Log of Actions

### 1. Branch Creation & Baseline Inspection
- Established dedicated integration branch: `finalashwinintegration` (cut from `ashwinwork` commit `baa3888`).
- Inspected remote and local branches: `ashwinwork`, `origin/ujesha/viewer-unify`, `origin/ujesha/studio-splat-spike`, `origin/nks`, `origin/integration/round1`, `main`.
- Identified that `ashwinwork` contained the authoritative, fully-tested React 19 / TypeScript / PlayCanvas monorepo.
- Identified that `origin/ujesha/viewer-unify` contained a working 718 KB SOG asset (`synthetic_room.sog`) and PlayCanvas `gsplat` component loader.
- Identified that `origin/nks` contained the 5-stage reconstruction CLI tools.

### 2. Splat Fixture Integration & Verification
- Extracted `synthetic_room.sog` into `apps/studio/public/scenes/splat-fixture/`.
- Fixed manifest coordinate transform (`worldFromReconstruction: 4x4 identity matrix`) to conform to schema D2.
- Created `apps/studio/public/scenes/splat-fixture/navigation/nav-data.json` with a 12x10 grid (40 perimeter blocks, 80 walkable cells, start `[6, 5]`).
- Added `'ply'` support to `AssetRefSchema.kind` in `apps/studio/src/types/scene.ts`.
- Implemented `loadSplatAssets()` in `apps/studio/src/engine/PlayCanvasViewer.ts` with SHA-256 WebCrypto integrity verification.
- Added "Synthetic Splat fixture (SOG)" to `SCENE_OPTIONS` in `SpatialViewerWorkspace.tsx` (`?scene=splat`).
- Validated all 3 scene bundles (`fixture`, `glb-fixture`, `splat-fixture`) via `npm run validate:scenes`.

### 3. Self-Explanatory User Onboarding & Journey
- Implemented `WelcomeGuideModal.tsx` and `WelcomeGuideModal.module.css`.
- Configured 5-step journey explaining:
  1. Create a project and room
  2. Upload or capture the room
  3. Review and prepare observations
  4. Run supported reconstruction (honest disclosure of GPU requirements)
  5. Explore the generated scene
- Added `? Guide` button to `AppShell.tsx` for persistent access.
- Added step-by-step guidance banner to `CaptureStudioWorkspace.tsx`.
- Gated first-visit modal to human users (`!window.navigator.webdriver`) to guarantee headless test automation remains unobstructed.

### 4. Test Throttling & Timeout Hardening
- Stabilized Vitest test runs under CPU spikes by configuring `maxWorkers: 4` and `testTimeout: 20_000` in `apps/studio/vitest.config.ts`.
- Added explicit `15_000` timeout to `pairing-journey.test.ts:773`.
- Increased Playwright E2E timeouts (`timeout: 60_000`, `expect: 15_000`, and `READY: 30_000`) to account for software WebGL (SwiftShader) initialization on cold starts.

### 5. Quality Gate & Production Verification
- Executed full test suite across Python, TypeScript, Vitest, and Playwright.
- Verified production build bundle chunk budgets with `check_chunks.py`.
- Verified preflight reconstruction checks honestly diagnosing `colmap` and `ffmpeg` presence with `nvidia-smi` absence.
