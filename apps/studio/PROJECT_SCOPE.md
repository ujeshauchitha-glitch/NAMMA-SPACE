# Namma Space — Project Scope

**Discovery date:** 24 October 2026  
**Competition milestones supplied by the team:** Round 1 — 31 October 2026; Round 2 — 30 November 2026; live finale — 16–17 December 2026.

## 1. Executive summary

Namma Space is intended to turn ordinary smartphone imagery of an indoor venue into a browser-delivered, photorealistic and interactive 3D digital twin. The competition thesis is not merely “show a 3D model”; it is a reliable capture-to-walkthrough pipeline that can be repeated for unseen venues under time pressure.

The immediate engineering target is a narrow, demonstrable vertical slice:

> Capture or import a short indoor image sequence, produce a validated scene bundle, load it in a browser, and let a user walk through it in first person with WASD and mouse controls.

Round 1 should not depend on neural reconstruction research models, AR, a multi-tenant backend, or production-grade semantic search. Those are later increments behind stable interfaces.

## 2. Competition requirements translated into engineering requirements

| Requirement | Competition importance | Engineering interpretation | First milestone |
|---|---:|---|---|
| Smartphone capture | Core | A repeatable capture SOP, frame quality checks, and a reproducible input folder/video format | Round 1 |
| Automated reconstruction | Core | A runnable processing command that converts captured media into a scene bundle; cacheable and resumable | Round 1 baseline, improve through Round 3 |
| Browser walkthrough | Mandatory in Round 1 | Web viewer with scene loading, first-person camera, WASD, mouse look, collision-aware movement, and a visible loading/error state | Round 1 |
| POI search | Mandatory in Round 2 | Structured POI manifest plus room/object search and camera focus | Round 2 |
| Obstacle-aware navigation | Mandatory in Round 2 | Walkable representation, route planner, route validation, and visual route overlay | Round 2 |
| Rapid unseen-venue deployment | Critical in Round 3 | Fast path, cache, job status, artifact packaging, rollback to last known-good scene | Round 3 |
| Mobile AR | Bonus | Separate localization and coordinate-registration track; never block desktop delivery | Post-Round 2 experimental |

## 3. Current repository state

The inspected workspace is not currently an application repository. It contains only the Freebuff project marker:

```text
nammaspace/
└── .freebuff/
    ├── .gitignore
    └── project-id
```

Findings:

- No `package.json`, lockfile, Python project file, source directory, Vite configuration, TypeScript configuration, tests, CI configuration, Dockerfile, deployment configuration, or README was present.
- The directory is not a Git repository; `git status` and `git log` fail with “not a git repository”.
- There is no implementation to preserve, no existing build command to run, and no existing documentation convention beyond the project marker.
- `.freebuff/` is app metadata and should not be edited or committed as application content.

This is a hard blocker for Round 1: the team must first create the application skeleton and a tested vertical slice. The proposed stack is therefore a recommendation, not an assessment of an existing implementation.

## 4. Users and primary flows

### Capture operator

1. Start a capture session.
2. Follow on-screen or printed guidance: slow movement, adequate overlap, no abrupt exposure changes, full room coverage, and known-scale anchor where possible.
3. Upload or copy the video/image sequence.
4. Receive quality feedback before expensive reconstruction.
5. Submit the capture for processing and monitor a recoverable job.

### Visitor or evaluator

1. Open a deployed scene URL.
2. Wait for a progressive loading state.
3. Walk using WASD and mouse look.
4. Avoid walls and obstacles.
5. Search a room or POI and jump/focus to it.
6. Request a route and follow the displayed path.

### Team operator during the finale

1. Ingest a new venue capture.
2. Select a rapid or quality reconstruction mode.
3. Inspect confidence and geometry gates.
4. Publish only a validated bundle.
5. Keep the previous working deployment available if the new job fails.

## 5. Scope boundaries

### In scope

- Smartphone video/image ingestion.
- Keyframe selection and capture-quality checks.
- A deterministic baseline reconstruction path.
- A separate visual asset and navigation asset.
- Browser first-person walkthrough.
- Structured POI and room metadata.
- Search, route planning, validation, and route visualization.
- Caching, job manifests, logs, and artifact versioning.
- A rapid processing mode and a high-quality mode after the baseline works.

### Explicitly deferred

