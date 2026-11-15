# Remote branches (15 Nov 2026)

Compared with `round2/poi-nav` at the end of Round 2 task 5. "Merged" means every commit on the branch is in
`round2/poi-nav`. Nothing was deleted; deleting is the team's call.

| Branch | Fully merged? | Safe to delete? | What is unique on it |
|---|---|---|---|
| `round2/poi-nav` | — | **No: Round 2 working branch** | everything below plus Round 2 |
| `round1/viewer-pipeline` | yes | **No: the repository's default branch**, and the Round 1 PDFs link into it | — |
| `ujesha/pages` | no (4 commits) | **No: GitHub Pages serves the mirror from it** (ujeshauchitha-glitch.github.io/NAMMA-SPACE) | static builds of the studio only, no source |
| `round2/kaggle-pipeline` | yes | yes | — (merged in task 5) |
| `submission/round1` | yes | yes | — |
| `ujesha/final-integration` | yes | yes | — |
| `ujesha/round1-fixes` | yes | yes | — |
| `finalashwinintegration` | yes | yes | — |
| `ashwinwork` | yes | yes | — |
| `main` | yes | yes | — |
| `nks` | yes | yes | — |
| `integration/round1` | no (2 commits) | yes | early drafts of the Round 1 abstract and links PDFs; the submitted versions are in `docs/submission/` |
| `ujesha/local-viewer-pipeline` | no (2 commits) | yes | a debug overlay for the removed Spark viewer, an early pytest/Pages setup and Round 1 planning notes; all superseded |
| `ujesha/studio-splat-spike` | no (3 of 4 commits) | yes | splat loading in the PlayCanvas viewer, in the pre-`apps/studio` layout; the same feature is in the studio today |
| `ujesha/viewer-unify` | no (7 of 8 commits) | yes | captured-scene walkthrough work in the old layout: splat loading, collision with wall sliding, display-resolution rendering, near clip, 1.4 m/s walking, pitch limit, the filmed-direction guide. All of it exists in `apps/studio/src/engine/PlayCanvasViewer.ts` (the guide is now opt-in, `?guide=1`; the pitch limit is 60°) |

Checked with `git rev-list --count round2/poi-nav..origin/<branch>`, `git cherry` (patch equivalence) and a
search of the current code for each unique feature.
