# Namma Space

Smartphone video of an indoor space → photorealistic 3D digital twin → first-person walkthrough in the browser.
Round 1 of Techfest 2026-27 (reconstruction and roaming). POIs, search and pathfinding are Round 2.

## Architecture

```
phone video ──► ffmpeg + blur filter ──► COLMAP (poses) ──► Brush (3D Gaussian Splatting) ──► scene.ply
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

See [docs/SOP.md](docs/SOP.md) for the capture procedure.

## Run the viewer (no reconstruction needed)

```bash
cd viewer
npm install
npm run dev        # http://localhost:5173
```

Until a real capture is processed the viewer shows "no capture installed". To smoke-test the viewer only, open `/?scene=fixtures/SYNTHETIC/synthetic_room.json`: a procedurally generated box room (`pipeline/make_demo_splat.py`) with a permanent on-screen **SYNTHETIC** badge. It is **not** a reconstruction.
Any splat can be loaded with `?splat=<url>`.

## Reconstruct your own space (Windows, NVIDIA GPU)

```powershell
./scripts/setup_tools.ps1                        # downloads COLMAP + Brush into ./tools, installs ffmpeg
py -3.12 pipeline/run_pipeline.py path\to\capture.mp4 --out work\home --title "My Home"
cd viewer; npm run dev
```

Then edit `viewer/public/models/scene.json` (`spawn`, `scale`, `rotation`) to align the model; see *Scale and orientation* in the SOP.

## Controls
`W A S D` move · mouse look (click to capture) · `Shift` sprint · `Q`/`E` lower/raise · `Esc` release mouse. Touch: drag to look, two fingers to walk.

## Layout
```
pipeline/   run_pipeline.py (video → splat), make_demo_splat.py
scripts/    setup_tools.ps1
viewer/     web app
docs/       SOP.md
tests/      sample data (see tests/sample_data/README.md)
```

## Status
- [x] Viewer: first-person walkthrough, config-driven scene, touch fallback
- [x] Pipeline scripts and SOP
- [ ] Real capture + first full reconstruction (pipeline stages COLMAP/Brush are untested until footage exists)
- [ ] Deploy viewer to static hosting, record demo video, write abstract PDF
- [ ] Compress splat for fast web load (`.spz`)

## Credits
COLMAP (BSD), Brush (Apache-2.0), Spark (MIT), three.js (MIT), react-three-fiber (MIT).

