# Namma Space — Decision Log

## Decision status legend

- **Accepted:** use this as the working default until evidence changes it.
- **Experimental:** implement behind an adapter and benchmark before relying on it.
- **Blocked:** cannot be safely selected until missing evidence, hardware, or license information is resolved.

## Decisions

### D-001 — Build the Round 1 vertical slice before research integration

- **Status:** Accepted
- **Decision:** The first implementation is a browser walkthrough with a stable scene contract, GLB asset path, first-person controls, and collision constraints.
- **Reason:** The repository is currently empty and Round 1 is 7 days away from the discovery date. A research model without a viewer and deployment path does not satisfy the deliverable.
- **Evidence:** Repository inspection found no source, manifests, tests, or deployment configuration.
- **Revisit when:** The first clean-checkout walkthrough is reproducible.

### D-002 — Separate visual and navigation representations

- **Status:** Accepted
- **Decision:** Photorealistic assets and explicit collision/walkability geometry are separate outputs tied to one canonical coordinate frame.
- **Reason:** Visual quality and physical traversability have different requirements. A splat or dense visual asset is not a dependable collision surface.
- **Verification:** Compare transformed visual bounds, floor plane, POI anchors, and route overlays in the viewer.

### D-003 — Use PlayCanvas Engine with React around it for the web viewer

- **Status:** Accepted
- **Decision:** Use React + TypeScript + Vite for the application shell and PlayCanvas Engine 2.x for the 3D viewer.
- **Reason:** The build directive prioritizes PlayCanvas for GLB/container loading, future Gaussian Splat support, and a small engine boundary. React owns search, capture staging, metadata and accessibility UI; PlayCanvas owns the canvas lifecycle and scene entities.
- **Evidence:** The prototype now initializes a PlayCanvas application, renders the synthetic fixture, supports first-person movement, and exposes a GLB/container asset-loading path behind the scene manifest.
- **Alternative:** React Three Fiber remains a future alternative only if PlayCanvas produces a demonstrated compatibility blocker.

### D-004 — Use GLB/glTF for the first browser asset

- **Status:** Accepted
- **Decision:** Ship a GLB/glTF asset path before Gaussian-splat delivery.
- **Reason:** GLB is easy to inspect, cache, load, and use for collision/debugging. Browser splat formats and renderers introduce additional compatibility and performance uncertainty.
- **Revisit when:** A same-scene benchmark demonstrates a clear visual or loading advantage without breaking movement and route validation.

### D-005 — Keep COLMAP as the baseline reconstruction adapter

- **Status:** Accepted
- **Decision:** Use COLMAP-compatible outputs as the baseline camera/geometry interchange format.
- **Reason:** It is mature, inspectable, BSD-licensed upstream, and compatible with downstream Gaussian-splatting workflows.
- **Risk:** It can fail on poor captures and may be too slow for live use without keyframe selection and cached stages.

### D-006 — Treat VGGT as an optional initializer or fallback

- **Status:** Experimental
- **Decision:** Benchmark VGGT behind `ReconstructionAdapter`; do not make it the only path.
- **Reason:** Upstream reports fast feed-forward geometry and COLMAP export. However, checkpoint licensing is split: the original checkpoint is non-commercial while `VGGT-1B-Commercial` is the commercial-use option.
- **Required experiment:** Same frames as COLMAP, same target GPU, compare total wall-clock, scale, pose continuity, confidence, and downstream asset quality.

### D-007 — Do not make AMB3R a critical dependency yet

- **Status:** Blocked/Experimental
- **Decision:** Keep AMB3R as a candidate for confidence-aware VO/SfM, but require license clarification and environment benchmarking first.
- **Reason:** It has a promising interface and confidence output, but the dependency stack is heavy and a clear top-level license was not found at the expected repository path during discovery.
- **Required experiment:** Reproduce the documented Python 3.9/CUDA 11.8 setup on the actual GPU and record license provenance for code, weights, and third-party components.

### D-008 — Do not make HunyuanWorld-Mirror a core dependency

