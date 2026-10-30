# EVENT LOG — Round 1 Rescue Sprint (append-only)

## 2026-10-29 02:09 IST — Sprint start
- Action: fresh `git fetch origin --prune`; inspected refs, worktrees, .gitignore, capture media, tools.
- Findings: `origin/ujesha/round1-fixes` advanced `8fcd7ef → 70132ba` (new commit: PROJECT_STATE.md audit handoff + docs index, 10-29). Dirty file: `benchmark/build-report.json` (audit byproduct — preserved). No capture media (jpg/jpeg/heic/mp4/mov/ply) anywhere in repo. colmap absent (not brew-installed), ffmpeg+python3+brew present. A foreign worktree exists at ~/.local/share/kilo/worktree-pool/... (d9f521e) — left untouched.
- Next: baseline candidate comparison.

## 2026-10-29 02:15–02:22 IST — Baseline verified and rescue branch created
- Evidence: origin/main worktree (744f7c3): typecheck 0, lint 0/5w, vitest 395/395 (2.15s). origin/ujesha/round1-fixes worktree (70132ba, apps/studio): typecheck 0, lint 0/5w, vitest 396/396 (1.53s). Ancestry: 86b7a66 ⊂ 744f7c3 ⊂ 70132ba (strict).
- Action: created rescue/round1-2026-10-29 @ 70132ba in worktree ns-rescue. Copied dirty benchmark/build-report.json to logs/round1-rescue/artifacts/ (sha256-verified).
- User directive: commits/pushes go to ashwinwork branch at phase boundaries (fast-forward; D-002).
- User delivered 70 real room photos to work/captures/room/ (WhatsApp JPEG 740x1600/738x1600 portrait, no EXIF rotation). NOTE: same shoot characteristics as the 29-Oct failed capture set documented in PROJECT_STATE.md (2/73 registered). Feasibility run planned with mitigations.
- Next: dispatch Workstream C (ZIP seam) + D1 (navigation) subagents; begin Workstream B feasibility (brew install colmap).

