# HANDOFF — Round 1 Rescue Sprint (living document)

Started 2026-10-29 02:15 IST. This file is maintained continuously; final version at sprint freeze.

## A. Repository and branch
- Root: /Users/flamexmystix/Documents/Sidequests/hackathons/nammaspace
- Starting branch/commit: ashwinwork @ 86b7a66 (+ dirty benchmark/build-report.json, preserved)
- Rescue branch: pending (Workstream A)

## G. Next-agent starting instruction
- (updated at each checkpoint; see STATUS.md next-three-actions)

## F. Workstream F — submission package (2026-10-29, agent)

- **Created (untracked; lead to commit at next boundary):** `docs/SUBMISSION_ROUND1.md`
  (package index: evidence table, BLK-001 verbatim, run/verify commands, 5-minute
  judge quickstart, consolidated limitations), `docs/CAPTURE_DAY.md` (real-capture
  record: 70 WhatsApp photos → normalize → R0..R4 run-by-run with all numbers, log
  pointers, re-shoot ask), `docs/ABSTRACT.md` (adapted from stranded draft
  `c305a36:docs/ABSTRACT.md` on `origin/ujesha/local-viewer-pipeline` +
  `origin/ujesha/studio-splat-spike`; TBDs replaced with verified reality or explicit
  `[FILL]` team fields).
- **Stranded-content findings:** `docs/ABSTRACT.md`, `docs/CAPTURE_DAY.md`,
  `docs/SUBMISSION.md` exist at commit `c305a36` (26 Oct) on the two stranded branches
  — NOT at `docs/round1/ABSTRACT.md` as `PROJECT_STATE.md:184` claims (path in
  PROJECT_STATE is wrong). Old CAPTURE_DAY was a pre-shoot checklist card; old
  SUBMISSION was a 26-Oct checklist/day-plan — superseded, not carried over verbatim.
- **Verification re-run 29 Oct ~05:55 IST (all green):** vitest 591/591 (32 files) ·
  typecheck 0 · lint 0 errors (6 react-refresh warnings) · pytest 65/65 ·
  `validate:scenes` 2/2 · `python3 scripts/quality_gate.py` 10/10 `GATE_EXIT=0`
  (incl. Playwright e2e 28/28) · `pipeline/run_pipeline.py --doctor` all OK except
  `[MISSING] nvidia GPU` (exit 1 on macOS, expected, use `--cpu`).
  Side effect: my quality-gate run rewrote `apps/studio/benchmark/build-report.json`
  (measurement byproduct — lead to review/commit or restore; left untouched by F).
- **README/DEMO_SCRIPT contradictions routed to lead (F did not edit them):**
  1. `README.md:73` — "COLMAP + Brush ran end to end on a synthetic clip (28 Oct 2026)"
     is NOT verifiable from current repo state (no log/report/commit evidences it;
     `work/` is git-ignored and absent of such outputs). Needs a source or softening.
  2. `README.md:73` — "footage now exists": the capture was 70 still photos, no video.
  3. `docs/DEMO_SCRIPT.md:10` — walkthrough segment presupposes a real reconstructed
     room; none exists (BLK-001). Script needs an honest amendment (synthetic-with-
     disclosure or re-shoot-contingent) before recording.
  4. `docs/DEMO_SCRIPT.md:9` — "real processing times and resource use": no full
     pipeline run ever reached training; only sparse-stage evidence exists.
  5. `docs/DEMO_SCRIPT.md:14` — precondition "viewer deployed at a public URL" is not
     met (`README.md:74` un-ticked).
- **Deliberately NOT claimed:** real reconstruction success, trained real splat,
  device-to-device pairing verification, accessibility/safety validation, fps/benchmark
  numbers, T23/T24 completion (absent from `git log` at F closeout — HEAD `ea0bb46`),
  private long-term vision (5 horizons) content.