- **Status:** Blocked/Experimental
- **Decision:** Use only after explicit legal review and only as an optional research adapter.
- **Reason:** It offers a broad set of geometric and 3DGS outputs, but the published community license has territory exclusions and additional restrictions. Its documented CUDA 12.4 environment also increases operational complexity.

### D-009 — Use a 2D occupancy grid + A* for Round 2 navigation

- **Status:** Accepted
- **Decision:** Start with a floor-aligned occupancy grid and A* using an agent-radius clearance rule.
- **Reason:** It is deterministic, inspectable, and easy to validate against reconstructed obstacles. A navmesh is an optimization/complexity choice, not a prerequisite for the competition requirement.
- **Revisit when:** Real scenes show unacceptable grid memory, stair/sloped-surface failures, or route artifacts.

### D-010 — Use JSON manifests before a database

- **Status:** Accepted
- **Decision:** Store scene, POI, navigation, quality, and provenance data as versioned JSON in the scene bundle.
- **Reason:** The first product has no multi-user or multi-venue persistence requirement yet. JSON keeps the demo reproducible and easy to inspect.
- **Revisit when:** Multiple operators, concurrent jobs, permissions, or cross-venue search require durable querying.

### D-011 — Use CLI workers before a distributed backend

- **Status:** Accepted
- **Decision:** Make each processing stage runnable as a command with structured inputs/outputs. Add FastAPI for upload and job status only after the local path works.
- **Reason:** The repository has no backend and Round 1 time is limited. A CLI gives the team a reproducible local and offline path while preserving an API boundary for later.

### D-012 — Lazy-load PlayCanvas after the scene bundle is valid

- **Status:** Accepted
- **Decision:** Keep the React shell and scene metadata in the initial bundle; dynamically import `PlayCanvasViewer` only after the scene bundle has loaded.
- **Reason:** The measured initial bundle was approximately 2.36 MB minified / 626 KB gzip because PlayCanvas was statically imported. The lazy boundary reduced the initial chunk to approximately 332 KB minified / 101 KB gzip while retaining the full engine in a separate chunk.
- **Trade-off:** The viewer has an explicit engine-loading failure state and a separate chunk request before the canvas starts.

## Assumptions to verify

1. The team can access at least one Linux NVIDIA GPU with enough VRAM for the selected reconstruction profile.
2. The live finale permits a separate GPU processing machine or hosted GPU service.
3. The competition accepts a preprocessed or cached scene for Round 1 while the end-to-end capture pipeline is being completed.
4. The team has rights to capture and display the venue imagery and any identifiable people or signage.
5. The browser demo target is a laptop/desktop with WebGL 2 support.

## Open questions

| Question | Why it matters | Owner/action |
|---|---|---|
| What GPU model and VRAM are available? | Determines COLMAP, gsplat, VGGT, AMB3R, and Hunyuan feasibility | Record hardware before environment lock |
| Is cloud GPU allowed and what budget/quotas exist? | Determines live processing fallback | Confirm competition and team constraints |
| Are there official capture/asset/license rules? | Affects model use and venue imagery | Obtain competition brief and legal review |
| What browser/laptop is used for judging? | Determines asset format and FPS target | Measure on exact demo hardware |
| Is the Round 1 input a real-time capture or a preprocessed scene? | Determines pipeline depth required by 31 October | Confirm with organizers/team brief |
| What venue dimensions or scale anchors can the operator measure? | Required for metric navigation and AR alignment | Add anchor step to capture SOP |
| How should people, faces, and private signage be handled? | Privacy and demo risk | Define blur/redaction policy |

## Benchmark backlog

- Baseline COLMAP versus VGGT on identical indoor captures.
- AMB3R reproducibility and license review.
- GLB versus browser Gaussian splat asset size, load time, and FPS.
- Grid+A* versus navmesh on reconstructed floors and obstacles.
- Fast mode versus quality mode on an unseen venue.
- Capture-quality coaching false-positive/false-negative rate.
