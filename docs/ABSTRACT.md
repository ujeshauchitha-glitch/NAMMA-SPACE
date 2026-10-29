# Namma Space: Technical Abstract (Round 1)

> **Source document for the required PDF (max 5 pages).** Adapted from the draft that
> was stranded on `origin/ujesha/local-viewer-pipeline` (commit `c305a36`, 26 Oct 2026)
> and rewritten against verified reality on **29 Oct 2026**. Every number below is
> either measured in this repository or explicitly labelled as a blocker/untested.
> **Fields marked `[FILL]` must be completed by the team before PDF export — they are
> deliberately not guessed.**

Team: `[FILL: names, institutes]` · Team ID: `[FILL]` ·
Repo: https://github.com/ujeshauchitha-glitch/NAMMA-SPACE ·
Live viewer: *not deployed for Round 1 (run locally — see `docs/SUBMISSION_ROUND1.md` §4)*

## 1. Problem and approach

Turn an ordinary smartphone capture of an indoor space into a photorealistic 3D model
that anyone can walk through in a web browser, with no manual 3D modelling. Round 1
covers capture procedure, reconstruction, and free-roaming first-person exploration.
Points of interest, search and path planning are Round 2; they exist in the repository
only as synthetic-scene groundwork and are **not claimed as part of this submission's
results**.

Approach: structure-from-motion (COLMAP) recovers camera poses and a sparse point
cloud; 3D Gaussian Splatting (Brush) trains a photorealistic scene; the splat is
compressed and rendered in the browser. Splats are a *rendering* representation, not
collision geometry — the navigation representation for Round 2 is designed separately
(section 8).

## 2. Architecture

```
smartphone capture -> frame extraction + blur filter -> COLMAP (camera poses, sparse model)
   -> Gaussian-splat training (Brush; Nerfstudio optional) -> output checks -> compressed web copy (.sog/.spz)
   -> static web viewer (React + TypeScript + Vite + react-three-fiber + Spark)
```

Each stage is a separate command with its own output check, so any stage can be re-run
or moved to another machine (the COLMAP output folder is the hand-off to a GPU box).
A single dependency `--doctor` command reports the health of every tool before any
compute is spent.

## 3. Capture SOP (summary)

Full procedure: `docs/SOP.md`; field card: `docs/CAPTURE_DAY.md` / `docs/SOP.md`.

- **One lens, stabilisation off, focus/exposure locked:** digital stabilisation warps
  frames and breaks pose estimation; one fixed camera model keeps COLMAP calibrated.
- **Slow walk (~0.5 m/s), no fast rotation:** blur is the main cause of failed
  reconstruction.
- **Perimeter loop + centre passes + corner pans + two-way doorway crossings +
  half-arcs around furniture:** every surface seen from ≥3 positions; the closed loop
  cancels drift; **doorway overlap is what joins two rooms into one model** — the
  specific requirement our first real capture violated (section 5).
- Capture as **video** where possible (the default sequential matcher expects it) and
  at **native camera resolution** — messaging-app transfers compress and strip EXIF.

## 4. Reconstruction pipeline and gates

1. **Input validation** (resolution, duration, frame rate, disk, readability) rejects
   unusable captures before compute is spent.
2. **Frames:** sampled at a fixed fps; blurriest 15 % removed by Laplacian variance.
3. **COLMAP:** SIFT features, matching, incremental mapping, undistortion, using the
   `SIMPLE_RADIAL` camera model (see below). Hard gates, never weakened:
   **≥60 % of frames registered in one connected model**, **≥2000 sparse points**,
   **mean reprojection error ≤1.5 px**, no room split. A failing run exits non-zero and
   says why; it is never dressed up as a success.
4. **Splat training:** Brush (WebGPU; no CUDA toolkit build), then **output checks**:
   3DGS attributes present, size matches header, finite values, sane extent.
5. **Web copy:** lossy `.sog`/`.spz` compression via splat-transform (raw `.ply` never
   published).
6. **Human inspection gate:** a run is only ever called successful after a person walks
   the whole result and approves it (`inspected_ok`); automated passes end at
   `automated_checks_passed_awaiting_inspection`.

**Pipeline defect found & fixed during Round 1 prep:** the adapter forced COLMAP's
`OPENCV` camera model, which failed on real phone photos (2/70 registered). Root cause
isolated by A/B on identical inputs — `SIMPLE_RADIAL` registers 40–59/70 where
`OPENCV` managed 2–20/70 (commit `a4299f5`; flag modernisation for COLMAP 4.x in
`7f4f060`). Real-photo registration went from **3 % → 57 %** with no other change.

