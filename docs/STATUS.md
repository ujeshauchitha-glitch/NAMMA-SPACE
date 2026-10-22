# Status, tested features and known limitations

Last updated: 2026-10-22. Update this file after every milestone; never mark something tested unless it was executed.

## Tested
| Feature | How verified | Date |
|---|---|---|
| Viewer builds (`tsc -b`, `vite build`) | ran both, no errors | 2026-10-22 |
| Viewer loads a splat (.ply) and renders it in Chromium (Browser pane) | opened with a **synthetic** fixture, no console errors | 2026-10-22 |
| WASD movement + bounds clamp | held W ~1.5 s with synthetic key events; camera moved to the wall and stopped | 2026-10-22 |
| `scripts/setup_tools.ps1` | ran on Windows: COLMAP 4.2.1 (CUDA), Brush 0.3.0, ffmpeg, OpenCV installed and launch | 2026-10-22 |
| Pipeline dependency doctor (`--doctor`) | ran for both trainers; correctly reports Nerfstudio missing on this machine | 2026-10-22 |
| Pipeline input validation (`--check`) | tested with throwaway clips: missing file, 320x240 5 s clip, non-video file (all rejected with clear messages), 1080p 40 s ffmpeg test pattern (accepted). Validation logic only; not a room. | 2026-10-22 |
| Splat output checks | tested on the synthetic fixture (accepted) and corrupted copies: truncated, empty, missing, not a PLY, missing attribute, NaN (all rejected) | 2026-10-22 |
| `--approve` gate | refuses unless status is awaiting-inspection and a note is given | 2026-10-22 |
| COLMAP/Brush CLI flags used by the pipeline | `--help` confirms they exist (not their behaviour on data) | 2026-10-22 |

All viewer testing so far used the **SYNTHETIC** fixture, not a real reconstruction. **No real capture has been reconstructed yet.**

Note: the splat checks cannot tell a real reconstruction from a synthetic file; only the human inspection gate can.

## Not yet tested (written, never run on real data)
- `pipeline/run_pipeline.py` stages on real footage: frame extraction + blur removal, COLMAP mapping, `model_analyzer` output parsing (the parse fails closed if the format differs), Brush training, publish
- Nerfstudio trainer path; `scripts/setup_tools.sh` (Linux)
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
