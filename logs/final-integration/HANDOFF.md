# Engineering Handoff

## 1. Executive Summary
The Namma Space codebase has been integrated into a single, cohesive, fully tested web application under the branch `finalashwinintegration`. All competing branches have been audited, redundant or conflicting implementations resolved, and all core user journeys unified under a shared spatial data contract.

## 2. Key Entry Points & Repositories
- **Git Branch**: `finalashwinintegration`
- **Application Root**: `apps/studio/`
- **Public Entry Point**: `apps/studio/src/App.tsx`
- **3D Spatial Engine**: `apps/studio/src/engine/PlayCanvasViewer.ts`
- **Capture Studio**: `apps/studio/src/components/workspace/CaptureStudioWorkspace.tsx`
- **Onboarding Guide**: `apps/studio/src/components/shell/WelcomeGuideModal.tsx`
- **Scene Bundles**: `apps/studio/public/scenes/`
  - `fixture/`: Procedural geometry
  - `glb-fixture/`: GLB mesh model
  - `splat-fixture/`: SOG 3D Gaussian Splat (`synthetic_room.sog`)

## 3. How to Run Locally
```bash
# 1. Install dependencies
cd apps/studio
npm ci

# 2. Run local development server
npm run dev
# Open http://localhost:5173

# 3. Run with LAN support for mobile camera pairing
npm run dev:lan
```

## 4. How to Run Quality & Test Suites
```bash
cd apps/studio

# Static typing & lint
npm run typecheck
npm run lint

# Unit & integration tests (679 tests)
npm test

# Python tests (78 tests)
cd ../..
uv run --with pytest python -m pytest tests -q
cd apps/studio

# Scene manifest validation (3 scenes)
npm run validate:scenes

# Playwright browser E2E (37 tests)
npm run test:e2e

# Full quality gate (10 automated tiers)
python3 scripts/quality_gate.py
```

## 5. Production Build & Deployment
```bash
# Production build
npm run build

# Deploy to Vercel
vercel --prod
```
When configured on Vercel:
- **Root Directory**: `.` (uses root `vercel.json` which builds `apps/studio`)
- **Build Command**: `cd apps/studio && npm run build`
- **Output Directory**: `apps/studio/dist`

## 6. Architecture & Data Contracts
All spatial scenes adhere to schema version 1 defined in `apps/studio/src/types/scene.ts`:
- **Scene Manifest** (`manifest.json`): Contains `sceneKind`, `displayName`, `bounds`, `startPosition`, `startYawDegrees`, `visualAssets`, and `provenance`.
- **Navigation Grid** (`navigation/nav-data.json`): Defines grid dimensions, resolution, cell bounds, walkable/blocked cell bitmasks, and start cell.
- **POI Index** (`pois/poi-index.json`): Defines points of interest with UUIDs, categories, 3D target coordinates, approach points, and priority weights.
