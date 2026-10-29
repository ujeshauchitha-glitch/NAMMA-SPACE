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

- **EX-1 — lint error during this record (RESOLVED).** `npm run lint` failed with 1 error (`tests/prepare-capture-zip.test.ts:15` unused `mkdirSync` import, committed at `6a7654a`) in three runs at 03:53 / 03:59 / 04:09 IST, which would have failed `npm run quality`. The T25 workstream removed the import in `1f3ddfa` (04:18 IST); T26 re-ran lint at 04:21 IST: **exit 0, 0 errors, 5 pre-existing `react-refresh/only-export-components` warnings** (warnings only — they do not gate).
- **EX-2 — reconstruction preflight has no GPU evidence.** `nvidia-smi` is missing on this Apple Silicon machine, so COLMAP GPU/dense stages cannot be exercised here; the pipeline's honest `--cpu` mode is used. Preflight still passes (GPU diagnostics are optional).
- **EX-3 — headless-Chromium limits.** Pointer lock and WASD-driven coordinate updates are not claimed from headless e2e; they remain manual headed-browser checks (checklist below).
- **EX-4 — real-capture reconstruction is blocked, not green.** No real reconstruction has succeeded; the 70-photo set registers 57% and splits into two rooms (blocker `logs/round1-rescue/BLOCKERS.md` BLK-001). Both shipped scenes are synthetic — e2e `viewer-hud` asserts the `SIMULATED` pill is present and never dismissible.
- **EX-5 — `npm run quality` and `npm run benchmark:build` were not run by T26.** Both invoke `benchmark:build`, which rewrites `benchmark/build-report.json` — outside T26 file ownership (`benchmark/**`). The report was regenerated by T25 at 04:16 IST, and the lead recorded `npm run quality` all-steps green at 04:18 IST (commit `1f3ddfa` message). T26 ran `check_chunks.py` directly (read-only) instead. The full chain remains T27's gate.
- **EX-6 — typecheck red on the in-flight working tree at 04:21 IST** (TS2322 in untracked `src/lib/scan/receive.ts`, concurrent D4/T21 workstream). Not present in any commit; typecheck passed at 03:53 (T26) and 04:18 (lead). Tracked here so the T27 gate cannot be surprised; the owning workstream must fix it. See the churn note above.

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

**New spec inventory (7 new tests over 5 files + 1 helper, all green ×2):**

| Spec | Tests | Covers |
|---|---|---|
| `workflow.spec.ts` | 1 | T24 §1 three-tab journey: new room `Lab 201` + staged PNG + FRONT assignment (real ingest pipeline) → viewer search/plot-route/jump → Live Scan visit → back to studio → **reload** → rooms/view-groups/images **and** camera pose restored from IndexedDB; zero page errors |
| `capture-export.spec.ts` | 1 | T24 §2 upload → assign → coverage shape change → Export bundle → **download intercepted**: ZIP magic `PK\x03\x04`, size > 0, honest filename `namma-space-prepared-capture-<ISO>.zip`, success toast names the same file |
| `camera.spec.ts` | 2 | T24 §4 fake device (`--use-fake-device-for-media-stream --enable-unsafe-swiftshader --disable-gpu-sandbox` + `grantPermissions(['camera'])`): preview `data-status="live"` with real frames (`videoWidth > 0`), LIVE → CAPTURING → STAGED rail advancement through one real capture (MutationObserver on the rail rows — a fast CAPTURING pass cannot be raced), desktop stages the frame; denied variant via `context.clearPermissions()` → `camera-denied` + exact `CAMERA_REMEDY` copy |
| `webrtc-loopback.spec.ts` | 1 | T24 §5 two pages, one context (desktop `?workspace=scan` + `?pair=TOKEN` phone) over the dev-server `/ws` relay: `RTCPeerConnection.connectionState === 'connected'` asserted within 10 s **on the real PC instances** (constructor instrumented via init script), one real capture crosses the `capture` datachannel, the host receives the `capture-state` message (observed at the onmessage wrapper), frame ack (`send-ack · N bytes`), host `phone-frames` panel. One retry allowed; a second failure throws a loud error — no silent skip |
| `motion-reduced.spec.ts` | 2 | T24 §6 `emulateMedia({ reducedMotion: 'reduce' })`: scene skeleton is a static fill (every block `animation-name: none`); in-page 16 ms probe across scan→capture→viewer tab switches records **zero transform deltas** (computed-matrix movement between consecutive samples; opacity-only fades and inline identity `translate(0px,0px)` instant cuts are §7.4-legal and not counted) |
| `pairing.ts` | — | Shared loopback helper (not a spec — name does not match testMatch): PC/onmessage instrumentation, rail MutationObserver history, host/phone page pairing, snapshot mirror (below) |

