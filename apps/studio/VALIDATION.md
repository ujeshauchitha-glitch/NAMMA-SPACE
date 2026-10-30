# Validation record

**Record date:** 29 October 2026 (runs 03:52–04:21 IST, branch `ashwinwork`, working tree — concurrent workstreams active, see churn note under *Automated results*).
This record supersedes the 24 October 2026 record; older measurements are kept only where explicitly dated. Every command below was executed for this record unless a source (commit/message/log) is named.

## Environment (verified 29 Oct 2026)

| Item | Value |
|---|---|
| Node / npm | v26.3.1 / 12.0.1 |
| `python3` on PATH | Homebrew **3.15.2** (that symlink was updated 29 Oct 02:45 IST) |
| `python3.14` / `python3.13` | **3.14.6** / **3.13.7** — both also pass `validate:scenes` |
| macOS system Python (`/usr/bin/python3`) | predates 3.13; **not used** by any command below |
| ffmpeg | `/opt/homebrew/bin/ffmpeg` |
| COLMAP | 4.2.1, Homebrew **CPU-only** build (no GPU support) — installed 29 Oct; earlier records listing COLMAP as absent are stale |
| nvidia-smi | missing (Apple Silicon Mac; pipeline runs `--cpu`) |
| mkcert | **not on PATH** (`which mkcert` → not found); see *mkcert smoke result* |
| Playwright Chromium | installed (the e2e run below used it) |
| Real capture media | present under `work/captures/` (gitignored); nothing committed to the repo |

## Automated results — 29 Oct 2026 (T26 re-run)

```text
npm run typecheck                 PASS (exit 0)                                    03:53 IST (T26)
                                   PASS on committed state                          04:18 IST (lead re-run, 1f3ddfa)
                                   FAIL 04:21 IST — TS2322 in the untracked, in-flight
                                     src/lib/scan/receive.ts (concurrent D4/T21 workstream;
                                     not in any commit) → see working-tree churn note
npm run lint                      PASS (exit 0) — 0 errors, 5 pre-existing warnings 04:21 IST
                                   (history: exit 1 with 1 unused-import error at
                                     03:53–04:09 IST → EX-1, fixed by T25 in 1f3ddfa)
npm test (vitest run)             PASS — Tests 542 passed (542), 29 files          04:09 and 04:21 IST
  … tracked files only (27 files)  PASS — Tests 492 passed (492)                    04:05 IST
  … at commit d4acf04             526/526 (lead re-run recorded in that commit message, 03:45 IST)
npm run test:e2e                  PASS — "28 passed (1.6m)", 5 spec files           03:55 IST
  … re-run                        PASS — "28 passed (1.2m)"                         04:23 IST
npm run validate:scenes           PASS — "Validated 2 scene bundles" (python3 = 3.15.2)
  … same command under python3.14  PASS — "Validated 2 scene bundles" (3.14.6), exit 0
  … same command under python3.13  PASS — "Validated 2 scene bundles" (3.13.7), exit 0
npm run build                     PASS (exit 0) — chunk table below                 03:58 IST
npm run preflight:reconstruction  PASS — colmap: available (4.2.1, no GPU support);
                                   ffmpeg: available; nvidia-smi: missing (optional)
python3 scripts/check_chunks.py   PASS — entry 129,838 B gzip ≤ 368,640 B budget;
                                   fflate/idb/playcanvas/qrcode-generator each in their
                                   own lazy chunk; three + gsap honest "not imported" exceptions
.venv/bin/python -m pytest tests/ PASS — 62 passed in 23.31s (31 pipeline + 31 T25
                                   chunk/heuristic tests)                          04:20 IST
npm run dev:lan smoke             PASS — HTTPS 200 via `curl -k`; a `ws` client completed
                                   `join` over `wss://…/ws?session=…` and closed cleanly  04:01 IST
