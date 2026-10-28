# BLOCKERS — Round 1 Rescue Sprint

(format: ID · description · impact · evidence · attempted · alternatives · next step)

## B-001 — No COLMAP/CUDA on this machine
- Impact: real reconstruction cannot run locally (sparse needs colmap binary; dense patch_match_stereo has no CPU fallback → needs CUDA).
- Evidence: `which colmap` → missing; `preflight:reconstruction` JSON: colmap available:false, nvidia-smi available:false (audit 2026-10-29).
- Status: OPEN — human-owned if real capture arrives; see Workstream B.

## BLK-001 (2026-10-29 03:46 IST) — Real-capture set splits into two disconnected rooms
- **What**: The user's 70-photo WhatsApp capture cannot produce ONE connected reconstruction. Pipeline runs #2 and #3 (both after the SIMPLE_RADIAL camera-model fix) produced IDENTICAL topology: model 0 = 40/70 images (57%), model 1 = 17/70 images disconnected, 13 unregistered. Gate needs >=60% registration in the connected solution (42 imgs); honest fail, no threshold weakening.
- **Evidence**: work/captures/pipeline_run2.log, pipeline_run3.log, room_run/report.json (sfm_registration FAIL 57%, sfm_points PASS 2966, sfm_reprojection PASS 0.92px, sfm_single_model WARN "the room split"). Mapper nondeterminism ruled out as the cause: two independent runs converged on the same 40+17 split (earlier manual runs on the full set reached 50-59 images in one model but still varied; the split is consistent).
- **Root cause**: capture overlap weakness at doorways between room halves — matches the pipeline's own remediation text ("Re-shoot doorways/overlap") and the capture SOP's overlap requirement. NOT a software defect (camera-model bug fixed in a4299f5 was the larger defect: 3% -> 57%).
- **Impact**: full-room splat training for this capture is blocked. No real end-to-end splat output from the full set within this sprint.
- **Continuation**: (1) re-shoot per SOP with deliberate doorway/overlap traversal (or a slow video walk-through — the pipeline's default sequential matcher targets that); (2) interim disclosed mitigation running now: pipeline on the 40-image connected component alone ("room_subset40") with the SAME gates — answers what a proper single-room capture yields on this Mac. Result to be recorded either way.

## BLK-001 amendment (03:49 IST) — subset run confirms capture-quality blocker, not just topology
- Disclosed subset run (40-image connected component, SAME gates): registration PASS 29/40 (72%), reprojection PASS 0.96px, but **sfm_points FAIL: 886 < 2000**. Exit 1, no training. work/captures/pipeline_subset_run2.log, room_subset_run/report.json.
- Interpretation: even the best-connected region of this capture triangulates far too few points. The 740x1600 WhatsApp JPEGs (compression + low resolution + probable motion blur) lack the texture/parallax the gates require. Software pipeline is exonerated end-to-end (validation, frames, SfM wiring, gates all behave correctly and honestly).
- Resolution: re-shoot per capture SOP (native camera resolution >=1080p, 60-70% overlap, deliberate doorway traversal, steady slow motion or video). With the SIMPLE_RADIAL + normalization fixes now in place, a compliant capture on this same Mac has a credible path to passing all gates. Full capture→splat demonstration continues on the team's RTX 5060 host (dense MVS still needs CUDA).
