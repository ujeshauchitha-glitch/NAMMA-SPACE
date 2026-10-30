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

## Repository layout

```
pipeline/   run_pipeline.py (video → splat), make_demo_splat.py
scripts/    setup_tools.ps1 / setup_tools.sh (Windows / Linux tool bootstrap)
viewer/     Round 1 web app (React + Vite + react-three-fiber + Spark)
apps/studio Round 2 studio app (Capture Studio, PlayCanvas viewer, Live Scan pairing)
tests/      root pytest suite + tests/sample_data/ (SYNTHETIC fixtures + reproduction docs)
docs/       SOP.md, CAPTURE_DAY.md, TRAINING.md, PAIRING.md, …
work/       local pipeline output (git-ignored; never committed)
```

## Requirements (with verified versions)

- **Python 3.13+ (tested 3.13.7, 3.14.6 and 3.15.2)** for the pipeline scripts, scene validators and capture preparation. Verified 29–30 Oct 2026 on this machine: each of the three Homebrew interpreters passes `scripts/validate_all_scenes.py` on both scene bundles, and the studio tooling runs through `python3` (3.15.2). Do not use macOS's system Python at `/usr/bin/python3` — it predates 3.13.
- **[uv](https://docs.astral.sh/uv/)** (Astral) to run the root pytest suite exactly as documented (`uv run --with pytest …`); any Python 3.13+ with `pip install pytest` works too.
- **Node.js 20+ with npm** (verified with Node 26.3.1 / npm 12.0.1, 29 Oct 2026).
- **ffmpeg** for video frame extraction (verified at `/opt/homebrew/bin/ffmpeg`, 9.0.2).
- **COLMAP 4.2.1** for reconstruction (`brew install colmap` gives 4.2.1 — a CPU-only build on this Mac; GPU/dense stages need an NVIDIA machine) and **Brush** for splat training; both are bootstrapped into `./tools` by `scripts/setup_tools.ps1` (Windows) / `scripts/setup_tools.sh` (Linux, untested). `splat-transform` (MIT) converts the trained splat to `.sog`.

## Install & run the apps (no reconstruction needed)

Viewer (Round 1 submission app):

```bash
cd viewer
npm install
npm run dev        # http://localhost:5173
```

Studio (Round 2 groundwork — kept in this branch):

```bash
cd apps/studio
npm ci
npm run dev        # Vite dev server (see apps/studio/README.md)
```

Production build: `npm run build` in each of `viewer/` and `apps/studio/` (both run `tsc -b` then `vite build`); preview with `npm run preview`.

The default viewer scene, `viewer/public/models/scene.json`, points at the compressed splat on external storage (Hugging Face); until that is uploaded the viewer explains that the file is missing. To smoke-test the viewer only, open `/?scene=dev-assets/fixtures/SYNTHETIC/synthetic_room.json`: a procedurally generated box room (`pipeline/make_demo_splat.py`) with a permanent on-screen **SYNTHETIC** badge. It is **not** a reconstruction. `viewer/dev-assets/` is served by `npm run dev` / `npm run preview` only and never ships in the production build. The hosted site shows the same fixture from Hugging Face at `/?scene=scenes/synthetic.json`.
Any splat can be loaded with `?splat=<url>`.

## Tests and validation

All commands below were verified from a clean checkout on 30 Oct 2026.

| What | Command | From | Expected |
|---|---|---|---|
| Studio unit/integration tests | `npm test` | `apps/studio/` | 670 passed (35 files) |
| Studio typecheck | `npm run typecheck` | `apps/studio/` | 0 errors |
| Studio lint | `npm run lint` | `apps/studio/` | 0 errors (6 known `react-refresh` warnings) |
| Browser E2E | `npx playwright install chromium` once, then `npm run test:e2e` | `apps/studio/` | 36 passed (starts its own dev server on 127.0.0.1:5183) |
| Scene-bundle validation | `npm run validate:scenes` | `apps/studio/` | `Validated 2 scene bundles` (both SYNTHETIC demos) |
| Full quality gate | `npm run quality` | `apps/studio/` | 10/10 PASS (typecheck, lint, vitest, scenes, build, chunks, preflight, E2E, …; ~5 min) |
| Root pytest (pipeline, chunks, quality-gate heuristics) | `uv run --with pytest python -m pytest tests -q` | repo root | 65 passed |

The root pytest suite also covers the capture-preparation logic end to end
(`tests/` → `apps/studio/scripts/prepare_capture.py`).

## Sample data (SYNTHETIC) and capture preparation

[`tests/sample_data/`](tests/sample_data/) holds a compact, permission-cleared,
**fully synthetic** dataset (procedurally drawn corridor frames with a burned-in
SYNTHETIC watermark; **no real capture is published**). Digests, provenance and
licensing: [tests/sample_data/PROVENANCE.md](tests/sample_data/PROVENANCE.md).
Exact expected results per command: [tests/sample_data/EXPECTED.md](tests/sample_data/EXPECTED.md).

`apps/studio/scripts/prepare_capture.py` is the CPU-safe ingest stage. It accepts three input kinds:

1. **A studio export ZIP** (`manifest.json` + `images/<sha256>.jpg` — digest-verified):
   ```bash
   python3 apps/studio/scripts/prepare_capture.py tests/sample_data/synthetic_capture_bundle.zip --output work/sample_zip
   ```
2. **An image folder** (JPG/PNG/WEBP/HEIC — this is how you feed your own photos):
   ```bash
   python3 apps/studio/scripts/prepare_capture.py tests/sample_data/images --output work/sample_dir
   ```
3. **A video** (MP4/MOV/M4V/AVI; frames sampled with `--fps`, default 2):
   ```bash
   python3 apps/studio/scripts/prepare_capture.py tests/sample_data/synthetic_clip.mp4 --output work/sample_video
   ```

Expected from the committed sample data: **8 / 8 / 10 frames**, quality
`passed`, zero warnings, and a `frame-manifest.json` with per-frame SHA-256
digests (see [EXPECTED.md](tests/sample_data/EXPECTED.md)). To try your own
capture, point command 2 or 3 at your files — the script never claims
reconstruction; it only stages and verifies frames.
The fixtures can be regenerated byte-for-byte with
`python3 tests/sample_data/generate_sample_data.py` (python3 + ffmpeg).

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

**Hardware reality check:** COLMAP feature/matching stages run on CPU (any modern machine); Brush splat training needs a WebGPU-capable GPU (NVIDIA RTX recommended, driver recent enough for WebGPU). On this Apple-silicon Mac, COLMAP 4.2.1 is CPU-only and Brush training of a real capture has not been run — see *Known limitations*.

A run ends as `automated_checks_passed_awaiting_inspection` in `work/<name>/report.json`. It becomes `inspected_ok` only when a person approves it after walking the result; until then the reconstruction is **not** considered successful. Pass criteria are in [docs/SOP.md](docs/SOP.md).

The viewer loads any published scene: edit `viewer/dev-assets/models/scene.json` (`spawn`, `scale`, `rotation`) to align the model; see *Scale and orientation* in the SOP. The production `viewer/public/models/scene.json` gets the same values plus the hosted splat URL.

## Controls
`W A S D` move · mouse look (click to capture) · `Shift` sprint · `Q`/`E` lower/raise · `Esc` release mouse. Touch: drag to look, two fingers to walk.

## Status and known limitations

- [x] Viewer: first-person walkthrough, config-driven scene, touch fallback
- [x] Pipeline scripts and SOP; all stages exercised and green on synthetic content
- [x] SYNTHETIC sample data + reproduction docs (`tests/sample_data/`), verified from a clean clone
- [ ] Real capture + first full reconstruction — a 70-photo set (28 Oct 2026) has been taken and every pipeline stage is exercised and green on synthetic content; since the SIMPLE_RADIAL camera-model fix (29 Oct, `a4299f5`) real photos register at 57% instead of 3%, but the set still splits into two disconnected rooms (below the 60% registration gate — honest blocker `logs/round1-rescue/BLOCKERS.md` BLK-001; run-by-run numbers in `docs/CAPTURE_DAY.md`). Blocked on a re-shoot per the SOP; no real reconstruction has succeeded yet. **This is a real, unresolved blocker: the pipeline has not produced a digital twin of a real space.**
- [ ] Deploy viewer to static hosting, record demo video, write abstract PDF
- [x] Compress stage in the pipeline (`.sog`/`.spz` ≤ 50 MB); viewer loads external splat URLs with progress
- [ ] Compression quality checked on a real splat

Further honest limitations: the committed sample data is synthetic and proves
ingestion contracts only; the default production scene URL (Hugging Face splat)
is not yet uploaded; E2E runs on software WebGL (SwiftShader), so GPU rendering
perf on real visitor hardware is unmeasured.

## Round 2 groundwork (studio app)

The repository also contains the studio app from the `main` branch: Capture Studio, a PlayCanvas viewer with POI search and A* routes over an occupancy grid, and Live Scan phone pairing. It lives in [`apps/studio/`](apps/studio/) (run `npm ci && npm run dev` there), is kept for Round 2, and is not part of the Round 1 submission. Its docs:
[README](apps/studio/README.md) · [Architecture](apps/studio/ARCHITECTURE.md) · [Pipeline](apps/studio/PIPELINE.md) · [Capture SOP](apps/studio/CAPTURE_SOP.md) · [Validation](apps/studio/VALIDATION.md) · [Roadmap](apps/studio/ROADMAP.md) · [Decision log](apps/studio/DECISION_LOG.md) · [Windows setup](apps/studio/WINDOWS_SETUP.md)

Phone pairing over the LAN has its own executable runbook: [docs/PAIRING.md](docs/PAIRING.md).

## Credits
COLMAP (BSD), Brush (Apache-2.0), splat-transform (MIT), Spark (MIT), three.js (MIT), react-three-fiber (MIT), React (MIT), Vite (MIT), FFmpeg (LGPL/GPL), OpenCV (Apache-2.0), NumPy (BSD). Studio app (`apps/studio`): PlayCanvas (MIT), zod (MIT).
