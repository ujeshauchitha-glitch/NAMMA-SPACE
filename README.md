# Namma Space

Smartphone video of an indoor space becomes a photorealistic 3D digital twin that anyone can walk through in a browser.
Techfest 2026-27, IIT Bombay, Round 1. Team TM-12354C3F6F2, Vellore Institute of Technology.

**Live site: <https://namma-space-pearl.vercel.app>.** It opens on our classroom, reconstructed from one phone video. Mirror: <https://ujeshauchitha-glitch.github.io/NAMMA-SPACE/>.

Click **Enter walkthrough** on the live site, then use the controls below. Nothing needs installing.

| Action | Keys and mouse |
|---|---|
| Look around | mouse, after clicking the view |
| Walk | `W` `A` `S` `D` or arrow keys |
| Full screen | `F` |
| Release the mouse | `Esc` |
| Find a place | `Ctrl+K` / `Cmd+K`, or the search box |

## What is in this repository

| Folder | Contents |
|---|---|
| `pipeline/` | Reconstruction pipeline (Python): video to frames, COLMAP camera poses, Brush Gaussian-splat training, cleanup, compression and a scene bundle for the web app |
| `apps/studio/` | **The web app on the live site**: React + PlayCanvas viewer with walkthrough and collision, place search, route planning, and Capture Studio for preparing photo captures |
| `scripts/` | One-time tool setup (`setup_tools.ps1` for Windows, `setup_tools.sh` for Linux, untested) |
| `tests/sample_data/` | A 36 s clip of our real classroom capture, plus small synthetic inputs, with run instructions |
| `docs/` | Capture SOP, Windows step-by-step guide, status and open issues |
| `docs/submission/` | Round 1 Technical Abstract and links PDFs, with their HTML sources |
| `viewer/` | Our earlier Spark-based viewer, kept for reference; the live site uses `apps/studio/` |

## Scenes on the live site

| Scene | Source |
|---|---|
| **Classroom** (default) | our phone video, reconstructed with this pipeline into a Gaussian splat |
| Workshop room | our 70 phone photos; sparse COLMAP model |
| Apartment | external benchmark dataset: Meta's Eyeful Tower "apartment" (MIT licence), splat trained by us with Brush |
| Synthetic and procedural fixtures | generated test scenes, labelled as such |

## Run the web app locally

Needs Node.js 22 or newer.

```bash
cd apps/studio
npm ci
npm run dev      # http://localhost:5173
npm test         # unit tests
npm run build    # production build in apps/studio/dist
```

## Reconstruct a space

Reconstruction runs on one Windows PC with an NVIDIA GPU. Only COLMAP's feature extraction and matching need NVIDIA (its CUDA build); Brush trains through WebGPU on any recent GPU. Plan for at least 25 GB of free disk.

**1. Install the tools once** (COLMAP, Brush, splat-transform, ffmpeg, Node.js and a Python virtual environment, all into this folder):

```powershell
git clone https://github.com/ujeshauchitha-glitch/NAMMA-SPACE
cd NAMMA-SPACE
powershell -ExecutionPolicy Bypass -File scripts\setup_tools.ps1
.venv\Scripts\python pipeline\run_pipeline.py --doctor
```

Every `--doctor` line should say `OK`. To mask people out of the training frames, also run `.venv\Scripts\pip install ultralytics`.

**2. Film the space** by following the [capture SOP](docs/SOP.md): one continuous landscape video per room, at least 31 s and ideally 60 to 120 s, at walking pace, with exposure and focus locked.

**3. Run the pipeline:**

```powershell
.venv\Scripts\python pipeline\run_pipeline.py C:\captures\room.mp4 --out work\room --check
.venv\Scripts\python pipeline\run_pipeline.py C:\captures\room.mp4 --out work\room --title "My room" --mask-people
```

The first command only validates the video. The second runs every stage:

1. sample frames and drop blurred ones;
2. solve camera poses with COLMAP, retrying with exhaustive matching if too few frames are placed;
3. map coverage and write a re-film list;
4. optionally mask people;
5. train the splat with Brush;
6. clean it up;
7. check it;
8. compress it to `.sog` under 50 MB;
9. build the scene bundle.

Each stage records its results in `work\room\report.json`.

**4. View it.** Copy `work\room\bundle\` to `apps\studio\public\scenes\room\`, start the app (`npm run dev` in `apps/studio`) and open `http://localhost:5173/?scene=/scenes/room/manifest.json`. Walk the whole room. If it looks right, record your sign-off:

```powershell
.venv\Scripts\python pipeline\run_pipeline.py --approve work\room --note "what you checked"
```

A fuller walkthrough, including troubleshooting, is in [docs/HANDOFF_UJESHA.md](docs/HANDOFF_UJESHA.md).

## Sample data

[`tests/sample_data/`](tests/sample_data/README.md) holds `capture_short.mp4`, a 36 s, 1280×720 excerpt of our classroom capture. Its README gives the exact commands to validate it, reconstruct it and walk the result, and lists the outputs to expect.

## Limitations

- **Scale is estimated.** It comes from an assumed 1.45 m camera height, so expect roughly 15 % error until a measured distance is added.
- **Collision is approximate.** It uses a 10 cm grid derived from COLMAP's sparse points; walls and desks block movement, and unfilmed areas are closed off.
- **Hard surfaces.** Mirrors, glass and blank walls reconstruct poorly, and rarely filmed areas such as the classroom ceiling look foggy.

## Credits

Open-source tools and datasets, with licences, are listed in the Technical Abstract ([docs/submission](docs/submission)) and in [submission/THIRD_PARTY_NOTICES.md](submission/THIRD_PARTY_NOTICES.md).
