# Round 1 Final Sprint — EVENT LOG

## 2026-10-30

### 19:20 IST — Sprint start
- Inspected repository state on `ashwinwork` branch (f2889b5)
- Branch is 3 commits ahead of `origin/ashwinwork` (09112e3)
- 11 modified files + 8 untracked in working tree

### 19:21 IST — Git fetch reveals new branches
- `origin/integration/round1` advanced to 4990962 (new technical abstract)
- `origin/ujesha/round1-fixes` advanced to 0e95397 (scene bundle, nav grid)
- **NEW** `origin/ujesha/viewer-unify` (715b2ee) — consolidated viewer with:
  - Gaussian splat loading (.sog/.ply)
  - Collision on captured scenes (slide along walls, grid lookups)
  - Captured-scene walkthrough (full screen, pitch limits, filmed directions)
  - Sharper splat rendering (display resolution, near-eye noise clipping)

### 19:22 IST — Test verification
- Typecheck: PASS (0 errors)
- Unit tests: 679/679 (36 files) — **88 new tests** since prior sprint
- Build report and observation contract improvements in working tree

### 19:22 IST — Strategic decision: Release baseline approach
- ashwinwork remains the primary branch (has the most mature studio, tests, and T21-T27 work)
- viewer-unify has the most advanced viewer but completely restructured directory layout
- Integration approach: cherry-pick key viewer improvements into ashwinwork rather than rebasing
- integration/round1 has the Technical Abstract PDFs we need for submission

### 19:23 IST — Deployment strategy
- Existing vercel.json in project root and apps/studio
- GitHub Pages workflow exists in viewer-unify (.github/workflows/pages.yml)  
- Vercel deployment is most practical for the studio app
- Will configure and deploy the studio app to Vercel
