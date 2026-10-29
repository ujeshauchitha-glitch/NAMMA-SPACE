# Status, tested features and known limitations

Last updated: 2026-10-29. Update this file after every milestone; never mark something tested unless it was executed.

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
| Splat compression (`@playcanvas/splat-transform` 3.10.3) | converted the synthetic fixture to .spz/.sog/.compressed.ply (4-10x smaller); each loads and renders in the viewer. Synthetic data only; quality loss and load time on a real splat unmeasured. See `TECH_STACK.md`. | 2026-10-26 |

The rows above used the **SYNTHETIC** fixture. The first real reconstruction (a classroom) is recorded under 2026-10-29 below.

Note: the splat checks cannot tell a real reconstruction from a synthetic file; only the human inspection gate can.

## Added 2026-10-28 (integration/round1), tested only with stubs on macOS
| Change | How verified |
|---|---|
| Frame-count rule shared by `--check` and extraction | unit run with a stubbed ffprobe: 25 s and 30 s rejected at 3 fps, 31 s and 45 s accepted |
| Photo input copies only images, any extension case | unit run on a folder with .JPG/.jpeg/.png/.HEIC/.txt |
| Splat reuse only on matching trainer/steps/COLMAP model; dataset checks before Brush | unit run with a fake `brush_app` (sparse/ and sparse/0/, stray .ply, missing images, several models) |
| `--check` keeps the run status | ran against a report in awaiting-inspection state |
| Compress stage (`pipeline/compress.py`) | unit run with a fake splat-transform CLI: SH reduction, decimation, GPU→CPU and SOG→SPZ fallbacks. **The real splat-transform was not run** (its WebGPU binary needs macOS 26) |
| Viewer: progress bar, clear errors, dev-only `dev-assets/` | in the browser pane: fixture loads; 401, 404/HTML page and non-splat files give clear messages; fixture absent from `dist/` |
| `scripts/setup_tools.ps1` rewrite | **not run** (no Windows/PowerShell here) |

Brush 0.3.0 CLI flags and its COLMAP loading (any `cameras.bin`, so `sparse/` and `sparse/0/` both work) were checked against the v0.3.0 source, not by running it.

## Added 2026-10-29 (Windows, RTX 5060 laptop, real classroom footage)
| Change | How verified |
|---|---|
| Full pipeline on a real capture | 180 s 1080p classroom video: 287/306 frames registered, 35,337 points, 0.81 px; Brush 30k steps; 19.6 MB `.sog`. Walked two viewpoints in the viewer, not the whole room |
| Milder Brush regularisation (`BRUSH_FLAGS`) | same classroom: floating fog gone, 29% fewer splats. One scene only |
| `pipeline/room_coverage.py`: seen map, room-closed check, re-film list | unit tests on synthetic rooms (closed room verifies, missing ceiling reported); on the classroom it reports 82% of the floor plan and a mostly unfilmed ceiling, which matches the footage. Plain walls can read as gaps because sparse points are thin there |
| Auto-alignment written into `scene.json` (level floor, spawn at a real camera, walk bounds) | unit tests at three tilts; on the classroom it reproduces the hand-tuned rotation to all printed digits |
| `--mask-people` (YOLOv8 segmentation, Brush `masks/` folder) | people found in 187/287 classroom frames (3% of pixels); masks checked by eye on the busiest frame. Retrained (30k steps, 18.5 MB): at two people-heavy viewpoints the seated and walking people are gone and the furniture behind them shows; one person sitting right next to the camera still leaves a smear |
| Auto exhaustive-matcher retry | logic only; it re-raises every SfM failure except low registration. Not run end to end |
| Viewer: training-matched splat filter (0.3 px blur, 3 sigma), adaptive resolution (1x to 2x), eased movement, `R` to reset | rendered the classroom in the Browser pane; the filter change is subtle at normal distance |
| Viewer: splat download starts as soon as `scene.json` arrives, not after the canvas mounts | resource timing: `.sog` request at 0.1 s after load (it previously waited for the canvas) |

## Not yet tested (written, never run on real data)
- `pipeline/run_pipeline.py` stages on real footage: frame extraction + blur removal, COLMAP mapping, `model_analyzer` output parsing (the parse fails closed if the format differs), Brush training, publish
- Nerfstudio trainer path; `scripts/setup_tools.sh` (Linux)
- Mouse-look via pointer lock (the Browser pane cannot grant pointer lock), touch controls, sprint, Q/E
- Browser performance on a real splat; load time; asset size on mobile
- Public deployment / shareable URL

## Blocked on
- A human walkthrough and `--approve` of the classroom; one real measured distance for metric scale.

## Known limitations
- Splats are a rendering representation. There is **no collision**: Round 1 uses only an optional axis-aligned rectangle in `scene.json`. Walls can be walked through. Round 2 needs a separate navigation representation.
- Orientation, spawn and bounds are set automatically from camera poses; scale is not metric (COLMAP units) until someone measures one real distance.
- Mirrors, glass and plain white walls reconstruct poorly (see SOP failure modes).
- Spark/three.js bundle is ~1.2 MB gzipped; code-splitting not done.
- Reconstruction needs an NVIDIA GPU (COLMAP CUDA build) and a WebGPU-capable GPU (Brush). On a machine without them, reconstruction must run on cloud compute; the viewer itself runs anywhere WebGL2 works.