- A native capture app.
- Full semantic understanding of every object.
- Real-time reconstruction on the phone.
- Multi-user editing or collaborative annotation.
- Cloud-scale multi-tenancy.
- Mobile AR as a Round 1 or Round 2 dependency.
- Replacing the baseline with VGGT, AMB3R, or HunyuanWorld-Mirror before a controlled benchmark and license review.

## 6. Acceptance criteria

### Round 1 minimum viable implementation

- A clean checkout can run the web viewer using documented commands.
- A sample indoor scene bundle can be loaded in a desktop browser.
- The user can move with WASD and look with the mouse.
- The camera cannot pass through walls or marked obstacles in the chosen sample scene.
- The viewer shows loading, missing-asset, and processing-failure states.
- A documented capture SOP exists and at least one capture can be processed through the baseline pipeline.
- The deployed scene is reproducible from versioned inputs and a scene manifest.
- The team can demonstrate a last-known-good fallback if reconstruction fails.

### Round 2 additions

- POIs and rooms are represented in a versioned manifest.
- Search returns a POI/room and focuses the camera without breaking the walkable scene.
- A route planner produces a route that stays inside the walkable map and respects clearance.
- Invalid routes and unreachable destinations are explained to the user.
- At least three previously unseen indoor test scenes are evaluated with the same pipeline.

### Round 3 additions

- A new venue can be processed through a rapid mode with visible job progress.
- Quality gates prevent obviously broken scenes from being published.
- Failed jobs are retryable and do not destroy the current deployment.
- The team can switch between fast and high-quality reconstruction modes.
- Asset size, first-load latency, and browser frame rate are measured on the target demo hardware.

## 7. Constraints and risks

- The first deadline is 7 days after discovery, so reliability and demonstrability outrank research novelty.
- Reconstruction models are GPU- and CUDA-sensitive. The team has not yet supplied target GPUs, VRAM, RAM, operating systems, or cloud budget; these must be recorded before locking a production pipeline.
- A photorealistic representation is not automatically suitable for collision detection or navigation. The viewer must consume a separate explicit geometry/map representation.
- Several attractive research models have checkpoint or territory restrictions. Licensing is a release gate, not an afterthought.
- The empty repository means capture, viewer, processing, deployment, and evaluation all need initial scaffolding. The first implementation must intentionally avoid broad infrastructure.

## 8. Five highest-impact improvements

1. **Capture-quality coaching:** reject or warn on blur, insufficient overlap, exposure swings, low coverage, and missing scale anchors before GPU processing. Benefit: fewer unrecoverable live failures. Risk: imperfect heuristics can reject usable footage. Effort: medium. Verification: compare failed-reconstruction rate with and without the gate.
2. **Confidence-aware publication gates:** carry confidence and registration statistics through the pipeline and publish only scenes that pass floor, scale, bounds, and asset-load checks. Benefit: prevents impressive-looking but unusable scenes. Risk: thresholds need calibration. Effort: medium. Verification: seeded bad captures and false-publish rate.
3. **Hybrid visual/classical pipeline:** use fast feed-forward geometry as an initializer or fallback while retaining an inspectable COLMAP/explicit-geometry path. Benefit: lower live latency without sacrificing recovery. Risk: coordinate and scale reconciliation. Effort: high. Verification: identical-scene wall-clock and downstream navigation comparison.
4. **Shared-space POI and route validation:** generate POIs, collision geometry, and walkable maps from one canonical transform, then test route overlays against the visual scene. Benefit: turns the demo from a viewer into a trustworthy digital twin. Risk: reconstruction artifacts and scale drift. Effort: medium–high. Verification: anchor residuals, obstacle-clearance tests, and unseen-scene routes.
5. **Progressive, recoverable deployment:** content-addressed artifacts, staged publishing, progressive asset loading, and last-known-good rollback. Benefit: makes the Round 3 live demo resilient to GPU, network, and model failures. Risk: added operational plumbing. Effort: medium–high. Verification: kill/retry tests, cold-load measurements, and rollback rehearsal.

## 9. Success definition

The project succeeds if a judge can quickly observe this chain without manual rescue:

```text
phone capture → quality gate → reconstruction job → validated scene bundle
→ browser walkthrough → POI/route interaction → reproducible fallback
```

The differentiator should be the operational loop and spatial correctness, not the number of models listed in the README.
