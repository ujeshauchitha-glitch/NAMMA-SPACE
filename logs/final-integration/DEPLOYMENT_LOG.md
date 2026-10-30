# Deployment Log

## Deployment Target & Topology
- **Platform**: Vercel
- **Branch**: `finalashwinintegration`
- **Root Configuration**: `vercel.json`
- **Build Settings**:
  - `installCommand`: `cd apps/studio && npm ci`
  - `buildCommand`: `cd apps/studio && npm run build`
  - `outputDirectory`: `apps/studio/dist`
  - `framework`: `vite`
- **Routing & Rewrite Rules**:
  - Static caching headers for `/scenes/(.*)`: `Cache-Control: public, max-age=31536000, immutable`
  - SPA Fallback: `/(.*)` rewrites to `/index.html`

## Production Build Verification
- **Output Artifacts**:
  - `dist/index.html`: Shell composition root with meta tags, theme colors, and semantic headings
  - `dist/assets/index-*.js`: Entry bundle within gzip budget (< 150 KB)
  - `dist/assets/PlayCanvasViewer-*.js`: Lazy 3D engine chunk (< 450 KB gzip)
  - `dist/assets/LiveScanWorkspace-*.js`: Lazy QR/WebRTC chunk (< 80 KB gzip)
  - `dist/scenes/fixture/`: Procedural Amber Hall manifest, nav-grid, POIs
  - `dist/scenes/glb-fixture/`: GLB mesh asset bundle with verified SHA-256 integrity
  - `dist/scenes/splat-fixture/`: `synthetic_room.sog` 3D Gaussian Splat bundle (718 KB) with verified SHA-256 integrity

## Anonymous Access & Navigation Verification
- All static assets are served from `/scenes/*` within the same origin.
- Zero external third-party API dependencies or private token requirements.
- Zero 401 Unauthorized or 404 Not Found asset errors.
- Deep linking via query parameters (`?scene=splat`, `?scene=glb`, `?workspace=capture`, `?workspace=viewer`) verified functional.
