# Namma Space: Technical Abstract (Round 1)  — DRAFT

> **Draft status.** Everything marked **[TBD]** must be filled from a real capture and the pipeline's `report.json`. Do not submit with a TBD, and do not replace one with an estimate. Max 5 pages as a PDF.

Team: [TBD names, institutes] · Team ID: [TBD] · Repo: https://github.com/ujeshauchitha-glitch/NAMMA-SPACE · Live viewer: [TBD URL]

## 1. Problem and approach
Turn an ordinary smartphone video of an indoor space into a photorealistic 3D model that anyone can walk through in a web browser, with no manual 3D modelling. Round 1 covers capture procedure, reconstruction, and free-roaming first-person exploration. Points of interest and path planning (Round 2) are designed for but not part of this submission.

Approach: structure-from-motion to recover camera poses, then 3D Gaussian Splatting to train a photorealistic scene, rendered in the browser. Splats are a rendering representation, not collision geometry; the navigation representation for Round 2 is therefore planned separately (section 6).

## 2. Architecture
```
smartphone video -> frame extraction + blur filter -> COLMAP (camera poses, sparse model)
   -> Gaussian-splat training (Brush, or Nerfstudio splatfacto) -> checks -> compressed web copy
   -> static web viewer (React + TypeScript + Vite + react-three-fiber + Spark)
```
[Insert architecture figure.] Each stage is a separate command with its own output check, so a stage can be re-run, or moved to another machine (the COLMAP output folder is the hand-off to a GPU machine).

## 3. Capture SOP
(Full procedure in `docs/SOP.md`.) Key rules and why:
- 1x lens, stabilisation off, locked focus/exposure: one fixed camera model; digital stabilisation warps frames and breaks pose estimation.
- Slow walking (~0.5 m/s), no fast rotation: blur is the main cause of failed reconstruction.
- Perimeter loop + centre passes + corner pans + two-way doorway crossings + half-arcs around furniture: every surface seen from 3+ positions; the closed loop lets the solver cancel drift; doorway overlap joins rooms.
- Optional station layout: standing stations on a ring around the room's centre with a three-tilt turn at each, for small rooms or weak coverage **[TBD: used or not; result]**.
- Quality checklist on the phone before leaving the room.

## 4. Reconstruction pipeline
1. **Input validation** (resolution, duration, frame rate, disk, readable file) rejects unusable captures before any compute is spent.
2. **Frames:** sampled at [TBD fps], max width [TBD px], blurriest 15% removed by Laplacian variance; [TBD] frames kept.
3. **COLMAP:** SIFT features, sequential matching (video), incremental mapping, undistortion. Result: [TBD]/[TBD] frames registered ([TBD]%), [TBD] sparse points, mean reprojection error [TBD] px. The run is stopped if fewer than 60% of frames register.
4. **Splat training:** [Brush / Nerfstudio], [TBD] steps on [TBD GPU]; [TBD] splats; training time [TBD].
5. **Output checks:** file parses, has all 3DGS attributes, size matches header, finite values, sane extent.
6. **Web copy:** lossy `.sog`/`.spz` compression via splat-transform: [TBD] MB vs [TBD] MB PLY; visual comparison [TBD].
7. **Human inspection gate:** a run is only called successful after a person walks the whole result and approves it (`inspected_ok`). Inspection note: [TBD].

## 5. Web viewer
React + TypeScript + Vite; Three.js through react-three-fiber; Spark renders the splats. First-person controls: pointer-lock mouse look, WASD, sprint, height adjust; touch fallback (drag to look, two fingers to walk). Scene is described by `scene.json` (splat, spawn, orientation, scale, walk bounds), so a new capture needs no code change. Loading indicator and load-error screen included. Measured performance: [TBD fps on TBD device; load time TBD; asset size TBD]. Deployed as a static site on GitHub Pages.

## 6. Design for Round 2 (not claimed as implemented)
POIs as JSON in the same metre-scaled coordinates; a walkable-area grid with A* pathfinding. Because splats carry no reliable surfaces, the grid is initially hand-annotated from a floor plan, with automatic floor-plane fitting on COLMAP's sparse points as the planned upgrade. AR navigation is deferred.

## 7. Results
[TBD: screenshots of the real walkthrough; table of the numbers above; honest artefacts: floaters, holes, blur, mirrors/glass.]

## 8. Limitations
- No collision in Round 1: the viewer can walk through walls except for an optional bounding rectangle.
- Scale and orientation are set by hand in `scene.json` after reconstruction.
- Mirrors, glass, plain white walls and moving people degrade the result.
- Splat compression is lossy and was first tested on a synthetic file only. [TBD: real-scene check]
- Reconstruction needs an NVIDIA GPU (COLMAP CUDA build); the viewer needs only WebGL2.
- [TBD: anything else observed on the real capture.]

## 9. Tools and licences
COLMAP (BSD), Brush (Apache-2.0), Nerfstudio/gsplat (Apache-2.0, optional), Spark (MIT), three.js (MIT), react-three-fiber (MIT), React (MIT), Vite (MIT), OpenCV (Apache-2.0), ffmpeg (LGPL/GPL build), splat-transform (MIT). A synthetic test fixture exists in the repo for viewer smoke tests; it is badged in the viewer and is not part of the results.
