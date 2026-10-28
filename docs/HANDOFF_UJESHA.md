# Handoff: capture → compressed splat (Windows + NVIDIA)

For Ujesha. Goal: one real room, captured on a phone, reconstructed into `scene.sog` (≤ 50 MB) and sent to Ojas for hosting. Deadline: **31 Oct**. Everything below runs in **PowerShell** from the repo root unless a step says otherwise.

## 0. What changed since your last run
- The pipeline now has a **compress** stage. It turns Brush's `.ply` into `.sog` (or `.spz`) under 50 MB. The raw `.ply` stays in `work\`; nothing large goes into `viewer\public` any more.
- Python deps now live in a project venv: use `.venv\Scripts\python`, not `py -3.12`.
- `setup_tools.ps1` now redownloads COLMAP and Brush once, because your existing installs have no `.complete` marker (~600 MB). It also needs **Node.js ≥ 22** and installs it if missing.
- To local-test the synthetic room, open `/?scene=dev-assets/fixtures/SYNTHETIC/synthetic_room.json`.

## 1. Setup (once, ~15 min)
Requirements: Windows 10/11 x64, NVIDIA GPU with a current driver, Git, winget, and ≥ 25 GB free on the drive holding the repo.

```powershell
git clone https://github.com/ujeshauchitha-glitch/NAMMA-SPACE
cd NAMMA-SPACE
git checkout integration/round1
powershell -ExecutionPolicy Bypass -File scripts\setup_tools.ps1
.venv\Scripts\python pipeline\run_pipeline.py --doctor
```
Every `--doctor` line must say `OK`. If setup stops with "open a new terminal and re-run", do exactly that; it resumes where it stopped.

## 1b. Dry run first (~1 h, before the real capture)
This proves every stage works on your machine before the real capture is at stake.

1. Run setup and `--doctor` (section 1) until every line says `OK`.
2. Film a **~35 s test clip** of any textured corner (bookshelf, desk, posters), following the capture rules in section 2. It only needs to clear the 31 s minimum; quality doesn't matter.
3. Run the full pipeline on it, **including compress**:
   ```powershell
   .venv\Scripts\python pipeline\run_pipeline.py C:\captures\dryrun.mp4 --out work\dryrun --check
   .venv\Scripts\python pipeline\run_pipeline.py C:\captures\dryrun.mp4 --out work\dryrun --title "Dry run" --steps 7000
   ```
   `--steps 7000` keeps Brush short; the real run uses the default 30000.
4. Open `http://localhost:5173/?scene=dev-assets/models/scene.json` (section 4) and check that something recognisable renders.
5. **Report to Ojas before filming the real room**, even if everything passed:
   - setup problems, if any;
   - the `stages` block from `work\dryrun\report.json` (seconds per stage), plus `web_splat` (format, MB);
   - any error message, with `work\dryrun\logs\pipeline.log` attached.

   The compress stage (splat-transform) and the setup script have **never been run on Windows**, so this is their first real test.

## 2. Capture checklist (phone)
Full procedure: [SOP.md](SOP.md). The parts that decide success:

| | Rule |
|---|---|
| **Length** | **At least 31 s** at the default 3 fps: the pipeline needs 80 usable frames after dropping the blurriest 15 %, and `--check` rejects shorter clips. **Aim for 60–120 s per room.** Maximum 900 s. |
| Camera | Landscape, 1080p or 4K, 30 fps, **1x lens, no zoom**, stabilisation **off**, long-press to lock focus/exposure. |
| Pace | Slow walk (~0.5 m/s). Pan at most ~20°/s; never spin in place. |
| Path | Perimeter loop with the camera ~20° toward the wall, back to the start. Then 2 centre passes, a slow pan at each corner, and a half-arc round big furniture. **End where you started.** |
| Overlap | Every surface should be in 3+ frames from different positions. Cross doorways slowly, both ways. |
| Lighting | All lights on, curtains open, no direct sun beams, no flash. |
| Avoid | **Mirrors, glass and windows**: cover them or keep them out of frame. **Plain white walls**: keep edges, switches, skirting or posters in frame. **People moving.** |
| Before leaving | Scrub the video: nothing blurry or dark, doorways covered both ways. |