## 2026-10-29 02:30 IST — Strategy pivot + parallel dispatch
- Pivot: external worktree paths became inaccessible to the harness (permission: external_directory). Since the user directed all commits to land on ashwinwork, abandoned the ns-rescue worktree and instead: committed phase-0 logs (1e722a1 after rebase onto 70132ba; .gitignore conflict resolved as union) — ashwinwork now = rescue baseline + sprint logs, clean tree, fast-forward-compatible with origin/ashwinwork. Stash@{0} preserves the audit-generated build-report.json; identical copy in logs/round1-rescue/artifacts/.
- Dispatched background subagents: (1) developer — Workstream C ZIP→prepare_capture.py seam (owns apps/studio/src/lib/capture/**, scripts/prepare_capture.py, their tests); (2) developer — Workstream D1 A* octile/admissible heuristic (owns apps/studio/src/lib/navigation.ts + tests). No-git rule enforced; lead commits.
- User added SUPPLEMENTAL workstream (product intelligence/competitive research) with strict boundary: private output outside repo. Dispatched background researcher → /Users/flamexmystix/Documents/Sidequests/hackathons/nammaspace-planning/PRODUCT_INTELLIGENCE.md. Must not block sprint.
- Workstream B: normalized all 70 capture JPEGs to uniform 740x1600 in work/captures/room_norm/ (mitigates the documented single_camera mixed-size silent drop). brew install colmap running in background.
- Note: Python here is 3.14.6 (docs claim 3.9.6) — record in T26 doc correction later.

## 2026-10-29 03:00–03:15 IST — Phase 1 pushed; pipeline first run failed; camera-model investigation
- Phase 1 PUSHED to origin ashwinwork: 86b7a66..6a7654a (D1 nav fix 6df7d8c + C ZIP seam 6a7654a). Dry-run before push per D-002.
- Flags/env-test fix committed 7f4f060: Sift*→Feature*.use_gpu (verified vs colmap 4.2.1 help; old flags empirically rejected), hermetic PATH in preflight test. Suite 424/424, typecheck 0 (lead re-ran).
- B: environment fully prepared: brush_app v0.3.0 aarch64 (sha256 65b26313...8c verified), .venv (opencv 5.0.0, numpy 2.5.4), splat-transform@3.10.3, doctor all-OK except nvidia (use --cpu).
- B: FULL PIPELINE RUN #1 on room_norm FAILED at SfM gate honestly: 2/70 (3%) registered, 229 points, reprojection 0.37px; exit 1; report.json status failed. Gates: >=60% registration, >=2000 points.
- ROOT-CAUSE INVESTIGATION: identical inputs (70 imgs, 2415 matched pairs) behave oppositely:
  - manual db (default SIMPLE_RADIAL): 59/70 first run; rerun 3/26/50 (best 50/70) — nondeterministic but consistently large model
  - pipeline db (forced --ImageReader.camera_model OPENCV): 2/70, single model — SAME "2 frames, 3%" signature as the team's 29-Oct real-photo failure (2/73)
  - camera rows confirmed via sqlite: model 2 (SIMPLE_RADIAL) vs model 4 (OPENCV)
- Isolation test launched: OPENCV without use_gpu flag, fresh db → separates camera_model from the gpu flag (background, log work/captures/opencv_test.log).
- If OPENCV confirmed: fix = pipeline camera model default (dispatch to developer), rerun with --force.
- Dispatched: D2+D3 scene-contract agent + T21 Live Scan agent (disjoint ownership; both no-git).

## 2026-10-29 03:12 IST — Isolation result: OPENCV camera model confirmed causal
- Isolation run (OPENCV, no use_gpu flag, fresh db): models 2/20/19 images — best 20/70 (29%), gate-failing. Combined evidence:
  - SIMPLE_RADIAL: 59/70 then 50/70 (gate-passing, consistently one large model)
  - OPENCV: 2/70 (pipeline run), 20/70 (isolation) — fragments, always <60%
  - use_gpu flag exonerated (isolation omitted it; same bad result)
  - Matches team's 2/73 real-photo failure signature exactly → their "unusable capture" verdict was at least partly a pipeline bug.
- Dispatched camera-model fix agent: pipeline/run_pipeline.py (+ root tests/docs references), SIMPLE_RADIAL explicit, gates untouched, no apps/studio edits.
- Next: after fix commits → rerun pipeline --force (sfm ~5 min + train ~20-40 min on Metal). Known risk: sparse points 1658 < 2000 gate on first manual model — if the rerun still fails the points gate, that is an HONEST capture-quality blocker (no threshold weakening), to be recorded in BLOCKERS.md with exact numbers.

## 2026-10-29 03:43 IST — Pipeline run #2 (SIMPLE_RADIAL): near-miss 57%, camera-model fix validated
- Run #2 with a4299f5 fix: registration 2/70 (3%) -> 40/70 (57%) in model 0 + disconnected 17-img model 1 (WARN: room split). Points 229 -> 2857 (PASS >=2000), reprojection 0.92px (PASS <=1.5). Gate fail = registration 57% < 60% (needs 42 imgs). Exit 1, no training. report.json honest fail.
- Camera-model fix PROVEN as the dominant defect: 3% -> 57% on identical capture. Remaining gap (57 vs 60) + split = capture overlap weakness + mapper nondeterminism (same db class gave 59/70 and 50/70 in two earlier manual runs; pipeline attempt landed 40).
- Decision: ONE documented full rerun (nondeterministic mapper; no threshold changes, no manual stage bypass to keep report.json/reproducibility intact). If <60% again -> B record as BLOCKED with split-room evidence + re-shoot ask per pipeline's own WARN text. Both attempts logged regardless of outcome.

## 2026-10-29 03:46 IST — Run #3 confirms split; BLK-001 recorded; bounded subset run launched
- Run #3: 40/70 (57%) + 17-img fragment — identical topology to run #2 -> capture split is deterministic, not mapper luck. BLK-001 recorded in BLOCKERS.md (full evidence, impact, continuation).
- Mitigation (disclosed, gates unchanged): pipeline run on the 40-image connected component (work/captures/room_subset40 -> room_subset_run) in background. This is a genuine sub-capture input, not a gate bypass.
- D2+D3 committed d4acf04 (11 files, 526/526 tests, validator 2/2, e2e 28/28 verified by lead).

## 2026-10-29 03:49 IST — Subset run verdict: capture-quality blocker confirmed
- Subset (40-img component): 29/40 registered (72% PASS), 0.96px PASS, but 886 sparse points < 2000 gate FAIL -> no training. BLK-001 amended with this evidence.
- Workstream B conclusion for this sprint: pipeline is fixed and honest (3% -> 57% connected / 72% subset); the remaining gap is capture quality (resolution/texture/overlap). Re-shoot per SOP is the continuation path; RTX 5060 host remains the dense/splat path.

## 2026-10-29 03:52 IST — T25 + T26 dispatched (parallel, disjoint ownership)
- T25 agent: quality_gate.py additive extension, build budgets (entry <=360KB gzip, lazy-chunk assertions for three/gsap/fflate/qrcode-generator/idb/playcanvas), benchmark/build-report.json + VALIDATION.md budget table. Owns scripts/quality_gate.py, benchmark/**, VALIDATION.md budgets, root tests/. Mandated: report over-budget reality, never silently raise budgets.
- T26 agent: docs correction (README/VALIDATION/ARCHITECTURE/DECISION_LOG/PIPELINE + new PAIRING.md runbook). Fed today's verified facts: Python 3.14.6, D2+D3 new contract (ARCHITECTURE/PROJECT_STATE stale), sog declared-but-unrendered, SIMPLE_RADIAL fix. Mandated: every doc claim verified/sourced/labeled; no private vision content.
- Queued behind T21 agent (owns pairing/scan/workspace): T22 (coverage visualizer, dep T21+T14), T23 (GSAP choreography), T24 (e2e extensions), then T27 (final release gate over everything).
- Workstream B closed with BLK-001 + amendment (commits 969543c and earlier). Phase 2 pushed through a0359fe; further pushes at next green boundary.

## 2026-10-29 04:00 IST — T25 committed (1f3ddfa); full quality gate green
- T25 lead-verified: npm run quality ALL 6 STEPS PASS (scene validation, production build, build benchmark, bundle chunk budgets, reconstruction preflight, browser E2E), vitest 542/542, typecheck 0. Committed 1f3ddfa.
- Key measurements: entry chunk 129,838B gzip vs 360KB budget (PASS, 238KB headroom); fflate/qrcode/idb/playcanvas proven in separate lazy chunks. three+gsap = honest EXCEPTION (not yet imported anywhere; laziness vacuous until T22/T23; check auto-enforces later).
- Lint fix: unused mkdirSync import in prepare-capture-zip.test.ts (owned by C session) - one-line fix routed back to owner session, 14/14 tests intact, lint now 0.
- In flight: T21 (pairing/scan WIP visible in tree), T26 (docs WIP visible: README/ARCHITECTURE/DECISION_LOG/PIPELINE/PROJECT_STATE modified).

## 2026-10-29 04:28 IST — T26 committed (b469fa8)
- Docs correction complete: README honest status+requirements, VALIDATION rewritten w/ EX-1..6, ARCHITECTURE matches actual schema + new contract bullets, DECISION_LOG D-014..D-019, PIPELINE staged-export honesty, new docs/PAIRING.md runbook, PROJECT_STATE 6 amendments.
- Agent-reported contradictions (lead-reviewed, not silently fixed): WINDOWS_SETUP.md still documents removed Sift* flags + Python 3.10+; TRAINING.md stale "no reconstruction"/"nothing committed" lines; CAPTURE_SOP.md vs SOP.md disagreement; spec premise wrong re README claiming 3.10+; python3 now resolves 3.15.2 (Homebrew symlink update 02:45 IST - note: pipeline runs use .venv which is unaffected).
- Remaining: T21 agent (in-flight: its untracked receive.ts currently breaks tsc - agent will fix before handoff); then T22/T23/T24, then T27 final gate.

## 2026-10-29 04:35 IST — T21 committed (a56eaa1)
- Live Scan journey wired end-to-end: ?pair= receiver entry, signalling lifecycle, WebRTC chunked transfer w/ SHA-256 acks (nack+retry+timeout honesty), receive->T11 ingest as source:'phone', event-driven stage rail, capture handoff.
- ORIENTATION BUG FIXED with genuine red evidence: grabFrame mirrored reconstruction-bound frames (col0=10 expected vs 207 observed); saved frames now unmirrored, preview mirror opt-in. Frame cap 1600px unit-enforced.
- Lead verification: vitest 558/558, typecheck 0, lint 0 errors (6 known-class react-refresh warnings), build ok (QR lazy 21KB). AC grep: zero simulated progress.
- NOT claimed: device-to-device. T24 scope: mounted-effect e2e, ?pair click-through, real-hardware smoke.
- Dispatching T22 (coverage visualizer, dep T21 done + T14). T23 (GSAP) queues behind T22 per spec deps.

## 2026-10-29 04:55 IST — T22 committed (74a112b); gate catches real leak, fixed same cycle
- T22: CoverageVisualizer (lazy three chunk, honest unposed-frame markers, context-guard refusal, disposal proven in node: 5 remounts -> 0 live). Browser-level AC = T24 (no WebGL in node, documented PARTIAL).
- QUALITY GATE PAYOFF: T25's R3 heuristic found a TRUE POSITIVE - LiveScanWorkspace minted object URLs never revoked (spec 7.3 leak under demo repetition). Owner session fixed at source (no-mint staging, Capture Studio owns display URLs; red test captured actual leaked blob:nodedata URL). T25's strict xfail promoted to green guard (65/65 pytest).
- three laziness: dead marker threejs.org (0 hits everywhere) replaced with AND of REVISION+SRGBColorSpace (per-chunk counts verified); check now prints marker evidence. gsap = honest vacuous exception until T23.
- Lead verified: vitest 591/591, typecheck 0, lint 0 err, build ok, check_chunks PASS, quality gate 10/10 GATE_EXIT=0 (incl. e2e 28), pytest 65/65.
- Dispatching T23 (GSAP choreography + reduced-motion gates, spec-dep T22 now done).

## 2026-10-29 06:05 IST — usage-limit recovery; F committed; T23+T24 re-dispatched
- Both F and T23 agents died at startup on free-usage limit. F had completed its files before dying: SUBMISSION_ROUND1/CAPTURE_DAY/ABSTRACT (adapted from stranded c305a36) + HANDOFF append + contradiction report. Lead verified docs (no fabrication; only honest denials matched risky-claim grep), corrected stale entry-chunk figure (129,838 -> 139,693 B gzip post-T22), committed 44d72cb.
- Lead inline (deviation noted - no subagent capacity): resolved all 4 F-routed contradictions in README:73 (dropped unverifiable synthetic end-to-end claim; 'footage'->'70-photo set') and DEMO_SCRIPT.md (not-recordable banner + honest options) -> 7e224af. These were doc-honesty corrections, not feature work.
- Capacity returned: re-dispatched T23 as BOUNDED slice (pure motion registry consolidating 3 duplicate duration gates + kill-path controller + tests; NO gsap import to game chunk check; 12 visual moments documented as e2e-dependent remainder) and T24 (e2e: loopback/camera/motion-reduced/remount-leak/export/workflow; no-silent-skip rule; 2x-deterministic requirement).
- After T23+T24: T27 final release gate (record in VALIDATION.md) + G closure (HANDOFF finalization, final push). Sprint at ~4h of 12h.

## 2026-10-29 06:4x IST — T23 motion-core slice complete (agent); review dispatched
- T23 agent report: src/motion/index.ts registry (resolveMotionPrefersReduced, momentDuration as the ONE duration gate, createMotionController kill-path bookkeeping, at-most-once kill per track). Delegations: engine/tween.ts resolveTweenDuration + lib/scan/scene3d.ts resolveVisualizerDuration now call momentDuration (signatures unchanged); PlayCanvasViewer private prefersReducedMotion() routes through resolveMotionPrefersReduced (same matchMedia chain). RED evidence: first run failed on test syntax before module existed; GREEN: motion-reduced.test.ts 61 tests.
- Lead-run verification (spot, agent outputs consistent): full vitest 652/652 (33 files, was 591), quality_gate 10/10 GATE_EXIT=0 (advisory line gone), check_chunks PASS with gsap still vacuous (no fake import - confirmed honest).
- 12 visual §7.3 moments NOT implemented (documented in src/motion/index.ts header): need lazy import('gsap') + component wiring + browser verification (T24 territory). Remaining T23 = choreography sweep, explicitly deferred.
- build-report.json diff = gate byproduct (timestamps/hashes), committed at boundary as before.
- Reviewer dispatched on T23 diff (background) while T24 (e2e) still runs. Next: T24 + review results -> commit T23 -> T27 final release gate -> G closure.

## 2026-10-29 07:2x IST — T24 e2e suites complete; two real defects surfaced
- T24 agent: 5 new specs + 7 new tests, GREEN 2x consecutive + 3rd pass inside gate. e2e total 35/35 (was 28), walls 1:26.8 / 1:38.1. Gate 10/10 GATE_EXIT=0. eslint clean on tests/e2e.
  - workflow: 3-tab journey + reload IDB restore (room/group/thumbnail/camera pose). capture-export: ZIP magic PK\x03\x04, size>0, honest filename via download intercept. camera: fake-device flags + channel:'chromium' (headless-shell NotSupportedError proven w/ probe), LIVE->CAPTURING->STAGED via MutationObserver, denied variant exact remedy copy. webrtc-loopback: real RTCPeerConnection connected <=10s, capture-state crosses datachannel, retry-then-loud-fail. motion-reduced: static skeleton + in-page 16ms zero-transform-delta probe across tab switches.
  - channel:'chromium' rationale + wire-ups documented in VALIDATION.md (+29 lines).
- T24 deliberately withheld scan-leak spec (EX-1) instead of skipping: found a REAL bug - StrictMode double-mount + lazy import('three') race in CoverageVisualizer: pass-1 cancelled branch forceContextLoss()es the shared canvas before pass-2 renderer ctor -> getContext null -> three throws -> canvas never mounts (100% repro on dev; prod single-pass OK).
- T24 also flagged EX-2: state/hydrate replaces store wholesale -> returning phone hydrates pairing:IDLE over its live session -> rail stuck IDLE, capture locked.
- Dispatched in parallel: reviewer on T24 diff; developer on EX-2 hydrate clobber (pure mergePairingOnHydrate + wiring, vitest-only validation, no e2e/gate to avoid port contention with the e2e lane). EX-1 CoverageVisualizer fix queued NEXT (needs exclusive e2e lane) + scan-leak spec re-add from T24's preserved body.
- Then T27 final release gate (full battery into VALIDATION.md), then G closure.

## 2026-10-29 07:5x IST — EX-2 hydrate clobber fixed (agent); review dispatched
- Root cause (agent): reducer.ts:365-366 'state/hydrate' returned action.state WHOLESALE. Hydration is async (persistence.load resolves after mount); toPersistedSnapshot always persists pairing:IDLE -> returning phone's stale IDB snapshot clobbered its in-flight PAIRING/LIVE session; later rail-sync transitions were illegal hops out of IDLE, rejected silently -> rail stuck IDLE, capture locked.
- Fix: pure mergePairingOnHydrate(live, restored) in reducer. NO-CLOBBER: live in-flight {PAIRING,LIVE,CAPTURING,STAGED} beats restored IDLE; restored wins only if itself in-flight with strictly newer updatedAt (ties->live). NO-ZOMBIE: live dead {IDLE,OFFLINE,ERROR} -> restored wins untouched. Bridge-resync alternative rejected (would mask the store lie).
- Evidence: tests/pairing-hydrate.test.ts 15 tests, RED 13 failed -> GREEN 15/15; full vitest 667/667 (652+15, concurrent-lane count note); tsc 0; lint 6 known warnings. e2e/gate NOT run by fixer (port owned by EX-1 lane) - lead to run at T27.
- DISCREPANCY raised: fixer reports the pairing-clobber text is at VALIDATION.md ~L171 while the literal 'EX-2' label at ~L99 is a different exception - reviewer asked to adjudicate + whether a label correction needs routing.
- Reviewer dispatched on the reducer diff (2 files) while EX-1 (CoverageVisualizer per-mount canvas + scan-leak spec) still runs.
- Fixer's follow-up risks for e2e lane: return-phone loopback re-check without clearWorkspaceSnapshot helper (now redundant but harmless); bridge shadow seam look; vitest count re-baseline at merge.

## 2026-10-29 08:1x IST — EX-2 review clean; committed 9d7f33f
- Reviewer adjudication: the fix addresses EXACTLY the bug T24 reported (pairing-clobber text at VALIDATION.md ~L171, T24 written exception #2). The literal 'EX-2' label at ~L99 is the unrelated GPU-preflight exception - mislabel confirmed, comment-only (two references in pairing-hydrate.test.ts). Route: when VALIDATION.md next touched, give the pairing race its own number (e.g. EX-7 FIXED) + fix the two test comments, or drop 'EX-2' from comments.
- Matrix walk: every reachable cell closed; uncovered cells (restored OFFLINE/ERROR, NaN updatedAt) unreachable by construction (toPersistedSnapshot only writes IDLE; updatedAt stamped at all 3 mutation sites; NaN->live = safe direction). Restored-in-flight-newer branch inert against current persistence = defensive forward-compat contract, appropriately pinned. No-zombie confirmed; bridge-shadow divergence window NARROWED not widened; non-pairing slices byte-identical.
- Reviewer-rerun evidence: vitest 667/667, tsc 0, lint 0 err/6 warn. Committed 9d7f33f (reducer.ts +40/-1 + tests/pairing-hydrate.test.ts).
- Follow-ups queued for T27/EX-1 lane: (1) return-phone loopback re-run WITHOUT clearWorkspaceSnapshot helper to prove store-level fix suffices (acceptance step, not correctness risk); (2) VALIDATION.md numbering correction; (3) stale lint-warning count in VALIDATION.md EX-1 ('5' -> 6).

## 2026-10-29 08:3x IST — EX-1 visualizer fix complete (agent); review dispatched
- Root cause confirmed with runtime probe on RED tree: shared JSX canvasRef across StrictMode double-invoke; pass-1 lazy-import continuation ran forceContextLoss() on the SHARED canvas -> pass-2 getContext null -> THREE 'Cannot read properties of null (reading precision)' -> conflict alert, canvases=0 after 1 remount.
- Fix: per-mount canvas ownership - canvas created imperatively inside the effect, appended synchronously, owned by that invocation; cleanup + cancelled branch (via already-unit-tested disposeRenderer) touch only that pass's canvas; .catch hardened to not report cancelled-pass failure as conflict. Accepted tradeoff: dev StrictMode throwaway context per mount, disposed immediately (documented in header). scene3d.ts byte-identical; T22 5-remount->0-live unit guard kept green (not made vacuous).
- scan-leak.spec.ts written fresh to contract: real loopback pairing -> 1 verified frame over datachannel -> 5x remount loop; canvas exactly 1 after each remount, 0 while away, no false conflict alert, console/pageerror trap (zero precision/null throws, zero CONTEXT_LOST_WEBGL, zero page errors). RED pre-fix (canvas count unstable after remount 1) -> GREEN post-fix (1 passed 2.7s, teardown markers []).
- Evidence: vitest 667/667, tsc 0, lint 0 err/6 warn, test:e2e x2 = 36/36 (56.8s each), quality_gate 10/10 GATE_EXIT=0 (incl. 36/36 inside gate). EX-1 flipped to RESOLVED in VALIDATION.md with RED/GREEN evidence.
- zz-probe.tmp.spec.ts scratch: already removed by the agent before completion (verified absent); nothing discarded by lead.
- Reviewer dispatched on the 4-file diff (CoverageVisualizer.tsx, scan-leak.spec.ts, VALIDATION.md, build-report.json churn-check).

## 2026-10-29 08:5x IST — EX-1 review clean; committed+pushed db8d7ca; T27 dispatched
- Reviewer verdict clean on EX-1: per-invocation canvas ownership airtight across all StrictMode/unmount orderings (removal precedes next append, synchronous); shared-state audit passed (containerRef mount-only, ownRegistry per-instance, webglContextGuard released synchronously by non-cancelled pass, cached three chunk safe because each pass builds on its own canvas); disposal paths mutually exclusive, no double-dispose; .catch suppression REQUIRES cancelled===true so live-pass conflicts still raise (both branches walked). scene3d.ts empty diff; T22 5-remount unit guard untouched and not vacuous (registry-level, sibling tests cover both new disposal routes). Console trap scoped (anchored regex, deliberate marker exempted), no sleeps, reviewer re-ran: vitest 667/667, tsc 0, eslint 0/6, playwright 36/36 (53.7s) + scan-leak standalone 1/1.
- build-report.json confirmed churn-only: entryGzipBudgetBytes 368640 unchanged, measured 139,765 B (+72 B from the component change). Non-blocking FYI: scopes.initialJavaScript CSS->JS flip = pre-existing lexicographic quirk in benchmark_build.py:57, hash-order dependent, unused by gate budget.
- Committed db8d7ca (4 files), pushed fast-forward (dry-run first): origin/ashwinwork = db8d7ca.
- T27 dispatched (final release gate): full battery recorded into VALIDATION.md (vitest/pytest/e2e x2/typecheck/lint/gate + spec ACs), follow-up 1 = return-phone loopback WITHOUT clearWorkspaceSnapshot workaround (prove store-level fix), follow-up 2 = EX numbering (pairing race gets own number, fix 2 test comments, lint-count 5->6), honest exceptions only for unmeetable ACs. src/** read-only for T27 - findings reported, not fixed.

## 2026-10-30 (date rollover) — T27 agent died on transient network error; session continued
- T27 background agent errored with getaddrinfo ENOTFOUND opencode.ai AFTER completing most of its work (uncommitted tree, nothing lost - lead inspected, discarded nothing): pairing.ts clearWorkspaceSnapshot now opt-in per scenario + new workspaceSnapshotPresent precondition probe; webrtc-loopback spec runs as 'returning' phone (stale kv/workspace-snapshot.v1 KEPT, never cleared) + reload re-check with explicit vacuity guard, LIVE-reached / not-stuck-IDLE / capture-unlocked assertions; VALIDATION.md EX-7 added (pairing race numbered, RESOLVED via 9d7f33f, EX-2 kept as GPU preflight), EX-1 lint count 5->6 corrected, T24 written-exception 2 marked RESOLVED-as-EX-7; 2 pairing-hydrate test comments re-labeled EX-2 -> EX-7 (comments only).
- SAME session continued (network was transient): agent to verify follow-ups 1+2 green, then run the FULL T27 battery into a new VALIDATION.md section (vitest/pytest/e2e x2/typecheck/lint/gate/validate:scenes/check_chunks + spec AC sweep).
- NEW FINDING reported by T27 diagnostics (honest, not papered over; src/** read-only for T27): after the mid-session phone reload the RTCPeerConnection re-establishes but the host does NOT re-create the 'capture' datachannel - a post-reload capture fails honestly with 'The data channel closed before the frame could start'. Separate src/lib/pairing gap: route as bounded task after T27 (datachannel lifecycle across page reload / re-pair). Never asserted green anywhere.

## 2026-10-30 — T27 final release gate complete (agent); review dispatched
- Per-AC all PASS (commands run this session by agent, timestamps 13:19/13:26 IST): typecheck 0; lint 0 err/6 warn; vitest 667/667 (34 files, 6.5s); e2e 36/36 x2 (103.5s/106.7s); validate:scenes 2 bundles; build entry 139,765 B gzip <= 368,640; benchmark:build OK; quality_gate 10/10 GATE_EXIT=0 (contains vitest 667 + e2e 36/36, 109s); check_chunks PASS (5 libs lazy, gsap honest exception); pytest 65/65 (24.15s); preflight PASS (colmap 4.2.1 CPU, ffmpeg). 5 manual checklist items (reduced-motion, grayscale, HUD contrast, real-phone smoke, Wi-Fi-off) recorded as explicit NOT RUN - human pre-demo, spec-sanctioned, not gate failures.
- Follow-up 1 RESULT: store-level hydrate fix HOLDS without the workaround. Loopback now runs as returning phone (stale kv/workspace-snapshot.v1 KEPT, precondition probe proves presence - anti-vacuity); phone reloads with snapshot present; post-reload: real new PC connected <=10s, rail LIVE active, IDLE not active, capture enabled. Green x4 standalone + both full runs + gate. Frame count baseline-relative (initialFrames+1) so the allowed retry cannot be contaminated by a prior staged frame.
- Follow-up 2: EX-7 added (RESOLVED, 9d7f33f, both evidence legs); T24 exception-2 annotated RESOLVED-as-EX-7 preserving original text; EX-1 lint count 5->6 corrected; 2 pairing-hydrate comment refs EX-2->EX-7 (15/15 re-verified).
- Follow-up 3: full battery recorded in new T27 section of VALIDATION.md.
- Reviewer dispatched on the 4-file diff with vacuity audit of the reload assertions + datachannel-finding verification + history-intact check.
- After review+commit: route the datachannel gap (src/lib/pairing - createDataChannel only in createPc, renegotiation reuses old peer, no recreation) as bounded task if budget allows; then G closure (HANDOFF finalization, final push).
