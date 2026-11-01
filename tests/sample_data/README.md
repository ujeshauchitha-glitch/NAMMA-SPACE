# Sample data

| File | What it is | Use it for |
|---|---|---|
| `capture_short.mp4` | 36 s, 720p excerpt of our real classroom capture (phone video, 29 Oct 2026) | running the reconstruction pipeline end to end on real footage |
| `images/`, `synthetic_clip.mp4`, `synthetic_capture_bundle.zip` | small **synthetic** inputs | checking the studio's capture-ingest tools; see [EXPECTED.md](EXPECTED.md) and [PROVENANCE.md](PROVENANCE.md) |

The full classroom that the live site opens on was built from the 180 s original of this clip. Its scene bundle is in `apps/studio/public/scenes/classroom/`.

## Reconstruct the sample clip

You need a Windows PC with an NVIDIA GPU, set up once as described in the main [README](../../README.md#reconstruct-a-space) (`scripts\setup_tools.ps1`). Run all commands from the repository root.

**1. Validate (seconds).**
```powershell
.venv\Scripts\python pipeline\run_pipeline.py tests\sample_data\capture_short.mp4 --out work\sample --check
```
Expect every dependency line to say `OK`, then `[PASS] input looks usable` and `OK: dependencies and input look usable. Nothing was processed (--check).` At the default 3 fps, 36 s gives 108 frames, or about 92 after the blur filter; the minimum is 80.

**2. Full run.**
```powershell
.venv\Scripts\python pipeline\run_pipeline.py tests\sample_data\capture_short.mp4 --out work\sample --title "Sample classroom" --mask-people
```
The run goes through frames, camera poses, coverage, people masking, training, cleanup, checks, compression and publishing. It ends with `DONE, NOT YET VERIFIED`. We have not timed this excerpt; as an estimate, expect well under an hour on an RTX-class laptop, since the 180 s original is five times longer. The excerpt covers only part of the room, so the model shows that part, and the coverage step writes a re-film list for the rest.

Outputs, all in `work\sample\`:
- `report.json`: status, stage timings, registration ratio and every check
- `web\scene.sog`: the compressed splat, at most 50 MB
- `bundle\`: the scene bundle for the studio viewer (manifest, splat, navigation grid, start point, quality report)
- `coverage\`: top-down coverage map and `RECAPTURE.txt`

**3. Walk it in the studio viewer.** Copy `work\sample\bundle\` to `apps\studio\public\scenes\sample\`, then:
```powershell
cd apps\studio
npm ci
npm run dev
```
Open `http://localhost:5173/?scene=/scenes/sample/manifest.json`, click **Enter walkthrough**, and walk with W A S D and the mouse.
