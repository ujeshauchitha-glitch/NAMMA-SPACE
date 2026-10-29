# Namma Space: Technical Abstract (Round 1)

Team: **[TBD names, institute]** Â· Team ID: **[TBD]** Â· Repo: https://github.com/ujeshauchitha-glitch/NAMMA-SPACE Â· Live viewer: **[TBD URL]**

## 1. Problem and approach
Turn an ordinary smartphone video of an indoor space into a photorealistic 3D model that can be walked through in a web browser, with no manual 3D modelling. Round 1 covers the capture procedure, reconstruction and free-roaming first-person exploration. Points of interest and path planning (Round 2) are designed for, not implemented.

Approach: structure-from-motion (COLMAP) recovers camera poses; 3D Gaussian Splatting (Brush) trains a photorealistic scene; the browser renders it with Spark. Splats are a rendering representation, not collision geometry, so the Round 2 navigation layer is planned separately (section 6).

## 2. Architecture
```
smartphone video -> validate -> frames + blur filter -> COLMAP (poses, sparse model)
  -> Gaussian-splat training (Brush) -> output checks -> compressed .sog -> web viewer
     (React + TypeScript + Vite + react-three-fiber + Spark)
```
Every stage is a separate command with its own output check, so a stage can be re-run or moved to another machine. A run is only reported successful after a person walks the result and approves it.

## 3. Capture SOP
Full procedure in `docs/SOP.md`. Rules and why:
- 1x lens, stabilisation off, locked focus/exposure: one fixed camera model; stabilisation warps frames and breaks pose estimation.
- Slow walking (~0.5 m/s), no fast rotation: blur is the main cause of failed reconstruction.
- Perimeter loop, centre passes, corner pans, two-way doorway crossings: every surface is seen from 3+ positions; the closed loop lets the solver cancel drift.
- Original-quality file: a WhatsApp-compressed 480p copy of a clip registered only 14% of frames; the original 1080p registered 94%.

## 4. Reconstruction pipeline
1. **Input validation** (resolution, duration, frame rate, disk space) rejects unusable captures before any compute is spent.
2. **Frames:** 3 fps, blurriest 15% dropped (Laplacian variance); 306 frames kept.
3. **COLMAP 4.2.1** (CUDA): SIFT features, exhaustive matching, incremental mapping. **287/306 frames registered (94%)**, 35,337 sparse points, mean reprojection error 0.81 px. The default sequential matcher registered only 27% of the same clip, so large rooms use exhaustive matching.
4. **Splat training:** Brush 0.3.0, 30,000 steps, RTX 5060 laptop GPU, **1,293,629 splats**, about 43 min wall-clock including thermal pauses; opacity and scale penalties raised (1e-8, 1e-7) and splats capped at 1.5M, which removed most floating fog.
5. **Output checks:** file parses, all 3DGS attributes present, size matches header, finite values, sane extent.
6. **Web copy:** splat-transform 3.10.3 to `.sog`: **19.6 MB** from a 305.3 MB PLY (budget 50 MB), 45 s.
7. **Human inspection gate:** `inspected_ok` is set only by `--approve` after a person walks the scene. **[TBD: inspection note]**

## 5. Web viewer
React + TypeScript + Vite; Three.js via react-three-fiber; Spark renders the splats. First-person controls: pointer-lock mouse look, WASD, sprint, height adjust; touch fallback. A scene is described by `scene.json` (splat, spawn, orientation, scale, walk bounds), so a new capture needs no code change. Measured performance: **[TBD fps / device / load time]**.

## 6. Design for Round 2 (not implemented)
POIs as JSON in metre-scaled coordinates; a walkable-area grid with A* pathfinding. Splats carry no reliable surfaces, so the grid is first hand-annotated from a floor plan, with floor-plane fitting on COLMAP's sparse points as the upgrade. AR navigation is deferred.

## 7. Results
First real capture: one classroom, 180 s, 1080p, handheld phone video.

![View toward the window wall](images/screenshot_1_window_wall.jpg){width=48%} ![View toward the opposite wall](images/screenshot_2_desks_floor.jpg){width=48%}

| Metric | Value |
|---|---|
| Frames registered | 287 / 306 (94%) |
| Sparse points / reprojection error | 35,337 / 0.81 px |
| Splats | 1,293,629 |
| Web file | 19.6 MB (.sog) |
| Training / compression time | ~43 min / 45 s |

Observed artefacts: the ceiling is hazy (rarely filmed) and moving people leave faint ghosts. The first training with default settings left heavy floating fog mid-room (1.83M splats, 27.7 MB); raising the opacity/scale penalties removed most of it with fewer splats and a smaller file.

## 8. Limitations
- No collision in Round 1: the viewer can walk through walls except for an optional bounding rectangle.
- Scale and orientation are set by hand in `scene.json`; the first scene's scale is not yet metric.
- Mirrors, glass, plain walls and moving people degrade the result.
- Splat compression is lossy; reconstruction needs an NVIDIA GPU, the viewer needs only WebGL2.
- Training on a laptop required thermal throttling (paused 136 times); a desktop GPU avoids this.

## 9. Tools and licences
COLMAP (BSD), Brush (Apache-2.0), Spark (MIT), three.js (MIT), react-three-fiber (MIT), React (MIT), Vite (MIT), OpenCV (Apache-2.0), ffmpeg, splat-transform (MIT).