npm run quality                   NOT RUN by T26 → EX-5 (lead recorded all-steps green 04:18)
npm run benchmark:build           NOT RUN by T26 → EX-5 (T25 regenerated the report 04:16)
```

Working-tree churn note: this record was written **while two other workstreams were actively editing the tree**, so some numbers are timestamped snapshots. (1) Between 03:53 and 04:09 IST the pairing workstream's untracked test files first failed (6 tests) then went green; a temporary `tests/debug-journey.test.ts` scaffold appeared and was deleted. (2) At 04:21 IST the same workstream's untracked `src/lib/scan/receive.ts` broke `npm run typecheck` (TS2322, `Uint8Array` → `BlobPart`) while every suite stayed green — typecheck passed on every committed state this record tested (03:53 by T26, 04:18 by lead). The owning workstream must make typecheck green again before the T27 gate; T26 does not edit `src/`. At `d4acf04` the lead recorded 526/526; the last lead re-run on committed state (04:18, `1f3ddfa`) recorded 542/542, typecheck 0, and `npm run quality` all steps pass.

## Test inventory (29 Oct 2026)

**Unit — vitest, 27 tracked suites (492 tests), all green 04:05 IST:**
`bundle-integrity`, `capture-ingest`, `coverage`, `engine-tween`, `hud`, `icons`, `movement-contract`, `navigation`, `navigation-unknown`, `pairing-blocked`, `pairing-protocol`, `pipeline`, `poi-search`, `prepare-capture-zip`, `qr`, `rooms-viewgroups`, `route-status`, `scene`, `scene-integrity`, `scene-loader`, `scene-validator`, `signalling-relay`, `state-machine`, `storage`, `tokens`, `ui-primitives`, `use-pointer-lock`.

**Unit — untracked in-flight suites (green 04:09 IST, awaiting lead commit):** `pairing-journey`, `scan-capture` — these bring the working tree to 542 tests.

**E2E — Playwright, 5 specs / 28 tests, 28/28 green 03:55 IST:**

| Spec | Tests | Covers |
|---|---|---|
| `app.spec.ts` | 8 | journey (search/select/route/jump/stage), `?scene=glb`, narrow viewport, + 5 shell (T8) tests: tablist a11y, keyboard, digit shortcuts, single-mount, canvas destruction, honest ● LOCAL/◇ OFFLINE |
| `capture.spec.ts` | 2 | create room + stage image + assign group; delete-room confirm |
| `viewer-hud.spec.ts` | 8 | T17 HUD chrome/hint/live-region/reduced-motion/chips/tabular coords/focus ring/`SIMULATED` pill |
| `viewer-route.spec.ts` | 3 | T16 plot/replot/clear, unavailable route, Esc deselect |
| `viewer.spec.ts` | 7 | T14 skeleton, `?scene=` persistence, pose restore, single WebGL context, scene switch/reset, malformed manifest/GLB recovery, unavailable route |

**Python:** scene validator (`validate_all_scenes.py`, 2 bundles), repo pytest suites — pipeline tests (31) plus T25's chunk/heuristic tests (31), **62 total, green 04:20 IST** (pytest was not installed in `.venv`, so T26 ran `pip install pytest` first), reconstruction preflight, and `check_chunks.py`. The ZIP→`prepare_capture.py` seam is covered by vitest `prepare-capture-zip.test.ts` (it drives the real exporter and the real script).

## Build budgets — fresh build 29 Oct 03:58 IST, checked 04:20 IST

| Scope | Budget (T25) | Measured | Verdict |
|---|---|---|---|
| Initial entry JS, gzip | ≤ 368,640 B (360 KiB) | `index-DUDbeV0G.js` 447,899 B raw / **139,645 B gzip** (re-measured after T22; superseded the 129,838 B figure above) | PASS — 229 KB headroom (`entryBudgetMet: true` in `benchmark/build-report.json`) |
| PlayCanvas engine | separate lazy chunk | `PlayCanvasViewer-CU2Phr92.js` 2,032,704 B / 521,335 B gzip | PASS (Vite warns the chunk is large) |
| `fflate` | separate lazy chunk | `browser-Cgug2DPz.js` (8.92 kB / 4.45 kB gzip) | PASS |
| `qrcode-generator` | separate lazy chunk | `qrcode-5IewWFXk.js` 21.14 kB / 7.64 kB gzip | PASS |
| `idb` | separate lazy chunk | `index-V7xXUF1b.js` (3.52 kB / 1.42 kB gzip) | PASS |
| `three` | separate lazy chunk | `three.module-Dljb2UHm.js` 746,766 B raw / 190,331 B gzip — attributed by `REVISION` **and** `SRGBColorSpace` (both: 1 in the three chunk, 0 in the entry, 0 in every other chunk; the old `threejs.org` marker does not survive minification — verified count 0 everywhere — and was removed) | **PASS — proven lazy since T22** |
| `gsap` | separate lazy chunk | **not imported anywhere in the bundle** — declared dependency only | honest exception: laziness vacuous until T23's motion layer lands; `check_chunks.py` auto-enforces once imported |
| CSS | — | `index-…css` 41.33 kB / 8.72 kB gzip | info |

Chunk attribution above is the output of `python3 scripts/check_chunks.py`, run by T26 for this record (exit 0). `benchmark/build-report.json` was regenerated by T25 on 29 Oct 04:16 IST (schema v2 with the `expectations` block and the 360 KiB entry budget); T26 did not regenerate it — see EX-5.

## mkcert smoke result (T19)

- The `vite-plugin-mkcert` path was abandoned for a documented reason: its `mkcert -install` step calls `security add-trusted-cert`, which fails without a sudo-capable terminal, and the plugin has no skip-install option (`DECISION_LOG.md` D-013, `vite.config.ts` header comment). On 29 Oct `mkcert` is additionally **not installed** (`which mkcert` → not found).
- Fallback `@vitejs/plugin-basic-ssl` **verified live on 29 Oct**: `npm run dev:lan` printed `https://localhost:5174/` and `https://10.68.49.201:5174/`; `curl -k` returned **200**; the certificate is self-signed (`issuer=CN=example.org, O=Test`, valid 28 Oct → 27 Nov 2026); a `ws` client opened `wss://127.0.0.1:5174/ws?session=…`, its `join` frame was accepted, and it closed cleanly (101 upgrade + relay attached).
- Port caveat observed in this smoke: 5173 was already held by an unrelated project's vite, so Vite fell back to **5174** — always read the URL the dev server prints (the runbook `docs/PAIRING.md` says so too).

