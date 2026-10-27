# Integration notes: Ashwin's app + the reconstruction pipeline

Branch `integration/r1` is Ashwin's `main` (86b7a66) with our `round1/viewer-pipeline` branch merged in (unrelated histories). Local only until the team agrees to push.

## Layout
| Path | What it is | Origin |
|---|---|---|
| `src/`, `public/`, `scripts/`, `tests/`, root docs | the app: Capture Studio, Spatial Viewer (PlayCanvas), Live Scan, scene bundles, Vitest + Playwright | Ashwin |
| `reconstruction/pipeline/` | video -> frames -> COLMAP -> Brush/Nerfstudio -> checks -> report.json | ours |
| `reconstruction/tests/` | 25 pytest tests for the pipeline | ours |
| `reconstruction/scripts/` | `setup_tools.ps1` / `.sh` (COLMAP, Brush, ffmpeg) | ours |
| `spark-viewer/` | first-person splat viewer (React + react-three-fiber + Spark); **fallback** Round 1 viewer | ours |
| `docs/round1/` | capture SOP, status, submission plan, abstract draft, training guide | ours |
| `tools/`, `work/` | downloaded binaries and per-run outputs (git-ignored) | local |

Only `README.md` and `.gitignore` conflicted. The root README is Ashwin's; ours is kept as `reconstruction/README.md`. `.gitignore` is the union of both.

## Changes made to move things
- Python `ROOT` now resolves to the repository root (`parents[2]`), so `tools/`, `work/` and the Spark viewer path resolve from `reconstruction/pipeline/`.
- `setup_tools.*` find the repo root two levels up.
- Our Pages workflow is **manual only** and builds `spark-viewer/`. Before, it would have run on pushes and tried to build a folder that moved.
- `vitest.config.ts` (Ashwin's file, one change): exclude patterns made recursive and extended with `spark-viewer/**` and `reconstruction/**`. Without this, Vitest scanned `spark-viewer/node_modules` and reported 4 bogus failures.
- `.claude/launch.json` starts either app (ports 5173 and 5174).

## Verified after the merge (2026-10-26, Windows)
| Check | Result |
|---|---|
| `py -3.12 -m pytest reconstruction/tests -q` | 25 passed |
| `reconstruction/pipeline/run_pipeline.py --doctor` | finds ffmpeg, COLMAP, Brush, OpenCV, GPU |
| `npm run typecheck` (his app) | passes |
| `npm run build` (his app) | passes |
| `npm test` (his app) | 393 passed, **2 failed** (below) |
| spark-viewer `tsc -b` and `npm run build` | pass |

Not run: his Playwright E2E tests (browser download), a real reconstruction, the app in a browser.

## Known problems found (not caused by the merge)
1. `tests/pipeline.test.ts` has 2 tests that fail on Windows: one splits paths on `'/'`; one builds a POSIX shell script as a fake COLMAP and calls `python3`. Written on macOS. They need Windows-safe versions or a skip on `win32`; not changed here, since it is Ashwin's file.
2. `scripts/reconstruct_colmap.py` passes `--SiftExtraction.use_gpu` and `--SiftMatching.use_gpu`. COLMAP 4.2.1 rejects the first as an unrecognised option (checked on this machine); the supported flags are `--FeatureExtraction.use_gpu` and `--FeatureMatching.use_gpu`. His tests use a fake COLMAP, so this never surfaced.
3. ~~The PlayCanvas viewer loads only GLB/glTF assets.~~ Fixed in the phase 2 spike below.

## Phase 2 spike: splats in the PlayCanvas viewer (2026-10-27)
**Result: works.** `.sog` and `.ply` Gaussian splats load and render in Ashwin's viewer (PlayCanvas 2.23.3) through the `gsplat` asset type.

What changed
- `src/types/scene.ts`: `ply` added to the asset kinds (`sog` already existed).
- `src/engine/PlayCanvasViewer.ts`: `loadSplatAssets()` loads `ply`/`sog` assets as `gsplat` and applies the manifest's `worldFromReconstruction` (row-major 4x4, converted to PlayCanvas's column-major). MSAA is turned off for splat scenes (PlayCanvas warns MSAA makes splats several times more expensive).
- `src/engine/PlayCanvasViewer.ts`: when a scene has no navigation grid, movement is clamped to the manifest's `bounds` (0.3 m margin). This is a box, not wall or furniture collision.
- `public/scenes/splat-fixture/`: a **SYNTHETIC** scene bundle (our procedural room as a 0.69 MB `.sog`, one synthetic POI, no navigation). Open with `/?scene=splat`. It passes `scripts/validate_scene.py`.
- `tests/scene.test.ts`: two new tests (fixture parses, is disclosed synthetic, SOG hash matches; `ply` kind accepted).

**Bug found in the existing viewer and fixed.** `resize()` multiplied the container size by `devicePixelRatio` and passed it to `resizeCanvas`, which expects CSS pixels. When `devicePixelRatio != 1` (for example 175% Windows display scaling) the canvas grew by that factor on every resize because the stage height follows the canvas: it reached 981 x 57,687 px, WebGL reported "greater than max renderbuffer size", and the canvas was black. His own GLB scene did the same on this machine. Now it stays at the container size (980 x 489 measured). Worth telling Ashwin: it affects every scene on any scaled display.

Measured in the Browser pane (integrated AMD GPU, frames throttled unless the pane is being captured)
| Check | Result |
|---|---|
| SOG renders, orientation matches the Spark viewer | yes |
| PLY renders (7 MB) | yes, took about 20 s to appear in this pane |
| Walk forward 3 s | stops at Z = -4.70 (bound -5 + 0.3 margin) |
| Strafe right 3.5 s | stops at X = 5.70 (bound 6 - 0.3) |
| Console after the fix | no WebGL errors |

Not measured: frame rate or load time on real hardware (the pane is not representative), mouse-look with pointer lock, how the viewer behaves with a real reconstruction.

Checks after the spike: typecheck pass, build pass, `npm test` 395 passed / 2 failed (the same two Windows-only failures), `validate_all_scenes.py` 3 bundles pass, our pytest 25 pass.

**Gate status (Wed 28 Oct):** the technical blocker for using his viewer is gone. The remaining risk is performance and quality on a real splat, which needs the real capture.

## Next (phase 2 onward)
1. Splat loading spike in the PlayCanvas viewer; gate on Wed 28 Oct. If it cannot show our real splat acceptably, submit from `spark-viewer/`.
2. Pipeline `publish` writes Ashwin's scene bundle (manifest, sog, pois, quality), validated by `scripts/validate_scene.py`.
3. One COLMAP implementation (ours), fixing his flag names; merge the two capture SOPs; one README.
4. Update paths inside `docs/round1/*.md` and `reconstruction/README.md` (they still say `docs/SOP.md`, `viewer/`, `pipeline/`).
5. Talk to Ashwin before any push; open a pull request to his `main` rather than pushing to it. GitHub's default branch is still `round1/viewer-pipeline`.

## Undo
`git switch round1/viewer-pipeline` returns to our untouched branch; `git branch -D integration/r1` discards this one.
