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
