# Namma Space V1 — Implementation Specification

**Status:** implementation-ready. A `developer` executes the tasks below in order without further clarification.
**Author:** OAK specifier · **Date:** 2026-10-24 · **Deadline:** Round 1, 31 Oct 2026 (7 days).
**Authoritative inputs:** `docs/design/DESIGN_HANDOFF.md` (identity GROUNDTRUTH / palette MERIDIAN — mandatory), lead-synthesized research facts (dependency versions, baseline test state, hardware limits), lead's binding scope decisions. Nothing in this spec re-derives those inputs.

---

## 1. V1 contract

### 1.1 Problem statement

The repo is a proof-of-concept single-screen PlayCanvas viewer with a zod-validated scene contract, an A* navigation library, and a Python capture pipeline — but no product shell, no capture workflow, no phone integration, no design system, and one broken Python test. V1 must become a demo-able three-workspace tool (Capture Studio → Spatial Viewer → Live Scan) whose every on-screen claim is measured, stated, or explicitly labelled simulated.

### 1.2 Objective

Ship the full V1 slice: shell + GROUNDTRUTH design system + all three workspaces + pairing + motion + tests + corrected docs, with real reconstruction left as an **honest blocked/partial state** (no COLMAP/CUDA on this machine).

### 1.3 In scope (mapped to master acceptance dimensions)

| Dimension | V1 commitment |
|---|---|
| **Product** | Three-workspace shell (01 Capture Studio, 02 Spatial Viewer, 03 Live Scan), compact top nav, numbered tabs with full a11y, workspace + camera-pose persistence across reload, honest-state vocabulary 1:1 with zod schema enums, fixture scenes labelled `SIMULATED`. |
| **Capture Studio** | Rooms, view groups (preset + custom), image upload (file picker + drag-drop progressive enhancement), client-side decode via `createImageBitmap` with resize, HEIC honest error, IndexedDB persistence, category-occupancy coverage indicator (no % rings), ZIP bundle export (manifest + images, fflate lazy). |
| **Spatial Viewer** | Existing `PlayCanvasViewer` preserved (additive-only engine hooks), lazy load/unload per tab, skeleton with real `onStatus` lines, POI combobox search, destination detail, A* route strip + in-scene tape reveal, camera jump/reset/walkthrough via engine API only, HUD chips + compass + coordinates readout, pointer-lock choreography. |
| **Live Scan** | QR pairing (mkcert LAN HTTPS + Vite dev-server WS signalling + WebRTC trickle ICE + one public STUN fallback + datachannel capture-state), camera state machine (IDLE→PAIRING→LIVE→CAPTURING→STAGED→OFFLINE/ERROR), real `<video>` preview, three.js frusta coverage visualizer (lazy, disposed), handoff of staged frames into Capture Studio; insecure-context / no-WS / no-camera degrade to honest blocked states — never faked. |
| **Motion/visual** | Full MERIDIAN token set as CSS custom properties, self-hosted-or-system fonts, hand-rolled SVG icon set, GSAP choreography for the 12 named moments with `prefers-reduced-motion` gates and documented CSS fallbacks, §7.4 lifecycle-defect guards. |
| **Engineering** | `prepare_capture.py` fixed for Python 3.13+ (magic bytes, no `imghdr`), vitest 17/17 + new suites (rooms/view-groups, manifest, IDB, A*-regressions, state machine, bundle integrity, tokens contrast), existing Playwright specs kept green (failure paths preserved 1:1) + 4 new e2e specs + WebRTC loopback spec, `validate:scenes` / `quality` / `benchmark:build` passing with budgets, docs staleness corrected. |

### 1.4 Out of scope (explicitly deferred — do not spec or build)

AR, accounts/auth, cloud fleet, SLAM, semantic detection, FastAPI backend (keep an injectable API-client seam only), real COLMAP/CUDA reconstruction on this machine, custom listbox selects, geometric-coverage scoring, per-scene dark scrims, new state-management dependency, hotlinked assets.

### 1.5 Non-goals

- Pixel-perfect parity with any reference beyond `DESIGN_HANDOFF.md`.
- Touch-layout polish beyond the breakpoints' structural behavior (§6.3).
- Performance work beyond the build-size budget (§5, T25).

---

## 2. Context & assumptions

