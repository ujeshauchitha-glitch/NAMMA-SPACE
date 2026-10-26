# Tech stack: what we use, what we deferred, and when to revisit

Principle (Nilesh's "downscale the tech stack"): every component has to earn its place for Round 1-2. A component on the deferred list is not rejected; it has a trigger that brings it back.

Suggestions from the team's stack table (Oct 2026) are marked **[table]**. Claims in that table about third-party tools are unverified unless marked as tested here.

## In use (Round 1)
| Part | Choice | Notes |
|---|---|---|
| Frontend | React + TypeScript + Vite | table agrees: keep |
| 3D | three.js via react-three-fiber (Canvas + hooks only) + Spark splat renderer | `@react-three/drei` removed: it was never imported |
| Poses | COLMAP | baseline; alternatives only if it fails (below) |
| Splat training | Brush (default), Nerfstudio splatfacto (option) | `--trainer`; Brush needs no CUDA toolkit, Nerfstudio is for Linux/WSL2/A4000 |
| Pipeline | Python CLI (`pipeline/`), JSON report | no server |
| Scene description | `viewer/public/models/scene.json` | no database |
| Hosting | static frontend; large splat on separate storage | host must allow files over 100 MB (not checked yet) |

## Decided for Round 2 (kept small)
| Need | MVP | Upgrade path |
|---|---|---|
| Walkable area | hand-annotated 2D floor grid (walls, furniture as blocked cells), A* | fit the floor plane to COLMAP's sparse points with Open3D (RANSAC) |
| POIs | JSON list: id, label, category, x/y/z | **[table]** SAM 2 / CLIP candidate suggestions: experimental only, never a source of final names or coordinates |
| Shared coordinates | one `scene.json` that points to splat, nav grid and POIs, all in the same metre-scaled frame | **[table]** versioned scene bundle: adopt the idea; add a `version` field when Round 2 files appear |

## Deferred, with the trigger that brings each back
| Component | Why not now | Revisit when |
|---|---|---|
| PlayCanvas engine + `@playcanvas/react` **[table]** | would replace a viewer that already works; Spark reads SOG, SPZ and compressed PLY natively, so compressed delivery does not need it (Spark README) | Spark cannot hit 30 fps on the lab PC with a real splat |
| SOG / SPZ compression **[table]** | works on the synthetic fixture (4-10x smaller, see below); 15-20x claim unverified on real data | decide per real splat: ship the compressed copy if quality holds |
| OpenMVS dense mesh | heavy, awkward on Windows, and Round 2 only needs a floor and obstacles | the annotated grid proves too inaccurate |
| Recast/Detour navmesh | grid + A* is enough for one floor | multi-floor or a very large venue |
| VGGT, AMB3R, HunyuanWorld-Mirror **[table]** | not verified by us; COLMAP has not failed yet | COLMAP registers under 60% of frames on two honest captures |
| FastAPI + worker + job queue **[table]** | the pipeline is a CLI; no user uploads in Rounds 1-2 | Round 3 needs on-site processing from a UI |
| Object storage + CDN | one static splat file | multiple scenes or large assets |
| AR (ARCore / WebXR) | needs localisation against the twin; Round 3 bonus | desktop viewer, POIs and navigation are done |

## Compression experiment (2026-10-26)
Tool: `@playcanvas/splat-transform` 3.10.3 (MIT), run with `npx --yes @playcanvas/splat-transform@3.10.3 -w in.ply out.<ext>` after the user approved running it. Input: the **synthetic** fixture (105,991 splats), so the ratios below are illustrative only, not a prediction for a real room.

| Format | Size | Conversion time | Loads in the viewer |
|---|---|---|---|
| PLY (original) | 6.87 MB | - | yes |
| `.compressed.ply` | 1.65 MB (4.2x smaller) | 1.4 s | yes, renders the same room |
| `.spz` | 0.86 MB (8.0x smaller) | 1.5 s | yes, renders the same room |
| `.sog` | 0.69 MB (10x smaller) | 1.8 s | yes, renders the same room |

Verified: all three convert, are loaded by Spark with no console errors, and show the room. **Not verified:** visual quality loss on a real scene (compression is lossy, so compare a real splat side by side), load time (the browser pane took 15-30 s even for these tiny files and splat fetches do not appear in its resource timings, so this test says nothing about load speed), and the table's 15-20x claim.

**Decision:** keep PLY as the pipeline's source of truth; produce a `.sog` or `.spz` copy for web delivery once the first real splat exists, and compare it with the PLY before shipping.

Other `splat-transform` features seen in its `--help` (not tried): `--filter-floaters`, `--filter-cluster`, `--filter-box` (crop to the room), and outputs `.glb` and `.voxel.json`. These may help clean a real splat and could feed Round 2's collision grid; test them on real data before relying on them.