## Documented exceptions

- **EX-1 — lint error during this record (RESOLVED).** `npm run lint` failed with 1 error (`tests/prepare-capture-zip.test.ts:15` unused `mkdirSync` import, committed at `6a7654a`) in three runs at 03:53 / 03:59 / 04:09 IST, which would have failed `npm run quality`. The T25 workstream removed the import in `1f3ddfa` (04:18 IST); T26 re-ran lint at 04:21 IST: **exit 0, 0 errors, 6 pre-existing `react-refresh/only-export-components` warnings** (warnings only — they do not gate; the count was corrected from 5 to the verified 6 during T27).
- **EX-2 — reconstruction preflight has no GPU evidence.** `nvidia-smi` is missing on this Apple Silicon machine, so COLMAP GPU/dense stages cannot be exercised here; the pipeline's honest `--cpu` mode is used. Preflight still passes (GPU diagnostics are optional).
- **EX-3 — headless-Chromium limits.** Pointer lock and WASD-driven coordinate updates are not claimed from headless e2e; they remain manual headed-browser checks (checklist below).
- **EX-4 — real-capture reconstruction is blocked, not green.** No real reconstruction has succeeded; the 70-photo set registers 57% and splits into two rooms (blocker `logs/round1-rescue/BLOCKERS.md` BLK-001). Both shipped scenes are synthetic — e2e `viewer-hud` asserts the `SIMULATED` pill is present and never dismissible.
- **EX-5 — `npm run quality` and `npm run benchmark:build` were not run by T26.** Both invoke `benchmark:build`, which rewrites `benchmark/build-report.json` — outside T26 file ownership (`benchmark/**`). The report was regenerated by T25 at 04:16 IST, and the lead recorded `npm run quality` all-steps green at 04:18 IST (commit `1f3ddfa` message). T26 ran `check_chunks.py` directly (read-only) instead. The full chain remains T27's gate.
- **EX-6 — typecheck red on the in-flight working tree at 04:21 IST** (TS2322 in untracked `src/lib/scan/receive.ts`, concurrent D4/T21 workstream). Not present in any commit; typecheck passed at 03:53 (T26) and 04:18 (lead). Tracked here so the T27 gate cannot be surprised; the owning workstream must fix it. See the churn note above.
- **EX-7 — returning-phone pairing clobber (T24's written exception 2) — RESOLVED 29 Oct 2026.** *(`EX-2` is a different exception — GPU preflight, above.)* T9 persisted `pairing: IDLE` in every snapshot and `state/hydrate` used to replace the store wholesale, so on a shared-context loopback the desktop's snapshot hydrated on the phone page *after* its session dispatched PAIRING: the sync-bridge shadow desynced, every later pairing transition was silently rejected, and the phone rail stuck at IDLE with capture locked forever (real-user impact: a returning phone with a stale snapshot). **Fix:** `mergePairingOnHydrate` in `src/state/reducer.ts` — no-clobber (an in-flight PAIRING/LIVE/CAPTURING/STAGED session beats a restored IDLE) + no-zombie (a dead IDLE/OFFLINE/ERROR session still hydrates honestly), wired into the reducer's `state/hydrate` case — commit `9d7f33f`. **Test evidence:** (1) unit — `tests/pairing-hydrate.test.ts`, 15/15 green (no-clobber, no-zombie, updatedAt-ordering, and reducer-call-site suites); (2) e2e — `tests/e2e/webrtc-loopback.spec.ts` now runs the whole loopback as a **returning phone** (`openPair(…, { phoneProfile: 'returning' })`: the stale `kv/workspace-snapshot.v1` is kept, `clearWorkspaceSnapshot` is never called on this path, and a precondition poll *proves* the snapshot is present), then **reloads the phone page with that snapshot still present** and asserts the rail reaches LIVE, is NOT stuck at IDLE, a real new `RTCPeerConnection` reaches `connectionState: 'connected'`, and capture unlocks (T27 follow-up 1; standalone green ×2, full-battery evidence in the T27 section below). **Adjacent observation — RESOLVED 30 Oct 2026:** the mid-session phone reload re-established the peer connection but not the `capture` datachannel (post-reload capture failed with "The data channel closed before the frame could start"). Fixed in `src/lib/pairing` (re-announce → `PairingPeer.restart` rebuilds pc + channel) and now asserted green end-to-end — evidence in the EX-7 follow-up section below.

## E2E selector mapping (from T8)

The T8 shell commit (`8aeb869`) adjusted selectors in `tests/e2e/app.spec.ts` while preserving the pre-existing failure paths 1:1. The complete mapping it made:

| Pre-shell selector (before `8aeb869`) | Post-shell selector (current) | Sites |
|---|---|---|
| `getByRole('textbox', { name: 'Search points of interest' })` | `getByRole('searchbox', { name: 'Search points of interest' })` | 4 call sites in `app.spec.ts` |

Everything else was kept verbatim: `canvas[aria-label="The Amber Hall 3D viewer"]`, headings (`The Amber Hall`, `… · GLB asset`), `Enter walkthrough`, `Choose video or photo set`, `Plot walking route` / route-failure copy, and the manifest/GLB failure-path routes. T8 added 5 new shell tests (`tablist`, `tabpanel`, `[data-testid^="workspace-"]` single-mount, `tab-*` shortcuts, `● LOCAL`/`◇ OFFLINE`). Current canonical anchors across all five specs: roles `searchbox`/`option`/`button`/`tablist`/`tab`/`tabpanel`/`heading`, `getByLabel('Choose capture images')`, and the `tab-viewer|tab-capture|tab-scan` + `workspace-*` test ids (source: `tests/e2e/*.spec.ts`, 29 Oct).

## Manual browser acceptance checklist

The following must be run against the local Vite server before a Round 1 demo:

- [x] Initial scene manifest, navigation, semantics, and quality data load.
- [x] Synthetic fixture renders in PlayCanvas.
- [ ] `Enter walkthrough` requests pointer lock — manual headed-browser check; headless Chromium does not claim this.
- [ ] WASD/arrow movement updates the coordinate readout — manual headed-browser check requiring canvas focus/pointer lock.
- [ ] `Escape` releases pointer lock while keeping the UI usable — manual headed-browser check.
- [x] Reset returns to the documented start position.
- [x] A* route around fixture obstacles appears after selecting a POI.
- [x] Jump-to moves to the POI approach point and updates status.
- [x] Invalid search produces an empty state and clears the old destination.
- [x] Capture selection validates media types and reports staged files.
- [x] Missing scene data shows a retryable error state.
- [x] The layout remains usable at laptop and narrow viewport widths.

Not yet run anywhere: a real-phone pairing smoke over a physical LAN (manual, pre-demo — see `docs/PAIRING.md`), and reduced-motion/contrast spot checks on the judging laptop (T27 checklist).

## Current environment evidence (carried forward, refreshed 29 Oct)

- The CPU-safe image-folder ingest path was exercised with a temporary one-file fixture and produced a frame manifest successfully. It was not a real phone image and did not proceed to reconstruction. *(24 Oct, carried forward.)*
- The generated GLB fixture was created with `scripts/generate_glb_fixture.py`, has a valid glTF 2.0 header and matching declared file length, and is validated by the scene validator. It is synthetic geometry, not a reconstruction. *(24 Oct, still validated by `validate:scenes` on 29 Oct.)*
- Playwright Chromium E2E (29 Oct, 28/28) verified: synthetic startup, POI search/click, route plotting, jump-to, invalid-search clearing, file staging, GLB loading through `/?scene=glb`, scene switching, reset, missing/malformed-manifest and missing/malformed-GLB recovery, unreachable-route states, narrow viewport, the T8 shell (a11y tabs, shortcuts, single workspace mount, canvas destruction, honest offline state), the T17 HUD rules, and the T16 route-status strip. Headless Chromium does not claim pointer lock or WASD movement.
- This environment can validate the CPU-safe fixture, frame-manifest, and bundle code, and can run COLMAP's SfM stages, but it **cannot honestly claim a successful real capture-to-reconstruction run**: the real-photo attempt is blocked at the SfM gate (EX-4).

## Performance evidence

Bundle-size measurement: fresh `npm run build` numbers are in the *Build budgets* table above (29 Oct 03:58 IST, chunk-checked 04:20 IST); `benchmark/build-report.json` holds T25's 29 Oct 04:16 IST report with its `expectations` block. No browser FPS, reconstruction wall-clock, or GPU memory benchmark is recorded yet. Runtime FPS, metadata-to-render timing, and reconstruction performance must be measured on the actual judging laptop and processing GPU.

## T24 — E2E suites (workflows, persistence, camera, WebRTC loopback)

Landed 29 Oct (T24 session). Full `npm run test:e2e` ran **green twice in a row** (the required 2× on the working tree), plus a third green pass inside `scripts/quality_gate.py` (**10/10, GATE_EXIT=0**):

| Run | Result | Wall time |
|---|---|---|
| Full run #1 | **35/35 passed** | 1.4 min tests / 1:26.8 wall |
| Full run #2 | **35/35 passed** | 1.6 min tests / 1:38.1 wall |
| Quality gate (incl. e2e) | 35/35 inside gate, gate 10/10 | — |

**New spec inventory (7 new tests over 5 files + 1 helper, all green ×2; `scan-leak.spec.ts` re-landed 29 Oct by the EX-1 fix session — now 8 tests over 6 files, see written exception 1):**

| Spec | Tests | Covers |
|---|---|---|
| `workflow.spec.ts` | 1 | T24 §1 three-tab journey: new room `Lab 201` + staged PNG + FRONT assignment (real ingest pipeline) → viewer search/plot-route/jump → Live Scan visit → back to studio → **reload** → rooms/view-groups/images **and** camera pose restored from IndexedDB; zero page errors |
| `capture-export.spec.ts` | 1 | T24 §2 upload → assign → coverage shape change → Export bundle → **download intercepted**: ZIP magic `PK\x03\x04`, size > 0, honest filename `namma-space-prepared-capture-<ISO>.zip`, success toast names the same file |
| `camera.spec.ts` | 2 | T24 §4 fake device (`--use-fake-device-for-media-stream --enable-unsafe-swiftshader --disable-gpu-sandbox` + `grantPermissions(['camera'])`): preview `data-status="live"` with real frames (`videoWidth > 0`), LIVE → CAPTURING → STAGED rail advancement through one real capture (MutationObserver on the rail rows — a fast CAPTURING pass cannot be raced), desktop stages the frame; denied variant via `context.clearPermissions()` → `camera-denied` + exact `CAMERA_REMEDY` copy |
| `webrtc-loopback.spec.ts` | 1 | T24 §5 two pages, one context (desktop `?workspace=scan` + `?pair=TOKEN` phone) over the dev-server `/ws` relay: `RTCPeerConnection.connectionState === 'connected'` asserted within 10 s **on the real PC instances** (constructor instrumented via init script), one real capture crosses the `capture` datachannel, the host receives the `capture-state` message (observed at the onmessage wrapper), frame ack (`send-ack · N bytes`), host `phone-frames` panel. One retry allowed; a second failure throws a loud error — no silent skip |
| `motion-reduced.spec.ts` | 2 | T24 §6 `emulateMedia({ reducedMotion: 'reduce' })`: scene skeleton is a static fill (every block `animation-name: none`); in-page 16 ms probe across scan→capture→viewer tab switches records **zero transform deltas** (computed-matrix movement between consecutive samples; opacity-only fades and inline identity `translate(0px,0px)` instant cuts are §7.4-legal and not counted) |
| `scan-leak.spec.ts` | 1 | T22 AC (re-landed 29 Oct after the EX-1 fix): real loopback pairing + one verified frame, then 5× scan-tab remounts — coverage canvas count exactly 1 after every remount (0 while away), no false context-conflict alert, console/pageerror trap with zero precision/null-context throws and zero unexpected context-loss noise |
| `pairing.ts` | — | Shared loopback helper (not a spec — name does not match testMatch): PC/onmessage instrumentation, rail MutationObserver history, host/phone page pairing, snapshot mirror (below) |

**Environment note (why the camera specs use `channel: 'chromium'`):** on this machine Playwright's default `chrome-headless-shell` answers `getUserMedia` with `NotSupportedError: Not supported` even under `--use-fake-device-for-media-stream` with camera permission granted (verified with a minimal probe). The three camera-dependent specs (`camera`, `webrtc-loopback`, and `scan-leak` — the leak check, landed by the EX-1 fix session) therefore set `test.use({ channel: 'chromium' })` — the full Chromium new headless, which captures the fake stream (`video:live`, 640×480). This is a per-spec `test.use` only; the global config and the other 28 tests are untouched.

**Written exceptions (T24 contract: no silent skips, written reasons here):**

1. **`scan-leak.spec.ts` (T22 AC: scan-tab remount ×5, stable canvas count, no WebGL-lost warnings) — RESOLVED 29 Oct 2026 (EX-1 fix session): the app bug is fixed and the spec is landed (`tests/e2e/scan-leak.spec.ts`, 1 test).** Fix: `CoverageVisualizer` now owns its `<canvas>` **per effect invocation** — the element is created imperatively inside the mount effect and appended to the bed div; cleanup (and the cancelled-lazy-chunk branch, now via `disposeRenderer`) removes/disposes only the canvas THAT pass created, so StrictMode pass 1's `forceContextLoss()` can never poison pass 2's renderer (`src/components/scan/CoverageVisualizer.tsx`; `scene3d.ts` unchanged — the T22 registry/guard/disposal seams and the 5-remounts→0-live unit guard are untouched). **RED evidence (pre-fix):** the new spec failed at the first remount (`coverage canvas count unstable after remount 1`, 0 canvases forever), and an instrumented probe captured `canvases=0, conflictAlert=1` plus console `THREE.WebGLRenderer: Cannot read properties of null (reading 'precision')` — exactly the diagnosis below. **GREEN evidence (post-fix):** the spec passes standalone and inside two full `npm run test:e2e` runs, **36/36 in both runs (56.8 s each, no flakes)**, and inside `scripts/quality_gate.py` (**10/10, GATE_EXIT=0**). The spec pairs over the real `/ws` loopback relay, crosses one real verified frame, then remounts scan→capture→scan ×5 asserting canvas count exactly 1 after every remount (0 while the workspace is away — destruction is asserted too), no context-conflict alert, and a console/pageerror trap recording zero precision/null-context throws, zero browser `CONTEXT_LOST_WEBGL` warnings and zero page errors (only three's own deliberate-teardown marker `THREE.WebGLRenderer: Context Lost.` would be tolerated — it never fired). Original T24 diagnosis, preserved for the record: React 19 StrictMode double-invokes the `CoverageVisualizer` mount effect; both passes share the SAME `<canvas>` (ref survives the double-invoke), and the lazy `import('three')` continuations can settle in either order. In the failing order, pass 1's *cancelled* branch runs `renderer.forceContextLoss()` on the shared canvas **before** pass 2's `new THREE.WebGLRenderer({canvas})` runs; the second `getContext('webgl2')` then returns `null` → three throws `THREE.WebGLRenderer: Cannot read properties of null (reading 'precision')` → the component's `.catch` sets `contextConflict` → the honest "3D coverage unavailable — another spatial viewer is already live" alert renders and **no canvas ever mounts**. The remount loop therefore counts 0 canvases forever. Production (single effect pass) mounts fine, so this was dev-StrictMode-only — but the e2e runs against the dev server, so the AC could not pass until fixed.
2. **Shared-context snapshot mirror in `tests/e2e/pairing.ts` (`clearWorkspaceSnapshot`) — workaround for a real app-level race, flagged for the owning task. — RESOLVED as EX-7 (fix `9d7f33f`, pairing-hydrate 15/15 + returning-phone e2e re-check; `clearWorkspaceSnapshot` is now opt-in per scenario and the loopback path runs WITHOUT it). Original text preserved:** T9 persists `pairing: IDLE` in every snapshot and `state/hydrate` replaces the store wholesale. In one browser context (the T24-mandated two-pages-one-context loopback), the desktop's snapshot hydrates on the phone page *after* its session dispatched PAIRING, desyncing the sync-bridge shadow from the store — every later pairing transition (LIVE…) is then silently rejected and the phone rail is stuck at IDLE with capture locked forever. A real first-scan phone never hits this (fresh profile → empty IDB), so the helper mirrors that invariant by deleting only the `kv/workspace-snapshot.v1` record before each page load (staged-image records untouched). **Real-user impact:** a *returning* phone (stale snapshot in its own browser) WILL hit the same stall — recommend a src fix (hydrate should preserve a live pairing machine, or the bridge should resync after hydration) in T21/T9 follow-up.
3. **Baseline note:** the very first pre-T24 full run failed `viewer-route.spec.ts` (27/28) while another session's Playwright run was concurrently using port 5183. That spec passed in all four subsequent full runs on an uncontended port — contention, not regression.

## T27 — Final release gate (full battery, recorded)

**Run:** 30 Oct 2026, 13:19–13:28 IST, branch `ashwinwork`, working tree (follow-up 1/2 edits included: `tests/e2e/pairing.ts` opt-in `phoneProfile`, `tests/e2e/webrtc-loopback.spec.ts` returning-phone re-check, comment-only edits in `tests/pairing-hydrate.test.ts`, this file). Every number below comes from a command executed for this record. (A partial battery also ran 29 Oct 16:00–16:03 IST before a session interruption — identical results for typecheck/lint/scenes/preflight/pytest; the 30 Oct numbers supersede.)

### Automated results

```text
npm run typecheck                      PASS (exit 0)                                 13:19 IST
npm run lint                           PASS (exit 0) — 0 errors,                      13:20 IST
                                       6 react-refresh/only-export-components
                                       warnings (pre-existing; do not gate)
npm run test (vitest run)              PASS — Tests 667 passed (667), 34 files,
                                       wall 6.5 s                                    13:20 IST
npm run test:e2e — full run #1         PASS — "36 passed (1.7m)", 103.5 s wall       13:22 IST
npm run test:e2e — full run #2         PASS — "36 passed (1.8m)", 106.7 s wall       13:24 IST
npm run validate:scenes                PASS — "Validated 2 scene bundles" (also
                                       PASS inside the gate at 13:26 IST)
npm run build                          PASS (exit 0) — entry index-B3nAonzM.js
                                       448,361 B raw / 139,765 B gzip vs 368,640 B
                                       budget; built in 4.54 s, 8.0 s wall          13:24 IST
npm run benchmark:build                PASS (exit 0) — benchmark/build-report.json
                                       regenerated (uncommitted churn, lead-owned)
python3 scripts/check_chunks.py        PASS (exit 0) — fflate/idb/playcanvas/
                                       qrcode-generator/three each in their own
                                       lazy chunk; gsap honest "not imported"
                                       exception                                    13:24 IST
python3 scripts/quality_gate.py        GATE_EXIT=0 — 10/10 PASSED (source
  (= npm run quality)                  heuristics, typecheck, lint, unit, scenes,
                                       build, benchmark, chunk budgets,
                                       reconstruction preflight, browser E2E);
                                       wall 109 s; inside it: vitest 667/667
                                       (34 files) and e2e 36/36 ("1.5m")           13:26 IST
uv run --with pytest python -m         PASS — 65 passed in 24.15 s, 24.8 s wall
  pytest tests -q   (repo root)        (re-baselined 65/65)                          13:28 IST
npm run preflight:reconstruction       PASS — colmap 4.2.1 (CPU-only), ffmpeg
                                       available; nvidia-smi missing (optional,
                                       EX-2); also PASS inside the gate
```

### EX-7 e2e evidence (follow-up 1 — returning phone, no workaround)

The store-level fix (`mergePairingOnHydrate`, `9d7f33f`) **holds in the browser without the `clearWorkspaceSnapshot` workaround**:

- `tests/e2e/webrtc-loopback.spec.ts` now runs the whole loopback as a **returning phone**: `openPair(…, { phoneProfile: 'returning' })` keeps the host's stale `kv/workspace-snapshot.v1` in the shared IndexedDB (a precondition poll *proves* it is present — no silent fallback to the workaround), the phone pairs THROUGH hydrate, and then the phone page **RELOADS with the snapshot still present**. Assertions after the reload: a real new `RTCPeerConnection` reaches `connectionState: 'connected'` ≤ 10 s, the rail reaches `LIVE` active, the `IDLE` row is NOT active ("stuck at IDLE" = the pre-fix symptom), and `capture-frame` is enabled (capture unlocked).
- Evidence: standalone **green ×2** on 30 Oct (walls 7.2 s / 6.1 s including dev-server start; test times 3.3 s / 2.3 s), inside both full e2e runs (**36/36 each**), and inside the quality gate (**10/10, GATE_EXIT=0**).
- Unit companion: `tests/pairing-hydrate.test.ts` **15/15** (comments re-labeled EX-2 → EX-7; logic untouched).
- Frame counts in the loopback are baseline-relative (`initialFrames + 1`) because the single allowed retry shares the context's IndexedDB — a staged frame from a failed earlier attempt is still honestly there; the assertion still proves exactly one new verified frame crosses.
- **Adjacent observation — RESOLVED 30 Oct 2026 (evidence below):** after the mid-session phone reload the RTCPeerConnection re-established, but the host did not re-create the `capture` datachannel — a post-reload capture failed honestly with "The data channel closed before the frame could start" (T27 diagnostics). **Root cause:** `peer.ts` creates the channel exactly once per PeerConnection (initiator-only `createPc`), and a second offer on the OLD connection cannot re-send DCEP OPEN — the reloaded side's `ondatachannel` never fired. **Fix (`src/lib/pairing`, rejoin rebuild):** the relay's re-announce is the deterministic rejoin signal (a room only fills to two again after a member's socket closed — PEER_LEFT closes it at 2→1), so a second `peer-joined` makes BOTH roles rebuild from scratch — `PairingPeer.restart()` tears the connection down and re-runs the proven first-pairing path (fresh pc, fresh `capture` channel, fresh offer). Rejected: renegotiating on the old pc (needs `onnegotiationneeded` + risks a zombie channel that claims `open` on one end only — the exact silent-dead-channel failure the invariant forbids). **Test evidence (all commands run 30 Oct):** (1) RED — the extended `tests/e2e/webrtc-loopback.spec.ts` post-reload second-frame assertion failed loudly on both allowed attempts pre-fix (`send-ack` never reached "Frame acknowledged"; loud both-attempts throw at spec line 212); (2) unit — new `tests/pairing-rejoin.test.ts` **3/3 green**, driving the REAL `SignallingRelay` (phone-reload rejoin + no-reload signalling-blip rejoin + first-fill-never-rebuilds; RED pre-fix: the reloaded side never reached LIVE and the host stayed STAGED with every old channel end closed); (3) targeted loopback **green ×2** (2.5 s / 1.9 s); (4) full e2e **36/36 ×2** (1.6 m / 1.7 m) and **36/36 inside the quality gate**; (5) vitest **670/670** (35 files — +3 over the 667/34 baseline), typecheck 0, lint 0 errors (6 known react-refresh warnings), `quality_gate.py` **GATE_EXIT=0** (10/10). The loopback now asserts a SECOND verified frame crosses after the reload (host `phone-frames` `initialFrames + 2` plus a post-reload `capture-state: capturing` observed on the rebuilt host datachannel) — no sleep, no weakened assertion.

### Manual checklist (T27 goal; spec accepted_tradeoffs: human-run)

| Item | Entry |
|---|---|
| Reduced-motion demo | **NOT RUN** by T27 (human visual check); mechanized coverage: `motion-reduced.spec.ts` 2/2 green inside all three e2e runs today |
| Grayscale-status check | **NOT RUN** (human check on judging laptop) |
| HUD-over-black/white contrast spot check | **NOT RUN** (human check) |
| Real-phone pairing smoke (manual, pre-demo) | **NOT RUN** — no physical phone on this machine; loopback substitute green ×2 incl. the returning-phone path (EX-7) |
| Offline (Wi-Fi off) sanity | **NOT RUN** — would require toggling the host network; e2e covers the honest `◇ OFFLINE` state instead (shell suite, green) |

These five are explicit **pending human entries** (pre-demo), not gate failures — the automated chain above is fully green. **EX-6 retired:** typecheck passes on this tree (03:53 T26, 04:18 lead, 13:19/13:20/13:26 T27), so the in-flight `receive.ts` red no longer exists.