Copy the video to the PC, e.g. `C:\captures\lab_room1.mp4`.

## 3. Run the pipeline
```powershell
.venv\Scripts\python pipeline\run_pipeline.py C:\captures\lab_room1.mp4 --out work\lab_room1 --check
.venv\Scripts\python pipeline\run_pipeline.py C:\captures\lab_room1.mp4 --out work\lab_room1 --title "<Room name>"
```
The first command validates only (seconds). The second runs frames → COLMAP → Brush (30k steps) → compress → publish. Expect roughly 5–15 min for COLMAP and 15–30 min for Brush. It ends with `DONE, NOT YET VERIFIED` and prints where `scene.sog` is.

If a stage fails, the message says what to do; `work\lab_room1\report.json` and `logs\pipeline.log` have the details. Common cases:

| Message | Fix |
|---|---|
| `... gives ~N usable frames ... Film at least 31s` | Re-shoot longer, or add `--fps 4`. |
| `< 60% of frames registered` / `room split` | Blur or plain walls. Re-shoot slower, with textured edges in frame. |
| `COLMAP model ... Re-run with --force` | Add `--force` (it redoes everything from scratch). |
| `splat-transform could not write .sog or .spz` | Send Ojas `logs\pipeline.log`; the `.ply` is still in `work\lab_room1\splat_brush\`. |
| `Could not get the splat under 50 MB` | Retry with `--max-mb 80`, then tell Ojas the size. |

To change `--steps` or `--fps`, just re-run: a stale splat is never reused. `--force` wipes the work folder.

## 4. Inspect and align (~10 min)
```powershell
cd viewer
npm ci
npm run dev
```
Open `http://localhost:5173/?scene=dev-assets/models/scene.json`. Then edit `viewer\dev-assets\models\scene.json` and reload until it looks right:
- `rotation`: the default `[3.14159, 0, 0]` flips COLMAP's Y-down. If the floor is a wall, try `[1.5708, 0, 0]` or `[-1.5708, 0, 0]`.
- `scale`: real length ÷ model length, using one known distance (a doorway ≈ 0.9 m).
- `spawn`: a point on the floor inside the room. `eyeHeight` stays 1.6.
- `bounds` (optional): `[minX, maxX, minZ, maxZ]` to stop walking through walls.

Walk the whole room. Then, back in the repo root:
```powershell
.venv\Scripts\python pipeline\run_pipeline.py --approve work\lab_room1 --note "walked all walls, floor, door; minor floaters near window"
```

## 5. What to send Ojas
Put everything in the **shared Google Drive folder Ojas sends you**, in a subfolder named after the room (e.g. `lab_room1/`). Ojas uploads the splat to Hugging Face and updates the hosted viewer; you don't need a Hugging Face account. Do **not** commit any of these to git.

| File | Why |
|---|---|
| `work\lab_room1\web\scene.sog` (or `scene.spz`) | the compressed splat Ojas puts online |
| `work\lab_room1\report.json` | stage timings and check results, for the abstract |
| the raw capture video (e.g. `C:\captures\lab_room1.mp4`) | archive, and the source of the short clip in `tests/sample_data/` |
| 2–3 screenshots of the room in the viewer | for the abstract and video |
| `viewer\dev-assets\models\scene.json` (after aligning) | spawn / scale / rotation for the hosted viewer |
| `work\lab_room1\logs\pipeline.log` | only if something failed or looked odd |

Wait until Drive shows every upload as finished (large videos take a while), then message Ojas.

Keep the raw `.ply` (`work\lab_room1\splat_brush\splat.ply`) on your machine. Ojas will ask for it only if the compressed copy looks wrong.
