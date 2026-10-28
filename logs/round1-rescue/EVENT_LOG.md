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
