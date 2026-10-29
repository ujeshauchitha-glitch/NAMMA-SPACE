# Namma Space

Smartphone video of an indoor space → photorealistic 3D digital twin → first-person walkthrough in the browser.
Round 1 of Techfest 2026-27 (reconstruction and roaming). POIs, search and pathfinding are Round 2.

## Architecture

```
phone video ──► ffmpeg + blur filter ──► COLMAP (poses) ──► Brush (3D Gaussian Splatting) ──► splat-transform ──► scene.sog
                      pipeline/run_pipeline.py                                                   │
                                                                                                  ▼
                              viewer/  React + TypeScript + Vite + react-three-fiber + Spark ──► first-person WASD
```

| Part | Choice | Why |
|---|---|---|
| Camera poses | COLMAP | reliable SfM for handheld video; standard input for splatting |
| Splat training | Brush | runs on any WebGPU GPU (incl. new RTX 50-series) with no CUDA toolkit build |
| Web rendering | Three.js via react-three-fiber + Spark | splats render in a normal three.js scene, so POIs, paths and a collision mesh slot in later |
| Controls | pointer-lock mouse look + WASD, touch fallback | zero-install, works without any navigation running |

See [docs/SOP.md](docs/SOP.md) for the capture procedure and [docs/TECH_STACK.md](docs/TECH_STACK.md) for what is in the stack, what is deferred, and why.

## Requirements
- **Python 3.13+ (tested 3.13.7, 3.14.6 and 3.15.2)** for the pipeline scripts and scene validators. Verified 29 Oct 2026 on this machine: each of the three Homebrew interpreters passes `scripts/validate_all_scenes.py` on both scene bundles, and the studio test suite runs the Python tooling through `python3` (3.15.2). Do not use macOS's system Python at `/usr/bin/python3` — it predates 3.13.
- **Node.js 20+ with npm** (verified with Node 26.3.1 / npm 12.0.1, 29 Oct 2026).
- **ffmpeg** for video frame extraction (verified at `/opt/homebrew/bin/ffmpeg`); **COLMAP** for reconstruction (`brew install colmap` gives 4.2.1, a CPU-only build on this Mac — no CUDA/dense stages; GPU training still needs an NVIDIA machine).

## Run the viewer (no reconstruction needed)

```bash
cd viewer
npm install
npm run dev        # http://localhost:5173
```

The default scene, `viewer/public/models/scene.json`, points at the compressed splat on external storage (Hugging Face); until that is uploaded the viewer explains that the file is missing. To smoke-test the viewer only, open `/?scene=dev-assets/fixtures/SYNTHETIC/synthetic_room.json`: a procedurally generated box room (`pipeline/make_demo_splat.py`) with a permanent on-screen **SYNTHETIC** badge. It is **not** a reconstruction. `viewer/dev-assets/` is served by `npm run dev` / `npm run preview` only and never ships in the production build. The hosted site shows the same fixture from Hugging Face at `/?scene=scenes/synthetic.json`.
Any splat can be loaded with `?splat=<url>`.

## Reconstruct your own space (Windows, NVIDIA GPU)

```powershell
./scripts/setup_tools.ps1                        # COLMAP, Brush, splat-transform into ./tools; ffmpeg, Node, .venv
.venv\Scripts\python pipeline/run_pipeline.py --doctor       # are all dependencies found?
.venv\Scripts\python pipeline/run_pipeline.py clip.mp4 --out work\home --check   # validate the capture, process nothing
.venv\Scripts\python pipeline/run_pipeline.py clip.mp4 --out work\home --title "My Home"
cd viewer; npm run dev                           # open /?scene=dev-assets/models/scene.json, walk the room, then:
.venv\Scripts\python pipeline/run_pipeline.py --approve work\home --note "what you checked"
```
The run ends with a compressed `work\home\web\scene.sog` (≤ 50 MB, `--max-mb`); the raw `.ply` stays in `work\`. Step-by-step for the first real capture: [docs/HANDOFF_UJESHA.md](docs/HANDOFF_UJESHA.md).
Linux / WSL2: `scripts/setup_tools.sh` (untested). Trainers and machines: [docs/TRAINING.md](docs/TRAINING.md); `--trainer nerfstudio` is the alternative to Brush.

A run ends as `automated_checks_passed_awaiting_inspection` in `work/<name>/report.json`. It becomes `inspected_ok` only when a person approves it after walking the result; until then the reconstruction is **not** considered successful. Pass criteria are in [docs/SOP.md](docs/SOP.md).

Then edit `viewer/dev-assets/models/scene.json` (`spawn`, `scale`, `rotation`) to align the model; see *Scale and orientation* in the SOP. The production `viewer/public/models/scene.json` gets the same values plus the hosted splat URL.

## Controls
`W A S D` move · mouse look (click to capture) · `Shift` sprint · `Q`/`E` lower/raise · `Esc` release mouse. Touch: drag to look, two fingers to walk.

## Layout
```
pipeline/   run_pipeline.py (video → splat), make_demo_splat.py
scripts/    setup_tools.ps1
viewer/     web app
docs/       SOP.md
tests/      sample data (see tests/sample_data/README.md)
apps/studio Round 2 studio app (from main)
```

## Status
- [x] Viewer: first-person walkthrough, config-driven scene, touch fallback
- [x] Pipeline scripts and SOP
- [ ] Real capture + first full reconstruction — a 70-photo set (28 Oct 2026) has been taken and every pipeline stage is exercised and green on synthetic content; since the SIMPLE_RADIAL camera-model fix (29 Oct, `a4299f5`) real photos register at 57% instead of 3%, but the set still splits into two disconnected rooms (below the 60% registration gate — honest blocker `logs/round1-rescue/BLOCKERS.md` BLK-001; run-by-run numbers in `docs/CAPTURE_DAY.md`). Blocked on a re-shoot per the SOP; no real reconstruction has succeeded yet.
- [ ] Deploy viewer to static hosting, record demo video, write abstract PDF
- [x] Compress stage in the pipeline (`.sog`/`.spz` ≤ 50 MB); viewer loads external splat URLs with progress
- [ ] Compression quality checked on a real splat

## Round 2 groundwork (studio app)

The repository also contains the studio app from the `main` branch: Capture Studio, a PlayCanvas viewer with POI search and A* routes over an occupancy grid, and Live Scan phone pairing. It lives in [`apps/studio/`](apps/studio/) (run `npm ci && npm run dev` there), is kept for Round 2, and is not part of the Round 1 submission. Its docs:
[README](apps/studio/README.md) · [Architecture](apps/studio/ARCHITECTURE.md) · [Pipeline](apps/studio/PIPELINE.md) · [Capture SOP](apps/studio/CAPTURE_SOP.md) · [Validation](apps/studio/VALIDATION.md) · [Roadmap](apps/studio/ROADMAP.md) · [Decision log](apps/studio/DECISION_LOG.md) · [Windows setup](apps/studio/WINDOWS_SETUP.md)

Phone pairing over the LAN has its own executable runbook: [docs/PAIRING.md](docs/PAIRING.md).

## Credits
COLMAP (BSD), Brush (Apache-2.0), splat-transform (MIT), Spark (MIT), three.js (MIT), react-three-fiber (MIT), React (MIT), Vite (MIT), FFmpeg (LGPL/GPL), OpenCV (Apache-2.0), NumPy (BSD). Studio app (`apps/studio`): PlayCanvas (MIT), zod (MIT).

