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

### D-013 — Signal over a Vite dev-server relay with self-signed LAN HTTPS

- **Status:** Accepted
- **Decision:** Run signalling on the dev server itself: a Vite plugin (`scripts/ws-signalling-plugin.ts`) attaches one `ws` upgrade listener for `/ws?session=TOKEN`, backed by pure room logic in `scripts/signalling-relay.ts` (rooms of exactly 2, verbatim `sdp`/`ice` relay, `peer-joined` in insertion order, room closed with 4001 when either peer leaves, and an honest `{"type":"error","code":"ROOM_FULL"}` frame plus close 4003 for a third peer). LAN HTTPS uses `@vitejs/plugin-basic-ssl` (self-signed) behind the explicit `npm run dev:lan` script only; plain `npm run dev` stays loopback HTTP. The insecure-context case renders a derived BLOCKED screen with the `dev:lan` remedy (UI presentation only, never a canonical pairing state), and `ws` types come from a local ambient shim (`scripts/ws.d.ts`) instead of `@types/ws`.
- **Reason:** One dev server gives T18's client a same-origin relay with no separate process to run, and Vite's HMR/proxy upgrade listeners provably ignore non-`vite-hmr` paths, so coexistence needs no ordering tricks. `vite-plugin-mkcert` was replaced because its `mkcert -install` step calls `security add-trusted-cert`, which fails without a sudo-capable terminal, and the plugin has no skip-install option; `@vitejs/plugin-basic-ssl` needs no trust install, so phones only accept a one-time certificate warning. Membership is derived from the `join` frame rather than the URL query so a session token is never authoritative state, and the `ROOM_FULL` error frame sits deliberately outside the frozen T18 `SignalMessageSchema` — the client already ignores it (`parseSignalMessage` → `null`) and observes the close instead, so no protocol change was needed.
- **Trade-off:** Self-signed certs show a one-time warning on every phone, and the relay lives only in dev (production needs its own endpoint); `ws` upgrades keep the dev socket list alive, so plugin teardown terminates clients before `wss.close()` to avoid hanging `server.close()`. Security posture: the session token travels in the `/ws?session=TOKEN` URL query and the relay performs no `Origin` validation, so it is trusted-local-network only and must never be exposed in production.
- **Verification:** `npm run test` 370/370 (17 relay tests incl. real-server rooms, 7 blocked-state tests), `npm run typecheck` exit 0, `npm run lint` 0 errors (5 pre-existing warnings), and live smokes: `dev:lan` over `wss` and plain `dev` over `ws` both served the app and answered `peer-joined`/verbatim `sdp`/`ROOM_FULL` + close 4003.

### D-014 — Palette MERIDIAN is final

- **Status:** Accepted
- **Decision:** Ship Direction A — **MERIDIAN** (light mineral cartography), presented as the GROUNDTRUTH identity system, as the one palette for the product.
- **Reason:** The evaluation in `docs/design/DESIGN_HANDOFF.md` §3.1–3.2 is computed, not taste: the 92 %-opacity HUD chip bounds ink contrast to ≥ 12.3:1 against *any* scene luminance (closed form, no per-scene scrims), every shipped text pair is AA-or-better with most at AAA, photographic content wants a neutral-warm paper ground, and the direction is neither the rejected graphite/amber anti-reference nor a SaaS/neon template.
- **Evidence:** `docs/design/DESIGN_HANDOFF.md` ("Picked direction A", "Ship Direction A — MERIDIAN"); `src/styles/tokens.css` header — "GROUNDTRUTH · palette MERIDIAN — single source of truth"; contrast pairs asserted by `tests/tokens.test.ts`.

### D-015 — Default scene is the procedural fixture

