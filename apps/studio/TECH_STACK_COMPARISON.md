# Namma Space — Technology Comparison

**Status:** Discovery recommendation, 24 October 2026  
**Evidence rule:** Published numbers and upstream requirements are marked as upstream claims. No performance number below is a Namma Space measurement; those require a controlled benchmark on the team’s target hardware.

## 1. Recommended stack at a glance

| Area | Round 1 recommendation | Later candidate | Decision status |
|---|---|---|---|
| Web app | React + TypeScript + Vite | Keep | Lock for viewer skeleton |
| Browser 3D | PlayCanvas Engine 2.x; GLB/glTF first | Native gsplat/SOG path, PlayCanvas SOG | Lock PlayCanvas path; experiment with splats |
| Capture ingest | Phone video/images + `ffmpeg`/OpenCV keyframes | Native ARKit/ARCore capture metadata | Lock simple ingest |
| Baseline reconstruction | COLMAP for poses/geometry, then Nerfstudio Splatfacto/gsplat or mesh export | VGGT/AMB3R/HunyuanWorld-Mirror benchmarked as optional initializers | Lock baseline; research adapters |
| Navigation geometry | Explicit floor/obstacle mesh → 2D occupancy grid + A* | Recast/Detour navmesh if grid proves insufficient | Lock grid for Round 2 |
| Semantic layer | Versioned JSON POI/room manifest | Detection, segmentation, OCR, image-text matching | Lock schema; automate later |
| Processing API | CLI worker first; FastAPI only for upload/job status | Queue/worker service and object storage | Avoid backend overbuild in Round 1 |
| Persistence | Versioned scene directory and manifest | Object storage + database when multiple venues/jobs require it | Local/reproducible first |

## 2. Viewer and delivery

### PlayCanvas Engine vs React Three Fiber

**Recommended:** React + TypeScript + Vite for the interface, with PlayCanvas Engine 2.x owning the 3D canvas.

Why it fits this project:

- It preserves a standard React application for search, POI panels, job status, and accessibility UI while keeping the engine isolated in one component.
- PlayCanvas Engine 2.x documents ES-module installation, container/GLB asset loading through `Asset`, render components, responsive canvas sizing, and native `gsplat` assets.
- The engine is already implemented in the prototype, which reduces the risk of a theoretical selection diverging from the actual browser path.
- A viewer adapter can hide whether a scene is represented as procedural primitives, GLB, or future Gaussian splats.

**React Three Fiber remains a credible alternative** if PlayCanvas creates a demonstrated compatibility blocker. It should be tested with the same scene bundle and frame-time budget, not adopted by assumption.

**Round 1 asset decision:** ship a GLB/glTF path first. A mesh is easier to collide with, inspect, compress, and debug than a browser-specific splat representation. Add splats behind an `AssetRenderer` interface after the walkthrough works.

