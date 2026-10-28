# DECISIONS — Round 1 Rescue Sprint

## D-001 (pending): Rescue baseline selection
- Context: 4 candidate lines (studio 86b7a66 / origin/main 744f7c3 / round1-fixes 70132ba / orphan round1 line). Selection must be evidence-based (content + testability), not name/count based.
- Status: IN_PROGRESS — testing round1-fixes in an isolated worktree before deciding.

## D-001 (resolved): Rescue baseline = origin/ujesha/round1-fixes @ 70132ba
- Evidence: ancestry proof — `git merge-base --is-ancestor 86b7a66 744f7c3` TRUE; `744f7c3 70132ba` TRUE. round1-fixes is a strict descendant of the studio line AND origin/main (incl. nks pipeline via PR #1). Verified green on macOS in isolated worktrees: typecheck 0, lint 0 (5 cosmetic warnings), unit 395/395 (main) and 396/396 (r1f). Contains apps/studio + pipeline/ + viewer/ + PROJECT_STATE.md handoff.
- Alternative rejected: origin/main (strict ancestor, fewer fixes); 86b7a66 (strict ancestor); orphan round1/viewer-pipeline line (lacks studio app).
- Consequence: rescue branch `rescue/round1-2026-10-29` created at 70132ba in isolated worktree /private/var/folders/.../opencode/ns-rescue. User's ashwinwork checkout left pristine.
- Windows test failures reported in PROJECT_STATE.md (2 pipeline tests) verified as Windows-only: both baselines pass 395+ on macOS.

## D-002: Commit/push policy (user directive 2026-10-29 ~02:20 IST)
- All sprint commits land on user's branch: fast-forward `ashwinwork` to rescue tip at major phase boundaries and push origin ashwinwork (ancestor relationship makes this a true fast-forward; no force; teammate history preserved). Verify with `git push --dry-run` before each push. Subagents do NOT commit; lead reviews diffs and commits per phase.

## D-003: Raw captures never committed
- User-provided room photos stored at work/captures/room/ (70 JPEG, WhatsApp 740x1600/738x1600, 4.5MB). Added `work/` to .gitignore. Preserved audit byproduct: logs/round1-rescue/artifacts/build-report.ashwinwork-dirty.json (sha256 890ba167... matches user's dirty file).