- **Status:** Accepted (as built; **differs from the V1 spec's suggested default**)
- **Decision:** `DEFAULT_SCENE_URL = import.meta.env.VITE_SCENE_URL || '/scenes/fixture/manifest.json'`. The scene `<select>` lists **Procedural fixture** first and **Generated GLB fixture** second; `?scene=glb` selects the GLB bundle and any `/scenes/…` path is honoured (durable URL contract).
- **Reason:** the procedural fixture needs no binary asset, so a fresh checkout's first frame can never fail on a missing file; `VITE_SCENE_URL` lets a deployment point elsewhere without code changes.
- **Divergence note:** V1 spec open question 2 defaulted to `glb-fixture` as primary. The shipped default is the procedural fixture (verified in `SpatialViewerWorkspace.tsx` `resolveInitialSceneUrl`, 29 Oct). Both scenes are covered by e2e (`/` and `/?scene=glb`).
- **Revisit when:** a real reconstruction exists and becomes the honest first frame.

### D-016 — Frame caps: 2048 px ingest, 1600 px phone frames, JPEG q0.9

- **Status:** Accepted (resolves V1 spec open question 4)
- **Decision:** Staged-image ingest downscales to a **≤ 2048 px long edge** and re-encodes JPEG **q0.9** (OffscreenCanvas with canvas fallback); Live Scan phone frames are capped at a **1600 px long edge** (`MAX_FRAME_LONG_EDGE`) before the JPEG grab and datachannel send, chunked at 64 KiB with a per-frame sha256 ack.
- **Reason:** an 8 GB demo machine must decode many photos at once, and the capture path assumed a ~256 KB frame budget for simple datachannel transfer.
- **Evidence:** `src/lib/capture/decode.ts`, `src/lib/scan/capture.ts`; `tests/capture-ingest.test.ts` (exact `computeTargetSize` math) and `tests/scan-capture.test.ts` (asserts `MAX_FRAME_LONG_EDGE === 1600`).

### D-017 — SIMPLE_RADIAL camera model for real captures

- **Status:** Accepted
- **Decision:** Real captures are calibrated with COLMAP's **SIMPLE_RADIAL** single-camera model; the team's root pipeline passes it explicitly (`pipeline/run_pipeline.py`). The studio adapter (`scripts/reconstruct_colmap.py`) sets no `--ImageReader.camera_model` and therefore uses COLMAP's SIMPLE_RADIAL default (verified against `colmap feature_extractor -h` on 29 Oct).
- **Reason:** forcing OPENCV (two focal lengths + four distortion coefficients) fails initial-pair selection and bundle adjustment on real photos. On identical inputs: OPENCV → 2/70 then 20/70 registered; SIMPLE_RADIAL → 50–59/70 (isolation run, 29 Oct; the `use_gpu` flag was exonerated). The OPENCV path reproduced the exact "2 frames / 3 %" signature behind the earlier 2/73 "unusable capture" verdict, so that verdict was at least partly a pipeline bug.
- **Evidence:** commit `a4299f5` (regression test pins the `feature_extractor` argv; `image_undistorter` empirically verified model-agnostic, SIMPLE_RADIAL → PINHOLE, exit 0); `logs/round1-rescue/EVENT_LOG.md` (03:12 and 03:43 IST, 29 Oct).

### D-018 — Identity-only transform, null-only collision asset

- **Status:** Accepted
- **Decision:** A schemaVersion 1 manifest must carry `worldFromReconstruction` = **identity** and `collisionAsset` = **null**; both the zod schema and `scripts/validate_scene.py` reject anything else with the same actionable message. Viewer movement refuses unknown/blocked cells and refuses to move at all when no navigation grid exists (tested `resolveWalkableStep`).
- **Reason:** the navigation grid is an x–z raster — a rotation or scale cannot be represented without re-baking the grid, so a non-identity matrix the engine never applies would be a silent lie; the viewer has never loaded a collision mesh, so obstacles belong in `navigation.blocked`/`unknown`; and the raw WASD path previously bypassed the grid check entirely.
- **Evidence:** commit `d4acf04` (68 new tests, red → green; full suite 526/526 at that commit); shipped bundles already identity/null, so the tightening broke nothing; suites `scene-loader`, `scene-validator`, `scene-integrity`, `movement-contract`, `navigation-unknown`.

### D-019 — One URI/integrity contract for browser and Python validator

- **Status:** Accepted
- **Decision:** Every declared scene URI is a **bundle-relative POSIX path** (no scheme except `procedural://` on procedural assets; no leading slash, backslash, `..`, query or fragment); manifests are **same-origin** (resolution keeps targets inside the declaring manifest's directory on the app origin); 32 MiB document cap / 256 MiB browser hash-buffer cap; `sha256` must be 64 lowercase hex and is **verified via WebCrypto before the renderer loads** the asset. Error surfaces are distinct: network / not-found / http / too-large / invalid-json / invalid-manifest / invalid-uri / cross-origin / hash-mismatch.
- **Reason:** before this the browser never checked a digest and the two validators (zod in TS, `validate_scene.py` in Python) could disagree — a bundle could pass one gate and fail the other. One written contract, enforced on both sides, keeps "validated" honest.
- **Evidence:** commit `d4acf04`; `src/lib/sceneLoader.ts` (`resolveSceneUri`, integrity checks), `src/types/scene.ts`, `scripts/validate_scene.py` (same messages); suites `scene-integrity`, `scene-loader`, `scene-validator`.

> Note: the **mkcert vs `@vitejs/plugin-basic-ssl`** decision and the **`ws@^8` dev-relay dependency** are recorded in **D-013** above (including the mkcert smoke outcome and fallback); they are not repeated here.

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
