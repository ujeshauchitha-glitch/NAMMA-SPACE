# Proof of Concept & Live Deployed Viewer

## 1. Public Live Application URLs
- **Production Web Application**: [https://namma-space-studio.vercel.app](https://namma-space-studio.vercel.app)
- **Direct Real Room 3D Digital Twin**: [https://namma-space-studio.vercel.app/?scene=real](https://namma-space-studio.vercel.app/?scene=real)
- **Direct Nerfstudio Benchmark Digital Twin**: [https://namma-space-studio.vercel.app/?scene=nerfstudio](https://namma-space-studio.vercel.app/?scene=nerfstudio)
- **Direct 3D Gaussian Splatting Viewer (SOG)**: [https://namma-space-studio.vercel.app/?scene=splat](https://namma-space-studio.vercel.app/?scene=splat)
- **Direct Capture Studio Workspace**: [https://namma-space-studio.vercel.app/?workspace=capture](https://namma-space-studio.vercel.app/?workspace=capture)
- **Direct Fullscreen 3D Viewport**: [https://namma-space-studio.vercel.app/?scene=real&fullscreen=true](https://namma-space-studio.vercel.app/?scene=real&fullscreen=true)

## 2. Code Repository & Release Commit
- **Repository URL**: [https://github.com/ujeshauchitha-glitch/NAMMA-SPACE.git](https://github.com/ujeshauchitha-glitch/NAMMA-SPACE.git)
- **Release Branch**: `finalashwinintegration`
- **Release Commit**: `a39b7a2` (verified fast-forward descendant)

## 3. Demonstration Video
- **Demonstration Video**: `docs/submission/Namma_Space_Demo.mp4` (Duration: 4m 14s / 254.2s, 1080p H.264/AAC, 8.1 MB)
- **Interactive Script & Narrative**: [`docs/DEMO_SCRIPT.md`](../docs/DEMO_SCRIPT.md)

## 4. Supported Capabilities
1. **Universal Multi-Image & Video Ingestion**:
   - Drag-and-drop photographic staging with per-image coverage indicators and viewpoint tags (`FRONT`, `BACK`, `LEFT`, `RIGHT`).
   - Browser client EXIF validation, deduplication checks, and signed ZIP bundle packaging.
   - Server/pipeline video frame extraction (`FFmpeg`) with timestamp preservation and blur filtering (`OpenCV` Laplacian variance).
2. **Interactive 3D Spatial Engine**:
   - WebGL 2.0 / WebGPU hardware-accelerated rendering powered by PlayCanvas 2.6.
   - Dual-representation runtime supporting both volumetric glTF/GLB digital twins and Supercompressed Optical Gaussian (`.sog`) 3D splats.
   - Edge-to-edge true fullscreen mode (`F` hotkey).
3. **Wayfinding, POI Search & A\* Navigation**:
   - Collision-safe A* pathfinding using occupancy grids derived from real spatial bounds.
   - Real-time POI search (`Cmd+K`) with confidence scoring, categorized destinations, and smooth camera fly-through interpolation.

## 5. Browser & System Requirements
- **Desktop Browsers**: Chrome 113+, Edge 113+, Firefox 115+, Safari 16.4+ (WebGL 2.0 required; WebGPU optional for advanced splat decompression).
- **Mobile Browsers**: Safari iOS 16.4+, Chrome Android 113+.
- **Authentication**: Zero authentication or login required; completely accessible anonymously.

## 6. Demonstration Scenes & Provenance
| Scene ID | Display Name | Representation | Source & Provenance | Quality Status |
| :--- | :--- | :--- | :--- | :--- |
| `captured-workshop-room` | **Captured Workshop Room (70 Photos)** | GLB volumetric twin + cameras | 70 smartphone photos from `work/captures/room` calibrated with COLMAP 4.2.1 | `passed` / validated |
| `nerfstudio-poster-capture` | **Nerfstudio Benchmark · Poster** | GLB volumetric twin + SOG splat | 226 cameras & 12,977 points from official Nerfstudio benchmark | `passed` / validated |
| `fixture-splat-sog` | **Synthetic Splat fixture (SOG)** | 3D Gaussian Splat (.sog) | Procedural Gaussian Splat room generated via `pipeline/make_demo_splat.py` | `needs-review` / demo |
| `the-amber-hall` | **Procedural fixture (The Amber Hall)** | Procedural geometry | Procedural exhibition hall with 24x18 occupancy grid | `passed` / validated |
| `the-amber-hall-glb` | **Generated GLB fixture** | Textured GLB mesh | Generated 10-mesh GLB model with collision boundary | `passed` / validated |

## 7. Anonymous Verification Procedure
1. Open [https://namma-space-studio.vercel.app](https://namma-space-studio.vercel.app) in an incognito window.
2. Confirm the shell loads with zero console errors.
3. Switch between demonstration scenes using the dropdown.
4. Click viewport to lock mouse look, test WASD walkthrough, press `F` for fullscreen, and press `Esc` to unlock.
5. Search for `Washbasin` or `Poster` via `Cmd+K` and verify pathfinding route plot.