Sources: [PlayCanvas Engine](https://github.com/playcanvas/engine), [PlayCanvas Engine API](https://api.playcanvas.com/engine/), [PlayCanvas Gaussian Splat docs](https://developer.playcanvas.com/user-manual/graphics/gaussian-splats/), [glTF](https://www.khronos.org/gltf/), [React Three Fiber](https://r3f.docs.pmnd.rs/).

## 3. Reconstruction choices

### COLMAP + classical pipeline

COLMAP remains the safest baseline because it is a widely used structure-from-motion and multi-view stereo system with a stable CLI/database representation. Its upstream license is the new BSD license. It is not by itself the photorealistic renderer, but it provides camera poses and sparse/dense geometry that downstream Gaussian-splatting or mesh stages can consume.

**Strengths**

- Mature failure modes and inspectable intermediate files.
- Easy to cache by scene and stage.
- Good fallback when a neural model is unavailable or legally unsuitable.
- Direct compatibility with several Gaussian-splatting pipelines through COLMAP-format cameras.

**Weaknesses**

- Sensitive to motion blur, low texture, repeated patterns, reflective surfaces, and poor coverage.
- Full dense reconstruction can be too slow for a live venue unless the capture and processing profile is constrained.
- Scale is not guaranteed without an anchor or known camera metadata.

Sources: [COLMAP repository](https://github.com/colmap/colmap), [COLMAP license](https://raw.githubusercontent.com/colmap/colmap/main/LICENSE), [COLMAP documentation](https://colmap.github.io/).

### Nerfstudio Splatfacto / gsplat

Nerfstudio provides a practical research-to-rendering framework and documents Splatfacto and GPU setup. Its code is Apache 2.0 licensed; gsplat is also Apache 2.0 licensed. Upstream installation guidance is Linux-oriented and CUDA-sensitive, with documented NVIDIA/CUDA combinations and a recommendation to use Docker when environment reproduction matters.

**Recommendation:** use Nerfstudio/gsplat after poses are available, but pin versions and wrap it in a worker command. Do not make the browser depend on Nerfstudio internals.

**Operational implication:** the team needs an NVIDIA GPU profile, a fixed CUDA/PyTorch environment, a model cache, and a preflight command before promising live processing.

Sources: [Nerfstudio installation](https://docs.nerf.studio/quickstart/installation.html), [Nerfstudio repository](https://github.com/nerfstudio-project/nerfstudio), [gsplat repository](https://github.com/nerfstudio-project/gsplat).

### VGGT

VGGT is a strong candidate for fast feed-forward camera, depth, point-map, and track prediction. The upstream README states that it can infer key 3D attributes from one to hundreds of views within seconds and can export predictions to COLMAP format. That makes it attractive as a rapid initializer, quality check, or fallback when classical SfM fails.

**Important licensing distinction:** the upstream README says the original checkpoint is non-commercial and that commercial use requires the `VGGT-1B-Commercial` checkpoint. Code and checkpoint terms must be tracked separately.

**Recommendation:** benchmark VGGT as a Round 2/3 optional initializer. Do not replace COLMAP before comparing reconstruction quality, scale stability, artifact output, GPU memory, and total wall-clock time on representative indoor captures.

Sources: [VGGT repository and README](https://github.com/facebookresearch/vggt), [VGGT paper](https://arxiv.org/abs/2503.11651), [VGGT license](https://github.com/facebookresearch/vggt/blob/main/LICENSE.txt), [commercial checkpoint](https://huggingface.co/facebook/VGGT-1B-Commercial).

### AMB3R

AMB3R is especially relevant because it exposes VO/SfM pipelines around point maps, poses, and confidence and documents integration with alternative base models. Its repository currently describes a Python 3.9 environment, PyTorch 2.5 with CUDA 11.8, PyTorch3D, FlashAttention, Open3D, and sparse-convolution dependencies.

**Strengths**

- Explicit confidence output is useful for quality gates.
- VO/SfM modes map well to a capture pipeline.
- It is designed to plug in base models that produce points, poses, and confidence.

**Risks**

- Heavy and CUDA-sensitive dependency stack.
- The repository page does not surface a clear top-level license file; the expected raw `LICENSE` path returned 404 during discovery. This is a release blocker until the authorship/license terms for code, checkpoints, and dependencies are clarified.
- The project is research-active; version drift could be expensive close to the finale.

**Recommendation:** keep AMB3R as a controlled experiment behind the reconstruction interface. It is a promising quality/confidence path, not the Round 1 dependency.

Sources: [AMB3R repository](https://github.com/HengyiWang/amb3r), [AMB3R paper](https://arxiv.org/abs/2511.20343).

### HunyuanWorld-Mirror

HunyuanWorld-Mirror is technically compelling: the upstream project reports a single model that predicts camera poses, intrinsics, depths, point maps, normals, and 3D Gaussian parameters, with optional prior conditioning and an optional gsplat optimization step.

**Why it is not the default:** the installation recommends CUDA 12.4, the stack is large, and the community license is not a simple permissive open-source license. The published license excludes the European Union, United Kingdom, and South Korea from its territory and imposes additional distribution, disclosure, acceptable-use, and usage restrictions. Those terms are incompatible with treating it as an unexamined core dependency for a competition project that may later be shared broadly.

**Recommendation:** use only after an explicit legal/commercial review and only as an optional research adapter. Do not place it on the critical Round 1 path.

Sources: [HunyuanWorld-Mirror repository](https://github.com/Tencent-Hunyuan/HunyuanWorld-Mirror), [HunyuanWorld-Mirror license](https://github.com/Tencent-Hunyuan/HunyuanWorld-Mirror/blob/main/License.txt), [technical report](https://3d-models.hunyuan.tencent.com/world/worldMirror1_0/HYWorld_Mirror_Tech_Report.pdf).

## 4. Geometry, navigation, and semantic data

### Open3D vs OpenMVS

Open3D is the preferred geometry utility layer: point-cloud inspection, downsampling, normals, plane fitting, mesh processing, and validation can remain in a focused Python module. Its upstream project is Apache 2.0 licensed.

OpenMVS is technically useful for dense multi-view stereo, but its repository license is AGPL-3.0. It should not be pulled into a networked product or server path without a deliberate license decision. If used at all, keep it as an offline, optional experiment with its obligations documented.

Sources: [Open3D documentation](https://www.open3d.org/docs/release/), [Open3D repository](https://github.com/isl-org/Open3D), [OpenMVS repository](https://github.com/cdcseacave/openMVS).

### Grid + A* vs navigation mesh

**Round 2 recommendation:** derive a 2D occupancy grid from the explicit floor/obstacle geometry and use A*. This is easy to visualize, test, and validate against clearance. It also gives the team a useful artifact for debugging reconstruction errors.

**Later option:** generate a navigation mesh using Recast/Detour if large scenes, sloped surfaces, or complex topology make grids too expensive. A navmesh should not be introduced until the team has evidence that the grid is the bottleneck.

### JSON manifest vs database

Use versioned JSON for Round 1 and the first Round 2 demo:

- `scene.json` for coordinate system, assets, scale, bounds, and quality results.
- `pois.json` for rooms, objects, labels, and world-space anchors.
- `walkable.json` for grid dimensions, cell size, blocked cells, and route metadata.

Add a database only when multiple operators, venues, users, or concurrent jobs create a real query/persistence requirement.

## 5. Hardware and runtime requirements

No target hardware has been supplied and no local benchmark was possible because the repository contains no implementation or environment. The team must measure at least:

| Profile | Required measurements |
|---|---|
| Developer GPU | GPU model, VRAM, CUDA driver/toolkit, PyTorch compatibility |
| Live processing GPU | maximum input frames, peak VRAM, wall-clock per stage, retry behavior |
| Browser laptop | first-load time, asset size, FPS while moving, FPS while idle, memory |
| Storage/network | raw capture size, processed bundle size, upload/download throughput |

Do not infer a live-finale SLA from upstream “seconds” claims. Those claims refer to model inference or demo conditions, not the full capture-to-publish pipeline.

## 6. Old-versus-new decision summary

| Decision | Existing/baseline approach | Candidate alternative | Recommendation |
|---|---|---|---|
| Scene reconstruction | COLMAP + downstream renderer | VGGT, AMB3R, HunyuanWorld-Mirror | Baseline first; benchmark candidates behind an adapter |
| Browser asset | GLB/glTF mesh | Gaussian splats/SOG | GLB for Round 1; splats as progressive visual layer experiment |
| Navigation | Floor grid + A* | Recast/Detour navmesh | Grid first because it is deterministic and inspectable |
| Geometry utilities | Open3D | OpenMVS | Open3D core; OpenMVS optional due AGPL |
| Backend | CLI/filesystem | FastAPI + durable queue | CLI first; add FastAPI when upload/status is needed |
| Semantics | JSON labels | learned detection/segmentation/OCR | Schema first; automation only after viewer/search is stable |
| Scale | visual/manual estimate | phone sensor/known anchors | Require a measured anchor and record residual error |

## 7. Experiments required before locking research choices

1. **Baseline capture test:** one well-covered room, one low-texture/reflective room, and one corridor. Compare COLMAP success, scale residual, mesh quality, and total time.
2. **Neural initializer test:** run VGGT and, if license is cleared, AMB3R on the same exact frames. Compare pose alignment, point confidence, failure rate, and time to a browser-ready asset.
3. **Visual delivery test:** GLB mesh versus browser Gaussian-splat candidate on the same laptop. Record bundle size, first meaningful frame, movement FPS, and visual artifacts.
4. **Navigation validity test:** generate a walkable map from reconstructed geometry and measure route validity, obstacle clearance, and false corridors.
5. **Live rehearsal:** process an unseen venue with the exact hardware, software image, and capture SOP intended for 16–17 December 2026.
