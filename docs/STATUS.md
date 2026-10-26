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
| pytest suite (`py -3.12 -m pytest tests -q`) | 25 tests pass: splat checks, SfM thresholds, input validation, blur filter, approval gate, and COLMAP's real `model_analyzer` output on a hand-written 2-image SYNTHETIC model. Two deliberate code breaks (lower registration floor, reversed blur sort) were each caught by a failing test, then reverted. Tests the code only, not reconstruction quality. | 2026-10-26 |
| COLMAP `model_analyzer` output format | ran the real binary; stats go to stderr with a log prefix; the pipeline's regexes parse registered images, points, track length and reprojection error correctly | 2026-10-26 |
| Viewer `?debug` overlay | splat count (105,991) and load time (0.1 s) display correctly on the synthetic fixture. FPS readout is NOT trustworthy from the Browser pane (see below). | 2026-10-26 |
| Splat compression (`@playcanvas/splat-transform` 3.10.3) | converted the synthetic fixture to .spz/.sog/.compressed.ply (4-10x smaller); each loads and renders in the viewer. Synthetic data only; quality loss and load time on a real splat unmeasured. See `TECH_STACK.md`. | 2026-10-26 |

All viewer testing so far used the **SYNTHETIC** fixture, not a real reconstruction. **No real capture has been reconstructed yet.**

Note: the splat checks cannot tell a real reconstruction from a synthetic file; only the human inspection gate can.

## Not yet tested (written, never run on real data)
- `pipeline/run_pipeline.py` stages on real footage: frame extraction + blur removal, COLMAP mapping, `model_analyzer` output parsing (the parse fails closed if the format differs), Brush training, publish
- Nerfstudio trainer path; `scripts/setup_tools.sh` (Linux)
- Mouse-look via pointer lock (the Browser pane cannot grant pointer lock), touch controls, sprint, Q/E
- **Browser performance on real hardware.** The in-app Browser pane renders on the integrated AMD 780M and throttles frames: it reported 0-3 fps with one 15 s first frame and then stopped updating even while the camera moved, so its FPS numbers are meaningless. The earlier "15-30 s loading" was this first-frame stall, not file loading (the loader reports 0.1 s). Measure with `?debug` in a normal Chrome on the NVIDIA GPU / lab PC, with a real splat. Until then performance is unknown, not good.
- Screenshot button (`?debug`), mobile asset size
- Public deployment / shareable URL

## Blocked on
- A real capture of one room (user is not currently in the chosen room; will film later).

## Known limitations
- Splats are a rendering representation. There is **no collision**: Round 1 uses only an optional axis-aligned rectangle in `scene.json`. Walls can be walked through. Round 2 needs a separate navigation representation.
- Model scale and orientation are set by hand in `scene.json`; no automatic floor-plane fitting yet.
- Mirrors, glass and plain white walls reconstruct poorly (see SOP failure modes).
- Spark/three.js bundle is ~1.2 MB gzipped; code-splitting not done.
- Reconstruction needs an NVIDIA GPU (COLMAP CUDA build) and a WebGPU-capable GPU (Brush). On a machine without them, reconstruction must run on cloud compute; the viewer itself runs anywhere WebGL2 works.
