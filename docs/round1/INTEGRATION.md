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
3. The PlayCanvas viewer loads only GLB/glTF assets; the manifest schema already allows `sog`, but the loader ignores it. No splat is shown yet.

## Next (phase 2 onward)
1. Splat loading spike in the PlayCanvas viewer; gate on Wed 28 Oct. If it cannot show our real splat acceptably, submit from `spark-viewer/`.
2. Pipeline `publish` writes Ashwin's scene bundle (manifest, sog, pois, quality), validated by `scripts/validate_scene.py`.
3. One COLMAP implementation (ours), fixing his flag names; merge the two capture SOPs; one README.
4. Update paths inside `docs/round1/*.md` and `reconstruction/README.md` (they still say `docs/SOP.md`, `viewer/`, `pipeline/`).
5. Talk to Ashwin before any push; open a pull request to his `main` rather than pushing to it. GitHub's default branch is still `round1/viewer-pipeline`.

## Undo
`git switch round1/viewer-pipeline` returns to our untouched branch; `git branch -D integration/r1` discards this one.
