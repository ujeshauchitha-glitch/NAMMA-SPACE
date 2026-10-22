# Status, tested features and known limitations

Last updated: 2026-10-22. Update this file after every milestone; never mark something tested unless it was executed.

## Tested
| Feature | How verified | Date |
|---|---|---|
| Viewer builds (`tsc -b`, `vite build`) | ran both, no errors | 2026-10-22 |
| Viewer loads a splat (.ply) and renders it in Chromium (Browser pane) | opened with a **synthetic** fixture, no console errors | 2026-10-22 |
| WASD movement + bounds clamp | held W ~1.5 s with synthetic key events; camera moved to the wall and stopped | 2026-10-22 |

All viewer testing so far used the **SYNTHETIC** fixture, not a real reconstruction.

## Not yet tested (written, never run on real data)
- `scripts/setup_tools.ps1` end to end (download in progress)
- `pipeline/run_pipeline.py`: frame extraction, COLMAP, Brush training, publish. The COLMAP and Brush CLI flags are unverified.
- Mouse-look via pointer lock (the Browser pane cannot grant pointer lock), touch controls, sprint, Q/E
- Browser performance on a real splat; load time; asset size on mobile
- Public deployment / shareable URL

## Blocked on
- A real capture of one room (user is not currently in the chosen room; will film later).

## Known limitations
- Splats are a rendering representation. There is **no collision**: Round 1 uses only an optional axis-aligned rectangle in `scene.json`. Walls can be walked through. Round 2 needs a separate navigation representation.
- Model scale and orientation are set by hand in `scene.json`; no automatic floor-plane fitting yet.
- Mirrors, glass and plain white walls reconstruct poorly (see SOP failure modes).
- Spark/three.js bundle is ~1.2 MB gzipped; code-splitting not done.
- Reconstruction needs an NVIDIA GPU (COLMAP CUDA build) and a WebGPU-capable GPU (Brush). On a machine without them, reconstruction must run on cloud compute; the viewer itself runs anywhere WebGL2 works.