## 5. Current results (verified 29 Oct 2026 — honest status)

| | Result |
|---|---|
| Real capture | 70 phone photos (28 Oct, WhatsApp-transferred, normalised to 740×1600). **Best run: 40/70 (57 %) registered in one connected model + a disconnected 17-image fragment; 2966 sparse points ✓; 0.92 px reprojection ✓. Fails the ≥60 % gate → blocked (`BLK-001`).** Two independent runs produced the identical split (no doorway overlap between room halves). A disclosed 40-image subset run registers 72 % but triangulates only **886 < 2000** points — the WhatsApp JPEGs themselves lack texture/parallax. Full run-by-run record: `docs/CAPTURE_DAY.md`. |
| Real 3D reconstruction / trained splat | **None exists.** Both runs stopped honestly at the sparse gate; dense MVS and training require CUDA (team GPU host is the continuation path). No screenshots of a real room will be shown because there is nothing to show. |
| Software verification | vitest **591/591**, pytest **65/65**, Playwright E2E **28/28**, typecheck 0, lint 0 errors, quality gate **10/10 `GATE_EXIT=0`**, scene bundles **2/2**, entry chunk **139,693 B gzip vs 360 KB budget**. |
| Demonstrable today | Capture Studio (photo → ZIP bundle ingest), Live Scan phone-pairing journey *(not hardware-tested)*, POI search + A* routing and a three.js coverage visualizer **on synthetic scenes only**, plus the first-person splat viewer walking a badged `SYNTHETIC` room. |

Interpretation: the pipeline and viewer behave exactly as designed — including refusing
to pass a weak capture — and the remaining gap is capture quality plus CUDA-bound
dense/training stages, not hidden software success.

## 6. Web viewer

React + TypeScript + Vite; Three.js through react-three-fiber; Spark renders `.ply`,
`.spz` or `.sog` splats. First-person controls: pointer-lock mouse look, WASD, sprint,
height adjust; touch fallback (drag to look, two fingers to walk). The scene is
described by `scene.json` (splat URL, spawn, orientation, scale, walk bounds), so a new
capture needs no code change; missing files produce a clear load-error screen with
progress. **Performance: no frame-rate numbers are claimed** — measurements on the
development hardware are unreliable; the measured budgets are build-time (entry chunk
139,693 B gzip against a 360 KB budget).

## 7. Limitations

- **No successful real reconstruction yet (BLK-001)** — one capture attempt, precisely
  diagnosed; a re-shoot per SOP is the continuation (doorway overlap, native files,
  video). Every demonstrated 3D scene is synthetic and badged `SYNTHETIC`.
- **No collision** in Round 1: the viewer can walk through walls except for an optional
  bounding rectangle. Scale and orientation are set by hand in `scene.json`.
- Mirrors, glass, plain walls, low resolution and messaging-app compression all degrade
  reconstruction (the last two are documented in our own capture record).
- Splat compression is `.sog`/`.spz` tooling validated on synthetic files only; a
  real-scene compression check is pending together with the re-shoot.
- Dense MVS + training need an NVIDIA GPU; the viewer needs only WebGL2.
- Device-to-device Live Scan pairing is **wired and unit-tested but not
  hardware-tested**; accessibility/safety validation has not been performed.

## 8. Round 2 design (not claimed as implemented)

POIs as JSON in the same metre-scaled coordinates; a walkable-area grid with A*
pathfinding (an admissible octile heuristic for the 8-connected grid is implemented and
unit-tested, `6df7d8c`, but only ever exercised on synthetic scenes). Because splats
carry no reliable surfaces, the grid is hand-authored from a floor plan, with automatic
floor-plane fitting on COLMAP's sparse points as the planned upgrade. AR navigation is
deferred.

## 9. Tools and licences

COLMAP (BSD), Brush (Apache-2.0), Nerfstudio/gsplat (Apache-2.0, optional), Spark (MIT),
three.js (MIT), react-three-fiber (MIT), React (MIT), Vite (MIT), OpenCV (Apache-2.0),
FFmpeg (LGPL/GPL build), splat-transform (MIT), PlayCanvas (MIT, studio app). Synthetic
test fixtures exist in the repo for viewer/validator smoke tests; they are badged in the
viewer and are **not part of the results**.
