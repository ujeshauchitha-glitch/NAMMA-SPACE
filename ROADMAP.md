# Namma Space — Competition Roadmap

**Planning date:** 24 October 2026  
**Deadlines supplied by the team:** 31 October 2026, 30 November 2026, and 16–17 December 2026.

## 1. Priority rule

The order is determined by dependency and demo risk:

```text
viewer shell → scene contract → sample scene walkthrough
→ capture/reconstruction baseline → quality gates
→ POIs/search → walkable map/routes
→ rapid processing/recovery → research upgrades → optional AR
```

Anything that does not improve this chain should be deferred.

## 2. Round 1 — desktop walkthrough by 31 October 2026

### Mandatory outcome

A judge can open the application and walk through a reconstructed indoor scene in first person using WASD and mouse controls.

### Minimum vertical slice

1. Bootstrap React + TypeScript + Vite.
2. Implement `scene.json` and a sample scene directory.
3. Load a GLB/glTF visual asset.
4. Implement first-person camera, WASD movement, mouse look, pointer-lock entry/exit, and a reset position.
5. Add collision constraints using a simple collision mesh or walkable grid.
6. Add loading, unsupported-browser, missing-asset, and error states.
7. Document the phone capture SOP and input folder format.
8. Add a baseline processing command that can turn a small capture into the scene bundle, even if the first demo uses a known-good preprocessed scene.
9. Record scene provenance, pipeline version, and asset hashes.
10. Deploy the static viewer and rehearse from a clean checkout.

### Dependency order

| Order | Work package | Deliverable | Risk |
|---:|---|---|---|
| 1 | Repository bootstrap | Web app, package manager lockfile, scripts, README | The workspace is currently empty |
| 2 | Viewer shell | Browser scene with camera and controls | Must be usable before reconstruction work |
| 3 | Scene contract | Manifest validation and sample bundle | Prevents model-specific coupling |
| 4 | Asset path | GLB load and collision geometry | Avoid splat delivery risk initially |
| 5 | Capture baseline | SOP, frame extraction, one reproducible pipeline | GPU/toolchain availability unknown |
| 6 | Quality/fallback | Validation report and last-known-good scene | Essential for live confidence |
| 7 | Clean rehearsal | Build/deploy/run instructions verified | Catches missing local assumptions |

### Round 1 must not include

- Native mobile capture application.
- Automated object recognition as a hard dependency.
- AR localization.
- HunyuanWorld-Mirror or AMB3R as the only reconstruction path.
- A database or distributed job system without a demonstrated need.
- A browser Gaussian-splat renderer before the GLB walkthrough is stable.

## 3. Round 2 — POI search and navigation by 30 November 2026

### Required outcome

The visitor can find a room/object, focus the scene on it, request a route, and follow a route that respects obstacles and clearance.

### Work packages

1. Version `pois.json` and add room hierarchy, aliases, labels, anchors, and confidence.
2. Implement local search with deterministic ranking.
3. Add POI focus and “return to route” behavior.
4. Derive a floor plane and 2D walkable occupancy grid from explicit geometry.
5. Implement A* with configurable agent radius and destination snapping.
6. Validate each route against blocked cells and clearance.
7. Add route visualization in the viewer and an explanation for unreachable targets.
8. Build a small unseen-scene evaluation set with a fixed capture SOP.
9. Compare grid navigation with a navmesh only if the grid fails on real geometry.

### Round 2 exit criteria

- Search and route logic run from scene data, not hardcoded demo state.
- At least three scenes use the same schemas and viewer code.
- Routes are tested against known obstacles and invalid destinations.
- POI anchors remain spatially aligned after scene transforms.
- A failed semantic or navigation stage leaves the walkthrough usable.

## 4. Round 3 — live finale readiness for 16–17 December 2026

### Critical outcome

The team can capture a previously unseen venue, process it in a rapid mode, validate it, and publish it without losing the last successful scene.

### Work packages

1. Freeze the capture SOP and create a one-page operator checklist.
2. Implement content-addressed caching for frames, reconstruction, geometry, semantics, and bundles.
3. Split processing into independently runnable workers.
4. Add job status, logs, retry, timeout, and artifact cleanup policies.
5. Add rapid versus quality processing profiles.
6. Benchmark COLMAP baseline, VGGT initializer, and AMB3R if license and hardware allow.
7. Benchmark GLB delivery versus browser splat delivery on the actual demo laptop.
8. Add automated geometry quality gates and a publish/rollback switch.
9. Pre-stage model weights, CUDA environment, sample data, and an offline fallback.
10. Run full rehearsals on unseen venues and intentionally degraded captures.

### Finale runbook requirements

- No model weights are downloaded during the live demo.
- The operator can see which stage is running and why a job failed.
- A failed new scene does not replace the last-known-good URL.
- The viewer can open a local/static bundle if network access is unreliable.
- Every published bundle has a manifest and provenance record.

## 5. Optional AR track

AR is a bonus and should start only after the desktop route is stable. The correct architecture is to reuse the canonical scene frame and add a localization module:

```text
phone camera → visual/inertial localization → worldFromCamera
→ canonical scene frame → POI/route overlay
```

Open questions include scale drift, relocalization, lighting, device permissions, and indoor feature scarcity. AR must not become a second source of truth for scene geometry.

## 6. Relative effort and dependency map

| Workstream | Relative effort | Depends on | Priority |
|---|---:|---|---:|
| Viewer and controls | Medium | Web scaffold | Immediate |
| Scene manifest and loader | Low–medium | Viewer scaffold | Immediate |
| Baseline reconstruction | High | GPU/toolchain, capture SOP | Immediate but isolated |
| Collision geometry | Medium | Scene geometry | Round 1 |
| POI/search | Low–medium | Scene manifest | Round 2 |
| Walkable map/A* | Medium | Collision geometry and scale | Round 2 |
| Job cache/recovery | Medium–high | Stable processing stages | Round 3 |
| Neural model benchmark | High | Fixed dataset and hardware | Round 2/3 |
| Browser splat delivery | Medium–high | Stable visual adapter | Round 2/3 |
| AR localization | High | Stable canonical coordinates | Post-Round 2 |

## 7. Verification plan

### Every pull request or milestone

- Typecheck and build the viewer.
- Run unit tests for manifest validation, movement constraints, search ranking, and A*.
- Open the built viewer and complete a scripted walkthrough.
- Check that a missing or corrupt asset produces a usable error state.

### Reconstruction benchmark harness

For every candidate pipeline, record:

- Input frame count and resolution.
- Registered-frame ratio.
- Peak GPU VRAM and system RAM.
- Stage wall-clock time.
- Output bundle size.
- Scale-anchor residual.
- Floor/obstacle extraction quality.
- Browser first-frame latency and movement FPS.
- Manual quality notes and failure category.

Published upstream numbers and our measurements must remain separate in reports.
