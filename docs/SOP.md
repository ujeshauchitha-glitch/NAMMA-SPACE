# Capture SOP: smartphone video to 3D walkthrough

Goal: a non-expert captures a floor with one phone in under 15 minutes per ~100 m², and the pipeline needs no manual modelling.

## Equipment
- Any smartphone from the last ~4 years. No tripod, no extra sensors required.
- Optional: a tape measure, or a floor plan, for scale (see *Scale*).

## Phone settings (do once)
| Setting | Value | Why |
|---|---|---|
| Resolution / fps | 4K or 1080p, 30 fps | frames are sampled at ~3 fps, so resolution matters more than frame rate |
| Stabilisation | **Off** (or "standard", never "cinematic/horizon lock") | digital stabilisation warps frames and breaks camera calibration |
| Focus / exposure | Lock AE/AF on first frame (long-press) | prevents focus hunting and brightness pumping between frames |
| Zoom | Wide (1x) lens, **never zoom** | one fixed intrinsic camera model for the whole capture |
| Orientation | Landscape | wider overlap while turning |
| Lighting | Lights on, blinds open, no flash | consistent, even exposure |

## Preparing the space
1. Switch on every light; open curtains. Avoid direct sun beams (blown highlights).
2. Close doors you do *not* want mapped; **open and wedge** doors you do.
3. Remove moving things: people, pets, swinging doors, screens playing video.
4. Mirrors and glass are the one thing this method cannot reconstruct: cover or avoid them where possible.

## Capture path (the "lawnmower + loop")
Walk slowly (~0.5 m/s, a slow stroll), holding the phone at chest height, in one continuous take per room.

1. **Perimeter loop.** Start at the doorway. Walk along the walls with the camera angled ~20° toward the wall, around the whole room, and return to the start. The closed loop is what lets the solver cancel drift.
2. **Centre pass.** Walk a straight line through the middle, then a second line offset ~1.5 m, camera facing forward and slightly down so floors are covered.
3. **Corners.** At each corner, stop and pan slowly 90° left-right from the corner outward (pivot on the spot, keep the phone moving smoothly, never snap).
4. **Doorways and transitions.** Every doorway is crossed *slowly and twice*: forward, then turn and cross back looking at where you came from. Keep both rooms visible in the frame when standing in the doorway. This overlap is what joins rooms into one model.
5. **Furniture.** For each large item (sofa, table, shelves), walk a half-arc around it at ~1 m so it is seen from at least three angles.
6. **Stairs / level changes** are captured as separate floors, joined later by a shared POI (e.g. "Stairs"); Round 1 targets a single level.

Rules of thumb
- **Overlap:** every surface should appear in 3+ frames from different positions. Sample at 3 fps while walking at 0.5 m/s means ~17 cm between frames: far more than enough.
- **Never rotate in place quickly.** Fast rotation is the top cause of blurred frames and failed reconstruction. If you need to look around, pan at about 20°/s.
- **Texture-less walls** (plain white) are hard for feature matching: include nearby edges, skirting, switches, or posters in the frame so there is something to track.
- Finish where you started.

## Output of capture
One video per room or one per floor, named `<space>_<room>.mp4`, plus an optional `plan.png` / measured width of one doorway for scale.

## Quality checklist (60 seconds, on the phone before leaving)
- [ ] Scrub the video: no section is blurry or dark.
- [ ] Each doorway has a clear crossing in both directions.
- [ ] You ended where you started.
- [ ] No people walking through frame for more than a couple of seconds.

## Processing (automated)
`python pipeline/run_pipeline.py <video> --out work/<name>`

| Stage | Tool | What happens | Typical time (RTX 5060 8 GB) |
|---|---|---|---|
| Frame extraction | ffmpeg + OpenCV | 3 fps, 1600 px, blurriest 15% dropped (Laplacian variance) | seconds |
| Structure-from-motion | COLMAP | SIFT features, sequential matching, incremental mapping, undistortion | ~5-15 min for ~500 frames |
| Splat training | Brush (WebGPU) | 30k steps 3D Gaussian Splatting | ~15-30 min |
| Compress | splat-transform 3.10.3 | `.ply` → `.sog` (fallback `.spz`) under 50 MB: drops SH bands, then decimates only if still too big | ~1 min |
| Publish | script | compressed splat + `scene.json` into `work/<name>/web/` and `viewer/dev-assets/models/` for local inspection; the raw `.ply` never goes into the viewer | seconds |

*Times are estimates; measured values go in the abstract after the first full run.*

## Pass criteria (enforced by the pipeline)
Run `python pipeline/run_pipeline.py clip.mp4 --out work/<name> --check` right after capture; it validates before any processing.

| Stage | Blocks the run if | Recorded as a warning if |
|---|---|---|
| Input video | short side < 720 px; < 20 s; too short to give 80 usable frames at `--fps` (31 s at the default 3 fps); > 900 s; < 10 GB free disk; unreadable file | < 30 s; < 24 fps |
| Input photos | < 40 photos; unreadable files | mixed resolutions |
| Frames | video: < 80 usable frames after blur removal; photos: < 40 images | |
| COLMAP | no model; < 60% of frames registered; < 2000 sparse points | 60-90% registered; reprojection error > 1.5 px; more than one disconnected model |
| Splat file | missing/empty; not a binary PLY; missing 3DGS attributes; truncated; NaN values; < 50,000 splats | |

These checks only prove the output is well-formed. A synthetic file passes them too. Success is declared only by a person: walk the whole room in the viewer, check walls, floor, doorways and furniture, then run `--approve <workdir> --note "what you checked"`. `work/<name>/report.json` holds the state (`failed`, `automated_checks_passed_awaiting_inspection`, `inspected_ok`), measured stage timings and every check result.

## Scale and orientation
COLMAP output has arbitrary scale and orientation. `scene.json` carries `rotation` (flips COLMAP's Y-down into Y-up) and `scale`. Set `scale` as `real_distance / model_distance` using one known length (a doorway ≈ 0.9 m, or a tape-measured wall). `spawn` places the first-person camera on the floor. This step is a one-line config edit, not 3D modelling; automatic floor-plane fitting (RANSAC on splat centres) is planned for Round 2 because navigation needs a true floor.

## Failure modes and fixes
| Symptom | Cause | Fix |
|---|---|---|
| COLMAP registers <60% of frames | blur, too fast, plain walls | re-shoot slower, add textured anchors |
| Model splits into two pieces | doorway crossing too quick | re-shoot doorway with both rooms in frame |
| "Floaters" / fog in the splat | specular surfaces, moving people | crop in viewer bounds; re-shoot without movers |
| Warped straight walls | stabilisation or zoom was on | disable, re-shoot |
