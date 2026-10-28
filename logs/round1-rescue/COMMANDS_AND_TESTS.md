# COMMANDS AND TESTS — Round 1 Rescue Sprint

Convention: every meaningful command, cwd (repo root unless noted), result, exit status, interpretation. "Recommended" ≠ "executed".

## 2026-10-29
| # | Command | Cwd | Result | Exit | Interpretation |
|---|---------|-----|--------|------|----------------|
| 1 | `git fetch origin --prune` | repo | round1-fixes 8fcd7ef→70132ba | 0 | refs current as of 02:09 IST |
| 2 | `git status --porcelain` | repo | ` M benchmark/build-report.json` | 0 | audit byproduct; preserve |
| 3 | `find . -name '*.jpg' ...` (capture media) | repo | none | 0 | no real captures in repo |
| 4 | `which colmap ffmpeg python3 brew` | repo | colmap MISSING; others present | 0 | reconstruction env blocker confirmed |
| 5 | `brew install colmap` | repo | COLMAP 4.2.1 (no GPU support) @ /opt/homebrew/bin/colmap | 0 | CPU-only build; dense stereo/CUDA still unavailable |
| 6 | `sips -z 1600 740` × 70 imgs → work/captures/room_norm/ | repo | 70/70 uniform 740x1600 | 0 | mitigates single_camera mixed-size silent drop |
| 7 | `colmap feature_extractor + exhaustive_matcher + mapper` (room_norm, single_camera=1) | work/captures | RUNNING (background, log: work/captures/room_colmap/run.log) | pending | Workstream B registration feasibility |
| 8 | `python pipeline/run_pipeline.py work/captures/room_norm --out work/captures/room_run --matcher exhaustive --cpu` | repo | FAILED at sfm gate: 2/70 (3%), 229 pts (need 60%/2000), exit 1 | 1 | honest gate; report.json failed |
| 9 | sqlite cameras query on both dbs | repo | manual=db model 2 SIMPLE_RADIAL; pipeline=db model 4 OPENCV; both 70 imgs/2415 pairs | 0 | camera model = only input difference |
| 10 | `colmap mapper` rerun on manual db | work/captures | models 3/26/50 imgs (best 50/70) | 0 | large model reproduces; mapper nondeterministic |
| 11 | vitest full + typecheck (after flags fix) | apps/studio | 424/424; tsc 0 | 0 | env test now hermetic |
| 12 | isolation: OPENCV-only fresh db extract+match+mapper | work/captures | RUNNING | - | separates camera_model vs use_gpu |