**Environment note (why the camera specs use `channel: 'chromium'`):** on this machine Playwright's default `chrome-headless-shell` answers `getUserMedia` with `NotSupportedError: Not supported` even under `--use-fake-device-for-media-stream` with camera permission granted (verified with a minimal probe). The three camera-dependent specs (`camera`, `webrtc-loopback`, and the planned leak check) therefore set `test.use({ channel: 'chromium' })` — the full Chromium new headless, which captures the fake stream (`video:live`, 640×480). This is a per-spec `test.use` only; the global config and the other 28 tests are untouched.

**Written exceptions (T24 contract: no silent skips, written reasons here):**

1. **`scan-leak.spec.ts` (T22 AC: scan-tab remount ×5, stable canvas count, no WebGL-lost warnings) — NOT landed; blocked by a real app bug, not by test flake.** Root cause (100 % reproducible on the dev server, captured console evidence): React 19 StrictMode double-invokes the `CoverageVisualizer` mount effect; both passes share the SAME `<canvas>` (ref survives the double-invoke), and the lazy `import('three')` continuations can settle in either order. In the failing order, pass 1's *cancelled* branch runs `renderer.forceContextLoss()` on the shared canvas **before** pass 2's `new THREE.WebGLRenderer({canvas})` runs; the second `getContext('webgl2')` then returns `null` → three throws `THREE.WebGLRenderer: Cannot read properties of null (reading 'precision')` → the component's `.catch` sets `contextConflict` → the honest "3D coverage unavailable — another spatial viewer is already live" alert renders and **no canvas ever mounts**. The remount loop therefore counts 0 canvases forever. Production (single effect pass) mounts fine, so this is dev-StrictMode-only — but the e2e runs against the dev server, so the AC cannot pass until fixed. Fix direction for the owning task (src is out of T24 scope): create the `<canvas>` imperatively inside the effect (per-mount element ownership), or skip `forceContextLoss()` in the cancelled branch and let each pass own a fresh canvas. The completed spec body is preserved in the T24 handoff and can be re-added verbatim after the fix (it already covers the paired-frame journey + the 5× remount loop + a console trap for `context lost` warnings).
2. **Shared-context snapshot mirror in `tests/e2e/pairing.ts` (`clearWorkspaceSnapshot`) — workaround for a real app-level race, flagged for the owning task.** T9 persists `pairing: IDLE` in every snapshot and `state/hydrate` replaces the store wholesale. In one browser context (the T24-mandated two-pages-one-context loopback), the desktop's snapshot hydrates on the phone page *after* its session dispatched PAIRING, desyncing the sync-bridge shadow from the store — every later pairing transition (LIVE…) is then silently rejected and the phone rail is stuck at IDLE with capture locked forever. A real first-scan phone never hits this (fresh profile → empty IDB), so the helper mirrors that invariant by deleting only the `kv/workspace-snapshot.v1` record before each page load (staged-image records untouched). **Real-user impact:** a *returning* phone (stale snapshot in its own browser) WILL hit the same stall — recommend a src fix (hydrate should preserve a live pairing machine, or the bridge should resync after hydration) in T21/T9 follow-up.
3. **Baseline note:** the very first pre-T24 full run failed `viewer-route.spec.ts` (27/28) while another session's Playwright run was concurrently using port 5183. That spec passed in all four subsequent full runs on an uncontended port — contention, not regression.