- Repo has **0 commits**; everything is untracked; **nothing may be deleted**. `.gitignore` already exists and excludes `node_modules/`, `dist/`, `test-results/`, etc. (verified).
- Baseline: typecheck ✓, lint ✓, vitest 16/17 (sole failure `tests/pipeline.test.ts` vs `imghdr` on Python 3.14.6), Playwright green, ffmpeg ✓, no COLMAP/CUDA/cv2/open3d, 8 GB RAM, macOS 26.3.1.
- `npm` scripts available: `dev`, `build`, `preview`, `typecheck`, `lint`, `test`, `test:e2e`, `quality`, `validate:scene(s)`, `benchmark:build`, `preflight:reconstruction`, `reconstruct:colmap`.
- Playwright: `tests/e2e`, port 5183, SwiftShader args in `playwright.config.ts`, `webServer` spawns `npm run dev` — **the default dev server must keep binding `127.0.0.1:5173`-style plain HTTP so this never breaks**; LAN HTTPS is opt-in via a separate script (T19).
- Phases A–H and the 1→8 build-order constraint are encoded as task order + dependency tags below (assumption: this matches the master directive's phase intent; lead may rename).
- Assumption: adding `ws@^8` (server-side, dev-time only) for the signalling relay is acceptable; fallback = hand-rolled RFC-6455 text-frame handler (see open_questions).
- Assumption: `three@0.186.1` may require `@types/three` — resolve at install (open_questions).
- All fixture scenes (`fixture`, `glb-fixture`) are `sceneKind: synthetic-demo` → mandatory `◇ SIMULATED` chip. Uploaded user photos are the only `MEASURED` data.

---

## 3. Cross-cutting standards (binding for every task)

1. **Design tokens** come only from `DESIGN_HANDOFF.md` §4 (colors, type, spacing, radius, elevation, focus, motion tokens mirrored in `src/styles/motion.ts`). No hardcoded hex/duration in components that exists as a token. New component styles = CSS Modules (`src/components/<Name>/<Name>.module.css`). `src/styles.css` is gutted to `src/styles/tokens.css` + `src/styles/base.css` imported in `main.tsx`.
2. **Honest-state rules.** Never render a state the zod schema can't back; never mark reconstructed what wasn't; simulated/fixture data carries the non-dismissible `◇ SIMULATED` chip derived from `manifest.sceneKind`/`provenance.source`; coverage UI shows category occupancy only — no % rings, no invented progress; banned copy per §9.1; canonical state names per §9.2.
3. **Lifecycle rules.** Every `URL.createObjectURL` is revoked on unmount/replace via a single `useObjectUrl`/registry helper; every IndexedDB write goes through one storage module; every engine/three.js instance has a deterministic destroy path (`destroy()` + `forceContextLoss()` for three); **never two live WebGL contexts** — the shell guarantees only one 3D workspace mounted at a time; camera tweens die on pointer-lock entry and on WASD/arrow input.
4. **A11y.** Tabs = full tablist pattern (roving tabindex, ←/→/Home/End, `aria-selected`); focus-visible cobalt ring + halo over scene; `aria-live="polite"` for scene/processing state, route strip, toast (errors `assertive`); upload progress announced at 25/50/75/100; combobox search per §5.14; canvas `role="application"` + visually-hidden position/POI alternative throttled 2 s; status never color-only (glyph+text always); `prefers-reduced-motion` honored in CSS **and** GSAP paths; 44 px touch targets in scan/touch layouts.
5. **Lazy-loading.** `playcanvas` (existing `ViewerCanvas` pattern — preserve), `three`, `fflate`, `gsap`(+`@gsap/react`), `qrcode-generator`, `idb` are all dynamically imported at point of use. Initial entry chunk budget: ≤ 360 KB gzip (baseline ≈ 332 KB). Heavy deps must appear as separate `dist/assets/*.js` chunks.
6. **Assets.** No hotlinked assets. Fonts self-hosted (`public/fonts/*.woff2` + OFL licence note) with hard system fallbacks; QR black-on-white, ECC M; Poly Haven assets (if any fixture is added) are CC0, downloaded + converted at asset-prep time, committed locally — never fetched at runtime.
7. **Testability.** Every new pure module (reducer, pairing state machine, storage wrapper, bundle builder, navigation callers) is written dependency-injected and unit-testable in node (vitest, no DOM). Browser-only behavior (IDB, camera, WebRTC, engine) is covered by Playwright e2e.
8. **Gems preserved.** `PlayCanvasViewer.ts` control flow, `src/lib/navigation.ts`, `src/types/scene.ts` zod contracts (extend additively), e2e failure-path coverage, `quality_gate.py` taxonomy.

---

## 4. Task list (phases A–H, ordered 1→27)

Sizing legend: **S** <100 LOC · **M** 100–400 LOC · **L** >400 LOC.

---

### Phase A — Baseline & toolchain

#### T1 · Git baseline commit — **S** — deps: none

- **Goal:** Snapshot the entire untracked tree as commit #1. Nothing deleted.
- **Files:** none authored; creates first commit. (`.gitignore` already covers `node_modules/`, `dist/`, `test-results/` — verify, do not rewrite unless something leaks.)
- **AC:**
  - `git add -A && git commit` succeeds; `git log --oneline | wc -l` = 1.
  - `git status --porcelain` empty after commit.
  - Tracked file count = 28 untracked paths' contents; `git show --stat HEAD | grep -c delete` = 0 (no deletions).
- **Tests:** none (verification is git commands).
- **Validation:** `git log --oneline && git status --porcelain && git show --stat HEAD | tail -3`
- **Task Contract:** objective: immutable pre-V1 snapshot. success_criteria: 1 commit, clean status, zero deletions. non_goals: any file edits. assumptions: `.gitignore` correct. open_questions: none. accepted_tradeoffs: `dist/`, `benchmark/` stay untracked/ignored. validation: commands above. ask_abort_triggers: any tracked path would be deleted.

#### T2 · Install verified dependencies — **S** — deps: T1

- **Goal:** Add runtime deps `gsap@3.15.0 @gsap/react@2.1.2 three@0.186.1 idb@8.0.4 fflate@8 → fflate@0.8.3 qrcode-generator@2.0.4`; dev dep `vite-plugin-mkcert@2.1.0`, plus `ws@^8` (signalling relay, see open_questions; fallback hand-rolled WS). Add `@types/three` (matching 0.186.x) **only if** `import * as THREE from 'three'` lacks types after install; add module declaration shim for `qrcode-generator` only if it ships no types.
- **Files:** `package.json`, `package-lock.json`, at most `src/types/shims.d.ts`.
- **AC:** exact versions pinned as above in `package.json`; `npm run typecheck && npm run lint && npm run build` all pass; no dependency is imported yet (install-only).
- **Tests:** existing suites unchanged and green (17 vitest incl. pipeline only after T3 — at this point 16/17 is the accepted state).
- **Validation:** `npm ls gsap three idb fflate qrcode-generator ws && npm run build`
- **Task Contract:** objective: toolchain ready for every V1 feature. success_criteria: listed deps installed at verified versions, build green. non_goals: any source imports of new deps. assumptions: npm registry reachable; versions verified by research. open_questions: `ws` inclusion (lead), `@types/three` need (resolved here). accepted_tradeoffs: two additions beyond the researched list, both low-risk. validation: commands above. ask_abort_triggers: registry/version conflict, lockfile corruption.

#### T3 · Fix `prepare_capture.py` for Python 3.13+ — **S** — deps: T1 (parallel with T2)

- **Goal:** Replace `import imghdr` with a stdlib magic-byte sniffer (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF....WEBP`, HEIC/HEIF `ftyp` brands `heic|heix|hevc|heif|mif1`) with `mimetypes` fallback; keep behaviour identical otherwise. **Do not pin to system Python.**
- **Files:** `scripts/prepare_capture.py`, `tests/pipeline.test.ts` (update expectations to assert magic-byte classification incl. one HEIC case).
- **AC:** script runs under default `python3` (3.14.6) without ImportError; classifies JPEG/PNG/WebP/HEIC correctly; HEIC → honest error message per §9.1 ("This file is HEIC — export JPG or run the prepare script.").
- **Tests:** `tests/pipeline.test.ts` green.
- **Validation:** `python3 --version && npm run test -- tests/pipeline.test.ts` → **17/17 vitest total**.
- **Task Contract:** objective: full vitest green on Python 3.14. success_criteria: `npm run test` exits 0 with 17/17. non_goals: pipeline feature changes, pinning py3.9. assumptions: magic-byte set suffices. open_questions: none. accepted_tradeoffs: no third-party image lib. validation: command above. ask_abort_triggers: hidden reliance on `imghdr` elsewhere (`grep -r imghdr scripts/` first).

---

### Phase B — Design-system foundation

#### T4 · Tokens, base, motion module, fonts — **M** — deps: T2

- **Goal:** Ship `src/styles/tokens.css` (§4.1–4.3 verbatim, incl. HUD + semantic + motion CSS mirrors), `src/styles/base.css` (reset, focus-visible, scrollbar, `kbd`, font stacks, `@font-face` self-hosted Archivo + IBM Plex Mono woff2 in `public/fonts/` with OFL note, hard fallbacks), `src/styles/motion.ts` (typed `M` from §7.1). Gut `src/styles.css`: remove all amber/graphite/Manrope/DM Mono/glyph-icon styles; import `tokens.css` + `base.css` from `main.tsx`; delete the Google Fonts `@import`.
- **Files:** `src/styles/tokens.css`, `src/styles/base.css`, `src/styles/motion.ts`, `src/main.tsx`, `src/styles.css` (gutted/deprecated), `public/fonts/*.woff2`, `public/fonts/OFL-note.md`, `index.html` (font preloads, favicon crosshair), `tests/tokens.test.ts` (new).
- **AC:**
  - No `#0d100f`, `#e9a54f`, `Manrope`, `DM Mono`, `⌂ ↻ ⌕ ✦ ＋` anywhere in `src/` (`grep -riE '0d100f|e9a54f|manrope|dm mono' src/` empty).
  - `@import url('https://fonts.googleapis.com...')` gone (offline-finale safe).
  - `tests/tokens.test.ts` parses `tokens.css`, computes WCAG 2.1 ratios for every §3.1 pair, asserts each ≥ AA (AAA pairs asserted at their documented ratio ±0.1).
- **Tests:** new `tests/tokens.test.ts`; existing suites unaffected.
- **Validation:** `npm run test -- tests/tokens.test.ts && npm run typecheck && npm run lint`
- **Task Contract:** objective: single token source of truth, provable contrast. success_criteria: grep-clean legacy identity, contrast test green, fonts self-hosted with fallback. non_goals: component styles. assumptions: woff2 downloads from Google Fonts/OFL at dev time (network available once). open_questions: none. accepted_tradeoffs: system fallback acceptable if download fails (recorded). validation: commands above. ask_abort_triggers: font licence uncertainty (then ship system-stack only).

#### T5 · Icon set — **S** — deps: T4

- **Goal:** `src/components/icons/icons.tsx` — the 26 inventory icons (§4.4), 16 px grid, 1.5 px stroke, square caps, miter joins, `currentColor`, `aria-hidden` default; icon-only usage gets `role="img"` + `<title>`.
- **Files:** `src/components/icons/icons.tsx`, `tests/icons.test.ts`.
- **AC:** all 26 named exports present; every component renders `aria-hidden="true"` by default; no emoji/glyph characters in file.
- **Tests:** `tests/icons.test.ts` (export inventory + prop contract; render via `react-dom/server` `renderToStaticMarkup` — no new deps).
- **Validation:** `npm run test -- tests/icons.test.ts`
- **Task Contract:** objective: complete drafting-voice icon vocabulary. success_criteria: inventory test green. non_goals: icon animations. assumptions: §4.4 list is final. open_questions: none. accepted_tradeoffs: hand-rolled SVG. validation: above.

#### T6 · UI primitives — **M** — deps: T4, T5

- **Goal:** Shared primitives per §5: `Button` (primary/secondary/signal/quiet/danger/icon × states, `aria-busy` loading with frozen min-width), `TextField`/`SearchField` (invalid state, `aria-invalid`, ⌘K badge), `StatusPill` (`state` prop: validated/needs-review/failed/blocked/simulated/live — glyph+text, never color-only), `Toast` (polite/assertive regions, max 3), `Modal` (focus trap, Esc, restore focus, `aria-modal`, destructive copy pattern), `Chip`, `Skeleton` (200 ms delay, sweep), `EmptyState`, `MetadataKV` (copy affordance, `aria-live`, tabular nums). Each with `*.module.css`.
- **Files:** `src/components/ui/*` (Button, TextField, StatusPill, Toast, Modal, Chip, Skeleton, EmptyState, MetadataKV + `.module.css`), `src/components/StatusPill.tsx` (replaced — update importers), `tests/ui-primitives.test.tsx`.
- **AC:** StatusPill rejects tones not in the schema-anchored set; Modal traps/restores focus (unit-tested with jsdom-free `renderToStaticMarkup` assertions + a11y attribute checks); all primitives consume tokens via `var(--…)` only.
- **Tests:** `tests/ui-primitives.test.tsx` (attribute/contract level).
- **Validation:** `npm run test -- tests/ui-primitives.test.tsx && npm run lint`
- **Task Contract:** objective: reusable, tokenized, a11y-first primitive layer. success_criteria: primitives exist, contract tests green, no hardcoded colors. non_goals: workspace-specific components. assumptions: CSS Modules (native Vite) fine. open_questions: none. accepted_tradeoffs: native `<select>` styling (demo reliability). validation: above.

#### T7 · Coverage indicator + view-group chips — **S** — deps: T6

- **Goal:** `CoverageIndicator` (§5.6: segmented bar, fill/hollow/hatch shapes, "category occupancy, not geometric coverage" caption verbatim) and `ViewGroupChip` (§5.5: preset+custom groups, filled/hollow square + count, toggle). Pure, data-driven props.
- **Files:** `src/components/capture/CoverageIndicator.tsx(+css)`, `src/components/capture/ViewGroupChip.tsx(+css)`, `tests/coverage.test.ts`.
- **AC:** zero `%` strings or ring/progessbar elements in output (`assert !/\\d+\\s*%/.test(markup)`); hatch state renders when `0 < count < minimum`; minimum per-group configurable.
- **Tests:** `tests/coverage.test.ts` (state-mapping table).
- **Validation:** `npm run test -- tests/coverage.test.ts`
- **Task Contract:** objective: honest occupancy UI. success_criteria: state-mapping test green, no percentages. non_goals: geometric analysis. assumptions: minimum defaults to 1. open_questions: none. accepted_tradeoffs: editable minimums deferred to settings (fixed 1 in V1 UI). validation: above.

---

### Phase C — Shell & state

#### T8 · Workspace shell + tabs — **M** — deps: T6

- **Goal:** Replace the 230-line `App.tsx` monolith with: `AppShell` (top nav §6.1: mark+wordmark `NAMMA SPACE · SPATIAL TWIN LAB`, scene/processing state pill as live region, session state `● LOCAL`/`◇ OFFLINE`), `WorkspaceTabs` (§5.3 full tablist, roving tabindex, ←/→/Home/End, `aria-controls`, shortcuts `1/2/3` + `⌘/Ctrl+1..3` outside text fields), and a workspace router mounting exactly one workspace panel; inactive panels `hidden` **and** unmounted (no zombie canvas). Responsive per §6.3 structurally (bottom bar ≤560).
- **Files:** `src/App.tsx` (gutted to composition root), `src/components/shell/AppShell.tsx(+css)`, `src/components/shell/WorkspaceTabs.tsx(+css)`, `src/components/workspace/*` (stubs: `CaptureStudioWorkspace`, `SpatialViewerWorkspace`, `LiveScanWorkspace` with placeholder empty states), `tests/e2e/app.spec.ts` (update selectors/copy — failure-path coverage preserved 1:1, mapping table in VALIDATION.md later).
- **AC:** keyboard-only tab traversal works; only one workspace component mounted at any time (assert via testid); all 6 pre-existing e2e specs pass (adjusted selectors only); `⌘1..3` and `1..3` switch workspaces.
- **Tests:** updated `tests/e2e/app.spec.ts`.
- **Validation:** `npm run test:e2e -- tests/e2e/app.spec.ts`
- **Task Contract:** objective: three-workspace shell with preserved e2e coverage. success_criteria: e2e green, single-mount invariant testable. non_goals: workspace internals. assumptions: workspace stubs acceptable until D/E/F. open_questions: none. accepted_tradeoffs: e2e selectors updated (intent preserved, documented). validation: above. ask_abort_triggers: any failure-path spec cannot be mapped — stop and report.

#### T9 · Domain state (context + reducer) — **M** — deps: T8

- **Goal:** `src/state/` — React context + reducer (no new deps): state shape = spaces/rooms/view groups/staged images (ids + metadata; blobs live in IDB), scene selection, pairing/camera state machine states, camera pose per scene, toasts; actions typed as a discriminated union; persistence seams (`persist` interface injected) so reload restores rooms/view-groups/poses; **API-client seam** `src/lib/api.ts` (interface only, file/CLI-backed default — no FastAPI).
- **Files:** `src/state/types.ts`, `src/state/reducer.ts`, `src/state/workspaceStore.tsx`, `src/state/persistence.ts`, `src/lib/api.ts`, `tests/state-machine.test.ts`, `tests/rooms-viewgroups.test.ts`.
- **AC:** reducer is pure and exhaustive over the action union (TS exhaustiveness check); room/view-group lifecycle (create, rename, assign/unassign image, delete-with-confirm payload) covered by table-driven tests; pairing states restricted to `IDLE|PAIRING|LIVE|CAPTURING|STAGED|OFFLINE|ERROR` (schema-anchored §9.2); illegal transitions rejected with honest reason.
- **Tests:** new `tests/state-machine.test.ts`, `tests/rooms-viewgroups.test.ts`.
- **Validation:** `npm run test -- tests/state-machine.test.ts tests/rooms-viewgroups.test.ts`
- **Task Contract:** objective: single typed state kernel, testable in node. success_criteria: both suites green, exhaustiveness enforced. non_goals: UI, IDB specifics (T10), WebRTC (T18). assumptions: context+reducer acceptable per lead decision. open_questions: none. accepted_tradeoffs: no devtools middleware. validation: above.

---

### Phase D — Capture Studio

#### T10 · IDB storage module — **M** — deps: T9

- **Goal:** `src/lib/storage/` — single wrapper over `idb` (lazy-imported): DB `namma-space`, stores `staged-images` (Blob + meta + sha256) and `kv` (rooms/view-groups/poses JSON); injectable `IDBFactory` for tests; quota handling: `QuotaExceededError` → typed honest error; blob size guard (skip decode-resize pipeline if raw > 25 MB → honest error).
- **Files:** `src/lib/storage/db.ts`, `src/lib/storage/images.ts`, `src/lib/storage/kv.ts`, `tests/storage.test.ts` (in-memory factory stub, hand-rolled, **no `fake-indexeddb` dep**), IDB e2e added in T24.
- **AC:** wrapper API (`putImage`, `getImage`, `listImages`, `deleteImage`, `getKv`, `putKv`) fully typed; unit suite runs in node against in-memory stub covering put/get/list/delete + error mapping; real-IDB behavior covered by e2e in T24.
- **Tests:** `tests/storage.test.ts`.
- **Validation:** `npm run test -- tests/storage.test.ts`
- **Task Contract:** objective: durable local capture store behind one module. success_criteria: unit suite green; no direct `indexedDB` usage outside `src/lib/storage/`. non_goals: sync/cloud. assumptions: injectable-factory pattern. open_questions: none. accepted_tradeoffs: hand-rolled stub. validation: `grep -rn "indexedDB" src/ | grep -v "src/lib/storage"` → empty.

#### T11 · Upload & decode pipeline — **M** — deps: T10, T6

- **Goal:** `src/lib/capture/` — file intake: magic-byte type sniff (JPEG/PNG/WebP accepted; HEIC → honest remedy error; others → honest rejection), `createImageBitmap` decode with **downscale to ≤2048 px long edge**, re-encode JPEG q0.9 via OffscreenCanvas fallback to canvas, sha256 via WebCrypto, progress callback (announced at 25/50/75/100 via polite live region in UI task T12), per-file try/catch so one bad file never aborts the batch. Object URLs created only for thumbnails and revoked via the T9 registry.
- **Files:** `src/lib/capture/ingest.ts`, `src/lib/capture/decode.ts`, `src/lib/capture/hash.ts`, `src/lib/capture/__pure__` helpers kept DOM-free where possible, `tests/capture-ingest.test.ts` (pure parts: sniffing table, resize math, HEIC branch).
- **AC:** sniff table covers JPEG/PNG/WebP/HEIC/garbage; resize math exact (unit); DOM decode failures map to typed errors; no unrevoked object URL (code review + T24 e2e leak assertion via `performance` marker or registry count).
- **Tests:** `tests/capture-ingest.test.ts` (+ e2e in T24).
- **Validation:** `npm run test -- tests/capture-ingest.test.ts`
- **Task Contract:** objective: robust, honest client-side ingest. success_criteria: pure suites green; error copy matches §9.1. non_goals: pose estimation, dedup clustering. assumptions: q0.9/2048 caps fine for 8 GB machine. open_questions: phone-frame cap (default 1600 px — see open_questions). accepted_tradeoffs: OffscreenCanvas with canvas fallback. validation: above.

#### T12 · Capture Studio workspace UI — **L** — deps: T7, T11, T9

- **Goal:** §6.2 layout (264px/1fr/328px): left rooms rail (+ New room with FLIP-ready row markup, coverage pinned bottom), center sticky view-group chip bar + thumbnail grid (hatched unassigned bar, multi-select toolbar, drag-drop progressive enhancement over real `<label>`+hidden file input), right inspector `[Details|Group|Provenance]` tabs with MetadataKV provenance block + `PREPARE CAPTURE` (signal) + `Export bundle` (secondary, enabled when ≥1 image staged) pinned to foot. Selection toolbar: assign to group, remove, delete. All states from T9; `◇/●` source chips per §5.19.
- **Files:** `src/components/capture/CaptureStudioWorkspace.tsx(+css)`, `RoomsRail.tsx`, `ThumbnailGrid.tsx`, `ImageInspector.tsx`, `SelectionToolbar.tsx`, `tests/e2e/capture.spec.ts` (partial — full flow completes in T13/T24).
- **AC:** create room → assign images → coverage bar updates shape states; deleting a room requires confirm naming room + image count; keyboard-only upload works (label+input); inspector provenance shows schema-derived values only; empty states per §5.11 wording rules.
- **Tests:** e2e skeleton in `tests/e2e/capture.spec.ts` (room create + assign), extended in T24.
- **Validation:** `npm run test:e2e -- tests/e2e/capture.spec.ts`
- **Task Contract:** objective: complete capture staging workflow. success_criteria: e2e skeleton green; §5.4–5.7 component specs respected. non_goals: ZIP export (T13), reconstruction. assumptions: upload fixtures generated in-test (tiny PNG/JPEG bytes). open_questions: none. accepted_tradeoffs: native select. validation: above.

#### T13 · ZIP bundle export (fflate lazy) — **M** — deps: T12

- **Goal:** `src/lib/capture/exportBundle.ts` — lazy-import `fflate`; build ZIP containing `manifest.json` (zod-validated shape extending `src/types/scene.ts` additively: rooms, view groups, per-image sha256/bytes/dimensions, honest `provenance.source: 'operator'`, `sceneKind: 'synthetic-demo'` NOT claimed — staged bundle is *prepared, not reconstructed*), plus the actual image files under `images/<sha>.jpg`; deterministic ordering; browser download via revocable object URL.
- **Files:** `src/lib/capture/exportBundle.ts`, `tests/bundle-integrity.test.ts`, wire-up in `CaptureStudioWorkspace`.
- **AC:** `tests/bundle-integrity.test.ts` builds a bundle from fixture bytes, unzips with fflate in-test, parses `manifest.json` through the zod schema, verifies each entry's sha256 against the actual bytes; UI never uses the word "reconstructed" for the export (grep assertion in test on copy constants).
- **Tests:** `tests/bundle-integrity.test.ts`.
- **Validation:** `npm run test -- tests/bundle-integrity.test.ts`
- **Task Contract:** objective: verifiable honest export artifact. success_criteria: integrity suite green; export labelled "Prepared". non_goals: nav-grid payload (reconstruction not run), server upload. assumptions: sha256 via WebCrypto (node `crypto.subtle` in vitest). open_questions: include nav placeholder? (default no). accepted_tradeoffs: fflate only, lazy. validation: above.

---

### Phase E — Spatial Viewer

#### T14 · Viewer workspace integration — **L** — deps: T8, T9

- **Goal:** `SpatialViewerWorkspace`: mount existing lazy `ViewerCanvas` pattern; **`PlayCanvasViewer.ts` control flow untouched** (D-013 preservation) — only consume its public API (`jumpTo`, `routeTo`, `reset`, `enterWalkthrough`, status callbacks); scene skeleton with real `onStatus` lines (§5.12); scene failure replaces viewport with error panel + rollback offer; `◇ SIMULATED` HUD chip derived from `manifest.sceneKind`; destroy app on tab exit, persist camera pose via T9, restore on re-entry; **single-context invariant**: workspace refuses to init if shell reports another live GL context.
- **Files:** `src/components/viewer/SpatialViewerWorkspace.tsx(+css)`, `src/components/viewer/SceneSkeleton.tsx`, `src/components/viewer/SceneErrorPanel.tsx`, `src/components/ViewerCanvas.tsx` (only if destroy/pose hooks needed — additive), `tests/e2e/viewer.spec.ts` (skeleton→ready, failure path preserved).
- **AC:** switching tabs destroys the app (`document.querySelector('canvas')` count returns to 0); reload restores last scene + pose; existing e2e failure-path specs green; StrictMode double-mount produces exactly one `Application` (idempotent guard — §7.4.5).
- **Tests:** `tests/e2e/viewer.spec.ts` (new + migrated failure paths).
- **Validation:** `npm run test:e2e -- tests/e2e/viewer.spec.ts`
- **Task Contract:** objective: production viewer workspace honoring engine gem. success_criteria: e2e green, zero zombie canvases, pose persistence verified across reload. non_goals: engine internals (T15), search (T16). assumptions: `glb-fixture` is default scene (open_questions notes alternative). open_questions: default scene choice. accepted_tradeoffs: destroy/recreate over keep-alive (D-012). validation: above. ask_abort_triggers: any need to alter `PlayCanvasViewer` control flow — stop, report to lead.

#### T15 · Engine additive API (camera tween + tape reveal) — **M** — deps: T14

- **Goal:** Additive hooks in `src/engine/PlayCanvasViewer.ts`: eased `jumpTo` (700 ms expo settle, pitch levels, **cancellable** — kill on pointer-lock entry or WASD/arrow keydown), route-tape progressive reveal (600 ms inOut, via draw-progress uniform on the triple-layer tape per §6.4: lime 80% depthTest-off alwaysOnTop + ink edges + paper dashes), marker single-pulse select, reduced-motion instant cut + 120 ms crossfade. No control-flow changes to existing methods; `disposed` guards in every tween callback.
- **Files:** `src/engine/PlayCanvasViewer.ts` (additive sections only), `src/lib/navigation.ts` (untouched), `tests/navigation.test.ts` (extend with tape-progress math if extracted pure), `tests/engine-tween.test.ts` (pure tween/cancel math extracted to `src/engine/tween.ts`).
- **AC:** git diff of `PlayCanvasViewer.ts` shows no modified existing lines outside clearly-delimited additive blocks (review criterion); tween cancellation covered by unit tests on the extracted pure module; route values shown in UI come from A* return (`ok`/`detail` verbatim).
- **Tests:** `tests/engine-tween.test.ts`; existing `tests/navigation.test.ts` must stay green unchanged.
- **Validation:** `npm run test -- tests/engine-tween.test.ts tests/navigation.test.ts`
- **Task Contract:** objective: motion-capable engine without risking the gem. success_criteria: additive-only diff, cancellation tests green. non_goals: renderer changes, new controls. assumptions: extracted pure tween helpers. open_questions: none. accepted_tradeoffs: engine-side tweens (not GSAP) for camera/tape per single-owner rule. validation: above.

#### T16 · POI search + destination detail + route strip — **M** — deps: T14, T15

- **Goal:** Right-rail panels per §5.14–5.16: combobox search over `searchPois` (category icon + label + mono subline always showing `CATEGORY · confidence · SOURCE`), keyboard ↑/↓/Enter/Esc/⌘K, destination detail card (approach point kv, `Plot route` / `Jump to view`, unreachable + missing-nav honest states using A* `detail` verbatim), route status strip (`ROUTE · 24 m · 11 cells · A*`, polite live region, clear/re-plot), scene dossier MetadataKV.
- **Files:** `src/components/viewer/PoiSearch.tsx(+css)`, `DestinationDetail.tsx`, `RouteStatus.tsx`, `SceneDossier.tsx`, `tests/poi-search.test.ts`, `tests/e2e/viewer-route.spec.ts`.
- **AC:** search filters fixture POIs deterministically (unit); route from entrance → far room renders strip with measured values; blocked destination shows `▲ No walkable route — destination cell unreachable (blocked)`; Esc deselects and clears 3D selection.
- **Tests:** `tests/poi-search.test.ts` (+ A*-regression additions to `tests/navigation.test.ts` — new cases only), e2e route spec.
- **Validation:** `npm run test -- tests/poi-search.test.ts tests/navigation.test.ts && npm run test:e2e -- tests/e2e/viewer-route.spec.ts`
- **Task Contract:** objective: judge-facing navigation workflow. success_criteria: search/route unit + e2e green; no invented states. non_goals: semantic search, aliases beyond manifest. assumptions: fixture POIs sufficient. open_questions: none. accepted_tradeoffs: native combobox ARIA (no component lib). validation: above.

#### T17 · HUD chips, compass, walkthrough choreography — **M** — deps: T14

- **Goal:** Over-canvas HUD per §6.2 viewer: top-left scene label + `◇ SIMULATED`; top-right compass (mono `N ↑` + SVG rose) + tabular coordinates readout; bottom-left WASD/click/Esc hint chip that auto-hides 4 s after pointer-lock entry and restores on `pointerlockchange` (focus returns to walkthrough button); bottom-right walkthrough + reset buttons. `pointer-events: none` except buttons; halo focus ring; visually-hidden canvas alternative (position + selected POI, polite, throttled 2 s); chrome ≤15% of viewport in default state (measured in e2e via bounding-box sum).
- **Files:** `src/components/viewer/Hud.tsx(+css)`, `CompassRose.tsx`, `usePointerLock.ts`, `tests/e2e/viewer-hud.spec.ts`.
- **AC:** e2e asserts chrome area ≤15%; hint auto-hide timing deterministic (fake timers or direct class assertion post-dispatch); `role="application"` + label present; reduced-motion blocks HUD transitions except the hide fade.
- **Tests:** e2e spec + unit test for `usePointerLock` state mapping.
- **Validation:** `npm run test:e2e -- tests/e2e/viewer-hud.spec.ts`
- **Task Contract:** objective: instrument-grade HUD. success_criteria: 15% area check, pointer-lock restore path, a11y alternative live. non_goals: touch-look (structural only per §6.3). assumptions: `pointerlockchange` listener exists as hook point. open_questions: none. accepted_tradeoffs: backdrop-filter with opaque fallback. validation: above.

---

### Phase F — Live Scan

#### T18 · Pairing protocol library — **M** — deps: T2, T9

- **Goal:** `src/lib/pairing/` — pure, DOM-injected (`RTCPeerConnection`, `WebSocket`, `crypto` injectable): session token generator (`NS-XXXX`), pairing state machine mirroring T9 states, signalling client (`/ws?session=TOKEN`, join → `peer-joined` → SDP offer/answer relay → trickled ICE, one public STUN `stun:stun.l.google.com:19302` added only as fallback when host candidates fail), datachannel `capture` for phone→desktop capture-state + frame messages (typed zod schema `src/types/pairing.ts`, additive), session expiry (10 min countdown source of truth), reconnect/backoff, honest failure taxonomy (`NO_SECURE_CONTEXT`, `SIGNALING_DOWN`, `ICE_FAILED`).
- **Files:** `src/lib/pairing/token.ts`, `src/lib/pairing/machine.ts`, `src/lib/pairing/signalling.ts`, `src/lib/pairing/peer.ts`, `src/types/pairing.ts`, `tests/pairing-protocol.test.ts`.
- **AC:** `tests/pairing-protocol.test.ts` drives **two in-memory peer instances through a mock signalling hub**: full handshake to `CONNECTED`, ICE-failure branch, signalling-drop branch, expiry branch, message framing (capture-state + frame chunk header); zero real network/phone. Illegal transitions rejected.
- **Tests:** `tests/pairing-protocol.test.ts` (the "pairing without a real phone" suite).
- **Validation:** `npm run test -- tests/pairing-protocol.test.ts`
- **Task Contract:** objective: testable pairing core independent of UI/browser. success_criteria: protocol suite green. non_goals: UI, server, camera capture. assumptions: injectable factories; `ws` on server side (T19). open_questions: none. accepted_tradeoffs: STUN as documented fallback only (offline LAN uses host candidates). validation: above.

#### T19 · LAN HTTPS dev server + signalling plugin + honest degradation — **M** — deps: T18

- **Goal:** `vite.config.ts` gains: `vite-plugin-mkcert` and `server.host: '0.0.0.0'` **only when `VITE_LAN=1`** (default config unchanged — Playwright webServer unaffected); `scripts/ws-signalling-plugin.ts` — a Vite plugin on `configureServer` attaching an RFC-6455 relay at `/ws?session=TOKEN` (rooms of exactly 2 peers, message relay verbatim, room close on either leave; if `ws` dep approved use it, else hand-rolled text-frame handler), same origin/port. New script `"dev:lan": "VITE_LAN=1 vite"`. Insecure-context detection in app: `window.isSecureContext === false` → pairing shows `BLOCKED` state with exact remedy copy ("Run `npm run dev:lan` — phone cameras require HTTPS."). mkcert failure → documented fallback `@vitejs/plugin-basic-ssl` (install only if needed) + note in `DECISION_LOG.md`.
- **Files:** `vite.config.ts`, `scripts/ws-signalling-plugin.ts`, `package.json` (`dev:lan`), `tests/signalling-relay.test.ts` (relay room logic pure + node integration with two `ws`/native clients), `DECISION_LOG.md` (D-entry: mkcert smoke result + fallback decision).
- **AC:** default `npm run dev` binds `127.0.0.1` plain HTTP (unchanged); `npm run dev:lan` serves HTTPS on `0.0.0.0` (smoke: `curl -sk https://127.0.0.1:5173/ | grep -q '<div id="root"'`); relay integration test passes two clients through a spawned relay instance; insecure-context UI state unit-tested.
- **Tests:** `tests/signalling-relay.test.ts`; e2e loopback in T24.
- **Validation:** `npm run test -- tests/signalling-relay.test.ts && (VITE smoke documented in DECISION_LOG.md)`
- **Task Contract:** objective: LAN-HTTPS + signalling server with zero regression to default dev/e2e. success_criteria: default binding unchanged; relay tests green; mkcert smoke result recorded. non_goals: production TLS, mDNS. assumptions: mkcert installs local CA (may prompt once — human in loop, see ask_abort_triggers). open_questions: `ws` dep approval. accepted_tradeoffs: dev-time only signalling. validation: above. ask_abort_triggers: mkcert CA prompt refused by environment → switch to basic-ssl fallback, record, continue.

#### T20 · QR pairing card + stage rail — **M** — deps: T6, T18

- **Goal:** Live Scan right rail per §5.17–5.18: QR card (lazy `qrcode-generator`, black modules on pure white, ECC M, ≥160 px, 8 px quiet zone) encoding `https://<lan-ip>:5173/?pair=TOKEN`; `SESSION`/`EXPIRES`(countdown, tabular, warning <60 s + explicit Refresh with 120 ms flash)/`NETWORK` kv + same-LAN caveat verbatim; vertical stage rail (hollow→lime→check→✕ shapes per stage, mono stage names + timestamps); honest states when insecure context (from T19) or WS down.
- **Files:** `src/components/scan/QrPairingCard.tsx(+css)`, `src/components/scan/StageRail.tsx(+css)`, `tests/qr.test.ts` (module contract: encodes pair URL, ECC M, no tinting props), e2e in T24.
- **AC:** QR renders via lazy chunk (no `qrcode-generator` in entry chunk — verify in build output task T25); countdown is **not** an aria-live region (spam prevention) but stage transitions are polite-live; refresh never silent/auto.
- **Tests:** `tests/qr.test.ts`; e2e (T24) asserts black-on-white modules + session label.
- **Validation:** `npm run test -- tests/qr.test.ts`
- **Task Contract:** objective: honest, scan-reliable pairing UI. success_criteria: unit + later e2e green; degradation states reachable. non_goals: QR on desktop-only deployments. assumptions: LAN IP detection via `os.networkInterfaces()`-equivalent client hint or display of hostname — resolve at implementation with honest label. open_questions: LAN IP source. accepted_tradeoffs: no auto-refresh. validation: above.

#### T21 · Camera capture + datachannel handoff — **M** — deps: T19, T20, T11

- **Goal:** Camera preview (16:9, mirrored `<video>`, corner brackets, inset bed), permission-denied/no-device empty-state variants with exact browser remedy copy, capture button → `canvas` frame grab (JPEG, cap long edge 1600 px) → datachannel send with per-frame ack + progress; on desktop: received frames enter the staged-images flow (T11 ingest path reused) labelled `● MEASURED · PHONE` with honest "no pose data" note; `Open in Capture Studio` handoff action. Stage rail driven by real events only.
- **Files:** `src/components/scan/CameraPreview.tsx(+css)`, `src/lib/scan/capture.ts`, `src/lib/pairing/messages.ts` (frame protocol), desktop receive handler in `workspaceStore` wiring, `tests/scan-capture.test.ts` (pure: frame sizing, message framing, ack bookkeeping).
- **AC:** grep confirms no simulated progress numbers; frame cap enforced (unit); acks drive rail STAGED; denial path unit-tested via injected `getUserMedia` mock.
- **Tests:** `tests/scan-capture.test.ts`; e2e in T24 with fake device.
- **Validation:** `npm run test -- tests/scan-capture.test.ts`
- **Task Contract:** objective: real phone-frame path end to end. success_criteria: pure suites green; e2e (T24) shows staged frames with fake device. non_goals: pose estimation, video streaming (frames-on-tap only). assumptions: datachannel chunking unnecessary below ~256 KB/frame cap. open_questions: frame cap resolution (default 1600 px). accepted_tradeoffs: JPEG over raw. validation: above.

#### T22 · three.js coverage visualizer — **M** — deps: T21, T14

- **Goal:** `src/components/scan/CoverageVisualizer.tsx` — own `<canvas>`, lazy-import `three`; floor grid + one frustum per staged frame (real frame poses only — honest: frames without poses render as grid-plane markers labelled "unposed"); `--surface-inset` bed; **dispose on unmount**: geometry/material/scene dispose + `renderer.forceContextLoss()` + `renderer.dispose()`; guarded so it can never co-exist with the PlayCanvas app (shell single-context invariant from T9/T14).
- **Files:** `src/components/scan/CoverageVisualizer.tsx`, `src/lib/scan/scene3d.ts`, `tests/scan-visualizer.test.ts` (pure pose→matrix math, unposed classification).
- **AC:** unmount leaves zero `WebGLRenderer` instances (e2e: remount scan tab 5×, assert canvas count stable and no console WebGL-lost warnings beyond expected); three is a lazy chunk (T25 build check).
- **Tests:** `tests/scan-visualizer.test.ts`; e2e remount loop (T24).
- **Validation:** `npm run test -- tests/scan-visualizer.test.ts`
- **Task Contract:** objective: honest, leak-free 3D staging view. success_criteria: pose math suite green; remount e2e stable. non_goals: interpolation, SLAM, orbit controls beyond basic. assumptions: staged frames without poses occur in V1. open_questions: none. accepted_tradeoffs: minimal three scene, no postprocessing. validation: above.

---

### Phase G — Motion & choreography

#### T23 · GSAP choreography + reduced-motion + lifecycle guards — **L** — deps: T8–T22

- **Goal:** Implement the 12 named moments of §7.3 with GSAP (`useGSAP` scope-revert everywhere, `gsap.matchMedia()` for reduced motion): workspace reveal (Flip underline), room creation FLIP, image→group ghost + chip pulse + count roll, coverage wipe, scene transition (engine crossfade + 900 ms settle camera ease + staggered HUD rise), POI select pulse, camera jump-to (delegates T15 engine tween), route reveal (delegates tape progress), pairing stage advance, processing-stage ticks, toast/modal. Enforce §7.4 guards: entrance timelines once per mount/`listKey`; kill paths on unmount + pointer-lock + user camera input; transform/opacity only (FLIP for reorders); no HUD transitions during pointer lock except auto-hide; StrictMode idempotence; pose persisted before reveal tween.
- **Files:** `src/motion/*` (registry of moment helpers), touches workspace components' mount paths, `tests/motion-reduced.test.ts` (pure gates: `prefersReduced` decision table, kill-path bookkeeping on the extracted controller), e2e reduced-motion spec (T24).
- **AC:** every moment has a working CSS fallback path where GSAP is absent (dev can verify by `npm run build -- --mode test-nogsap`? no — fallback = documented + code path guarded by `M` availability flag; acceptance: reduced-motion demo passes: no translation, no stagger, instant camera cuts, static skeletons).
- **Tests:** `tests/motion-reduced.test.ts` + e2e `emulateMedia({ reducedMotion: 'reduce' })` assertions (T24).
- **Validation:** `npm run test -- tests/motion-reduced.test.ts`
- **Task Contract:** objective: choreography layer with zero lifecycle regressions. success_criteria: reduced-motion unit+e2e green; no re-render entrance replays (manual checklist in VALIDATION.md + listKey unit test). non_goals: new moments beyond §7.3. assumptions: gsap 3.15 Flip/SplitText-free moments (Flip only). open_questions: none. accepted_tradeoffs: fallbacks weaker (no FLIP) — documented. validation: above.

---

### Phase H — Validation, docs, release gate

#### T24 · E2E suites (workflows, persistence, camera, WebRTC loopback) — **L** — deps: T8–T23

- **Goal:** New Playwright specs in `tests/e2e/`:
  1. `workflow.spec.ts` — three-tab journey: create room + stage images (generated fixture files) → switch to viewer → search POI → plot route → switch to scan → back to studio → **reload page** → rooms/view-groups/images/pose restored from IDB.
  2. `capture-export.spec.ts` — upload → assign to view group → coverage shape change → Export bundle → intercept download → verify ZIP magic `PK\x03\x04`, size > 0, filename honest.
  3. `viewer-route.spec.ts` (from T16) + `viewer.spec.ts` (from T14, includes preserved failure paths).
  4. `camera.spec.ts` — `test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } })` + `context.grantPermissions(['camera'])`: LIVE → CAPTURING → STAGED rail advancement; permission-denied variant via `clearPermissions`.
  5. `webrtc-loopback.spec.ts` — two pages in one context (desktop + "phone"), both join the same session over the dev-server WS signalling; assert `RTCPeerConnection.connectionState === 'connected'` within 10 s and a capture-state message crosses the datachannel. One retry allowed; if still failing, fail loudly (no silent skip).
  6. `motion-reduced.spec.ts` — `emulateMedia({ reducedMotion: 'reduce' })`: tab switch produces no `transform` deltas; skeleton is static.
  7. Leak check: scan-tab remount ×5 stable canvas count (from T22).
- **Files:** the above spec files, minor `playwright.config.ts` additions (per-spec `test.use` only — global config stays green).
- **AC:** full `npm run test:e2e` green including the 6 pre-existing specs; wall time recorded; any spec skipped requires a written reason in `VALIDATION.md` (none expected).
- **Tests:** this task *is* the test work.
- **Validation:** `npm run test:e2e`
- **Task Contract:** objective: deterministic proof of every master dimension. success_criteria: full e2e green, no silent skips. non_goals: cross-device physical testing (loopback substitutes; real-phone smoke is manual pre-demo). assumptions: fake camera device available in installed chromium. open_questions: none. accepted_tradeoffs: loopback instead of real phone in CI. validation: above. ask_abort_triggers: loopback flake >2 retries → keep unit protocol suite as gate, mark loopback manual in VALIDATION.md with reason (documented exception, lead-approved).

#### T25 · Scene scripts, quality gate, build budgets — **M** — deps: T13, T24

- **Goal:** `npm run validate:scenes` green on both fixtures; `scripts/quality_gate.py` extended (additive taxonomy) to include the new vitest suites automatically and to fail on: legacy token grep hits, `%`-style coverage strings in `src/`, un-revoked object-URL patterns (heuristic), missing `SIMULATED` chip derivation. `npm run build` + `npm run benchmark:build`: initial entry chunk ≤ 360 KB gzip; assert `three`, `gsap`, `fflate`, `qrcode-generator`, `idb`, `playcanvas` each appear in separate lazy chunks (parse `dist/assets` manifest); budgets written into `benchmark/build-report.json` expectations and `VALIDATION.md`.
- **Files:** `scripts/quality_gate.py`, `benchmark/` (report regen), `VALIDATION.md` (budget table), possibly `scripts/check_chunks.py` (new deterministic chunk-attribution check).
- **AC:** `npm run quality && npm run validate:scenes && npm run build && npm run benchmark:build` all exit 0; chunk check proves laziness.
- **Tests:** the scripts themselves + `npm run test` regression.
- **Validation:** command chain above.
- **Task Contract:** objective: engineering-dimension gate with hard budgets. success_criteria: chain green; budgets recorded. non_goals: perf profiling beyond size. assumptions: gzip measurement via existing benchmark script (adapt if it reports raw). open_questions: none. accepted_tradeoffs: heuristic lint rules in quality gate. validation: above.

#### T26 · Docs correction & recording — **M** — deps: T19, T25

- **Goal:** Fix staleness: `README.md` ("Python 3.10+" → "Python 3.13+ (tested 3.14.6)"), `VALIDATION.md` (claims 3.9.6 → correct; add new suites/e2e inventory, budgets, mkcert smoke result, any documented exceptions), `ARCHITECTURE.md` (shell + state + pairing + storage architecture), `DECISION_LOG.md` (D-entries: palette MERIDIAN final, mkcert vs basic-ssl, `ws` dep, default scene, frame caps), `PIPELINE.md` (honest staged-not-reconstructed export), new `docs/PAIRING.md` (runbook: `npm run dev:lan`, same-LAN requirement, offline behavior). Update the e2e selector-mapping table (from T8) into `VALIDATION.md`.
- **Files:** the above.
- **AC:** grep no longer finds `3.9.6` as the supported version or "Python 3.10+" claims; every doc names the honest blocked reconstruction state; runbook is executable top-to-bottom.
- **Tests:** none (docs), verified by `npm run quality` (if gate checks) + review checklist.
- **Validation:** `grep -rn "3.9.6\|3.10+" README.md VALIDATION.md | wc -l` → 0 for stale claims.
- **Task Contract:** objective: docs match reality. success_criteria: greps clean, runbook tested once manually. non_goals: marketing copy. assumptions: none. open_questions: none. accepted_tradeoffs: none. validation: above.

#### T27 · Final release gate — **S** — deps: all

- **Goal:** Run and record the full gate in `VALIDATION.md` (fresh section, timestamped): `npm run typecheck && npm run lint && npm run test && npm run test:e2e && npm run validate:scenes && npm run build && npm run benchmark:build && npm run quality`; plus manual checklist: reduced-motion demo, grayscale-status check, HUD-over-black/white-scene contrast spot check, real-phone pairing smoke (manual, pre-demo), offline (Wi-Fi off) sanity.
- **Files:** `VALIDATION.md`.
- **AC:** every command exits 0; checklist has explicit pass/fail entries; failures block "done".
- **Tests:** gate itself.
- **Validation:** the command chain, once, end to end.
- **Task Contract:** objective: release evidence. success_criteria: all-green record. non_goals: fixing failures (loop back to owning task). assumptions: none. open_questions: none. accepted_tradeoffs: manual checklist items are human-run. validation: above. ask_abort_triggers: any gate failure → return to owning task, do not paper over.

---

## 5. Validation plan (aggregate)

| Gate | Command | Expectation |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit (existing) | `npm run test` | 17/17 from T3 onward, growing to **all** suites below |
| Unit (new) | `npm run test -- tests/<suite>` | `tokens`, `icons`, `ui-primitives`, `coverage`, `state-machine`, `rooms-viewgroups`, `storage`, `capture-ingest`, `bundle-integrity`, `engine-tween`, `poi-search`, `pairing-protocol`, `signalling-relay`, `qr`, `scan-capture`, `scan-visualizer`, `motion-reduced` — all green |
| E2E (existing 6) | `npm run test:e2e` | green (selectors updated, failure paths preserved 1:1, mapping table in VALIDATION.md) |
| E2E (new) | `npm run test:e2e` | `workflow` (3-tab + reload persistence), `capture-export` (upload→group→ZIP), `viewer-route`, `camera` (`--use-fake-device-for-media-stream`), `webrtc-loopback` (two-page, no phone), `motion-reduced` |
| Scenes | `npm run validate:scenes` | both fixtures valid |
| Build | `npm run build` | exit 0; entry ≤ 360 KB gzip; heavy deps in lazy chunks |
| Benchmark | `npm run benchmark:build` | report regenerated, budgets met |
| Quality | `npm run quality` | taxonomy green incl. new heuristic rules |
| Python | `python3 scripts/prepare_capture.py` (via pipeline tests) | runs on 3.14.6, no `imghdr` |
| LAN smoke (manual) | `npm run dev:lan` + `curl -k` | HTTPS up; result recorded (fallback if mkcert fails) |
| Real-phone smoke (manual, pre-demo) | scan QR from phone on same LAN | pairing connects; recorded in VALIDATION.md |

---

## 6. Forecast

- `estimated_scope`: **large** (>400 LOC; realistically ~4–6k LOC incl. CSS, tests, scripts).
- `affected_files`: ~55 — new: `src/styles/*`, `src/components/{icons,ui,shell,capture,viewer,scan}/*`, `src/state/*`, `src/lib/{storage,capture,pairing,scan}/*`, `src/engine/tween.ts`, `src/motion/*`, `scripts/ws-signalling-plugin.ts`, `tests/*` (17 unit suites + 7 e2e specs), `public/fonts/*`, `docs/PAIRING.md`; modified: `App.tsx`, `main.tsx`, `index.html`, `vite.config.ts`, `package.json`, `PlayCanvasViewer.ts` (additive), `StatusPill.tsx` (replaced), `scripts/{prepare_capture,quality_gate}.py`, docs (`README`, `VALIDATION`, `ARCHITECTURE`, `PIPELINE`, `DECISION_LOG`), `tests/e2e/app.spec.ts`.
- `suggested_phases`: A–H as written; if the 7-day window compresses, priority = A→B→C→D→E (Capture + Viewer are the judge path), then F, with G moments falling back to documented CSS fallbacks; H never compresses.

---

## 7. Risks (owner in brackets)

1. **mkcert CA install fails / prompts blocked** [developer → lead]: fallback `@vitejs/plugin-basic-ssl`; pairing degrades to honest BLOCKED state either way (T19 handles both).
2. **Two live WebGL contexts** [developer]: shell single-context invariant (T9/T14/T22) + remount e2e; never mount scan visualizer and PlayCanvas simultaneously.
3. **Object-URL / IDB leaks under demo repetition** [developer]: registry helper, revoke rules, remount e2e (T24 leak check).
4. **WebRTC loopback e2e flake** [developer]: one retry; documented exception to lead if >2 flakes (T24 ask_abort_triggers).
5. **HEIC/large-image memory on 8 GB machine** [developer]: `createImageBitmap` resize caps, per-file error isolation, raw-size guard (T11).
6. **`ws` and `@types/three` beyond researched list** [lead at T2]: both low-risk; fallbacks specified.
7. **StrictMode double-mount vs PlayCanvas entrance tweens** [developer]: idempotent guard required in T14 before any tween work (T23 builds on it).
8. **Pointer-lock vs camera tween fights** [developer]: single-owner rule + kill paths (T15/T17/T23).
9. **Deadline (31 Oct) vs full slice** [lead]: phase compression order in §6; motion fallbacks and honest degraded pairing states mean nothing blocks the demo path.
10. **Offline finale** [developer]: self-hosted fonts, host-candidate-only pairing, no runtime asset fetches (standards §3.6).

## 8. Open questions (owner; defaults chosen so work never blocks)

1. **Approve `ws@^8` dev-time dependency?** [lead] — default **yes**; fallback hand-rolled RFC-6455 handler already scoped in T19.
2. **Default demo scene: `glb-fixture` (13.5 KB GLB) vs `fixture`?** [lead] — default **glb-fixture** as primary in the project `<select>`, both listed.
3. **ZIP bundle contents: images+manifest only, or also nav placeholder?** [lead] — default **images+manifest only** (honest: no reconstruction ran).
4. **Phone capture frame cap** [developer] — default **1600 px long edge, JPEG q0.9**.
5. **QR `NETWORK` field source** (LAN IP discovery client-side) [developer] — default: show `location.hostname` and the caveat line; exact LAN IP only if discoverable without new deps.

---

## Result Contract

- `status`: pass
- `summary`: Complete V1 implementation spec delivered: 27 ordered tasks across phases A–H with per-task contracts, acceptance criteria, tests, and validation commands; cross-cutting standards, aggregate validation plan, forecast, risks, and open questions with defaults.
- `artifacts`: `docs/V1_SPEC.md`
- `next_recommended`: `developer` executes T1→T27 in order (T1 baseline commit first); lead resolves open_questions 1–3 (defaults already unblock work).
- `risks`: see §7 — highest-leverage: T14 engine-preservation discipline and T19 secure-context degradation honesty.
- `skill_resolution`: selected skills `scope-control`, `testing-strategy`, `writing-plans` were unavailable (permission denied at load); fallback = this prompt's mandated structure followed exactly. All other skills omitted by design.

**Markers:** `implementation_decisions_count: 24` · `testing_decisions_count: 24` · `slices_defined: 27`
