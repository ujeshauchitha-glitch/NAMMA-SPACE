# Validation record

**Record date:** 29 October 2026 (runs 03:52–04:10 IST, branch `ashwinwork`, working tree).
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
npm run typecheck                 PASS (exit 0)                                    03:53 IST
npm run lint                      FAIL (exit 1) — 1 error + 5 warnings → EX-1       03:53, 03:59, 04:09 IST (3 runs)
npm test (vitest run)             PASS — Tests 542 passed (542), 29 files          04:09 IST
  … tracked files only (27 files)  PASS — Tests 492 passed (492)                    04:05 IST
  … at commit d4acf04             526/526 (lead re-run recorded in that commit message, 03:45 IST)
npm run test:e2e                  PASS — "28 passed (1.6m)", 5 spec files           03:55 IST
npm run validate:scenes           PASS — "Validated 2 scene bundles" (python3 = 3.15.2)
  … same command under python3.14  PASS — "Validated 2 scene bundles" (3.14.6), exit 0
  … same command under python3.13  PASS — "Validated 2 scene bundles" (3.13.7), exit 0
npm run build                     PASS (exit 0) — chunk table below                 03:58 IST
npm run preflight:reconstruction  PASS — colmap: available (4.2.1, no GPU support);
                                   ffmpeg: available; nvidia-smi: missing (optional)
.venv/bin/python -m pytest tests/ PASS — "31 passed in 39.78s" (repo-root pipeline suite;
                                   pytest was not installed in .venv, so T26 ran `pip install pytest` first)
npm run dev:lan smoke             PASS — HTTPS 200 via `curl -k`; a `ws` client completed
                                   `join` over `wss://…/ws?session=…` and closed cleanly  04:01 IST
npm run quality                   NOT RUN by T26 → EX-5
npm run benchmark:build           NOT RUN by T26 → EX-5
```

Working-tree churn note: between 03:53 and 04:09 IST another in-flight workstream's untracked test files (`tests/pairing-journey.test.ts`, `tests/scan-capture.test.ts`) first failed (6 tests, 03:53 IST) and then went green as that workstream progressed; a temporary `tests/debug-journey.test.ts` scaffold appeared and was deleted. The 542/542 figure at 04:09 IST is the settled snapshot. At `d4acf04` (the last committed state when this record was written) the lead recorded 526/526.

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

**Python:** scene validator (`validate_all_scenes.py`, 2 bundles), repo pipeline pytest suite (31 tests), reconstruction preflight. The ZIP→`prepare_capture.py` seam is covered by vitest `prepare-capture-zip.test.ts` (it drives the real exporter and the real script).

## Build budgets — fresh build, 29 Oct 03:58 IST

| Scope | Budget (T25) | Measured | Verdict |
|---|---|---|---|
| Initial entry JS, gzip | ≤ 360 KB | `index-C9M-qaHL.js` 418.63 kB raw / **130.11 kB gzip** | PASS |
| PlayCanvas engine | separate lazy chunk | `PlayCanvasViewer-Bt_FrsDT.js` 2,032.70 kB / 523.22 kB gzip | PASS (Vite warns the chunk is large) |
| `qrcode-generator` | separate lazy chunk | `qrcode-5IewWFXk.js` 21.14 kB / 7.64 kB gzip | PASS |
| Other emitted JS | — | `browser-…js` 8.92/4.45 kB, `index-…js` 3.52/1.42 kB | info |
| CSS | — | `index-…css` 38.88 kB / 8.29 kB gzip | info |

Per-library chunk attribution for `three`/`gsap`/`fflate`/`idb` is **not** verified by this record (T25 owns that check). `benchmark/build-report.json` still holds the 24 Oct snapshot (2,396,064 bytes / 631,109 gzip total, initial JS 333,596 / 101,616) because regenerating it rewrites `benchmark/**`, which is outside T26 file ownership — see EX-5.

## mkcert smoke result (T19)

- The `vite-plugin-mkcert` path was abandoned for a documented reason: its `mkcert -install` step calls `security add-trusted-cert`, which fails without a sudo-capable terminal, and the plugin has no skip-install option (`DECISION_LOG.md` D-013, `vite.config.ts` header comment). On 29 Oct `mkcert` is additionally **not installed** (`which mkcert` → not found).
- Fallback `@vitejs/plugin-basic-ssl` **verified live on 29 Oct**: `npm run dev:lan` printed `https://localhost:5174/` and `https://10.68.49.201:5174/`; `curl -k` returned **200**; the certificate is self-signed (`issuer=CN=example.org, O=Test`, valid 28 Oct → 27 Nov 2026); a `ws` client opened `wss://127.0.0.1:5174/ws?session=…`, its `join` frame was accepted, and it closed cleanly (101 upgrade + relay attached).
- Port caveat observed in this smoke: 5173 was already held by an unrelated project's vite, so Vite fell back to **5174** — always read the URL the dev server prints (the runbook `docs/PAIRING.md` says so too).

## Documented exceptions

- **EX-1 — `npm run lint` fails (blocks `npm run quality` today).** `tests/prepare-capture-zip.test.ts:15` imports `mkdirSync` and never uses it → `@typescript-eslint/no-unused-vars` **error** (plus 5 pre-existing `react-refresh/only-export-components` warnings). The file is committed at `6a7654a`, and the error reproduced on three runs (03:53 / 03:59 / 04:09 IST). The one-line fix lives in `apps/studio/tests/`, which T26 does not own — **lead/test owner must remove the unused import** before the T27 gate can pass.
- **EX-2 — reconstruction preflight has no GPU evidence.** `nvidia-smi` is missing on this Apple Silicon machine, so COLMAP GPU/dense stages cannot be exercised here; the pipeline's honest `--cpu` mode is used. Preflight still passes (GPU diagnostics are optional).
- **EX-3 — headless-Chromium limits.** Pointer lock and WASD-driven coordinate updates are not claimed from headless e2e; they remain manual headed-browser checks (checklist below).
- **EX-4 — real-capture reconstruction is blocked, not green.** No real reconstruction has succeeded; the 70-photo set registers 57% and splits into two rooms (blocker `logs/round1-rescue/BLOCKERS.md` BLK-001). Both shipped scenes are synthetic — e2e `viewer-hud` asserts the `SIMULATED` pill is present and never dismissible.
- **EX-5 — `npm run quality` and `npm run benchmark:build` were not run by T26.** Both rewrite `benchmark/build-report.json`, which is outside T26 file ownership (`benchmark/**`), and `quality` would additionally fail at EX-1 (it runs `npm run lint`) while `scripts/quality_gate.py` itself is being edited by another in-flight workstream. The full chain, including these two commands, belongs to the T27 release gate.

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

Bundle-size measurement: fresh `npm run build` numbers are in the *Build budgets* table above (29 Oct); `benchmark/build-report.json` holds the older 24 Oct snapshot (see EX-5). No browser FPS, reconstruction wall-clock, or GPU memory benchmark is recorded yet. Runtime FPS, metadata-to-render timing, and reconstruction performance must be measured on the actual judging laptop and processing GPU.
