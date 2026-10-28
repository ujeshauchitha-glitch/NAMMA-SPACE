# Engineering quality reset log

**Audit date:** 24 October 2026  
**Scope:** Existing Namma Space prototype; no restart or remote deployment.

## Skills loaded and applied

- Architecture/scope: `product-architecture`, `system-design`, `scope-control`, `hackathon-strategy`, `repo-forensics`.
- Verification/reliability: `engineering-quality`, `project-review`, `project-test`, `project-debug`, `project-performance`, `testing-strategy`, `failure-recovery`, `benchmarking`.
- Research/algorithms: `research`, `paper-analysis`, `research-to-product`, `algorithm-selection`, `experiment-design`, `evaluation-design`, `rederive`.
- UI/product: `creative-web`, `design-system`, `ui-ux-engineering`, `design-taste-frontend`, `frontend-polish`, `accessibility`, `interaction-design`, `visual-qa`, `frontend-performance`, `animation-performance`.
- Delivery: `documentation`, `production-readiness`, `deployment`, `project-handoff`, `repo-hygiene`, `open-source-readiness`.

The installed taste-skill inspector could not be executed because its documented path is not present in this container. The built-in browser was used instead for visual inspection.

## Defects found and corrected

| Priority | Defect | Correction | Evidence |
|---|---|---|---|
| Mandatory/performance | PlayCanvas was statically imported into the initial page bundle | Viewer is dynamically imported after scene data is valid | Initial chunk reduced from ~2.36 MB minified / 626 KB gzip to ~332 KB / 101 KB; PlayCanvas is a separate ~2.03 MB / 524 KB chunk |
| Functional | Scene URI resolution depended on a brittle origin/string concatenation pattern | Added `resolveSceneUri` and used it for scene data and visual assets | Contract test covers manifest-relative asset resolution |
| Functional | Scene schema accepted invalid navigation start cells and overlapping/out-of-range occupancy | Added Zod `superRefine` invariants and runtime route guards | New malformed-contract tests pass; validator rejects invalid start/indices |
| Functional | Fixture route bars were always axis-aligned, so displayed geometry did not match diagonal A* segments | Route segments now rotate to the actual segment bearing | Code path uses returned route world points and computes segment angle |
| Functional/reliability | Viewer did not explicitly dispose loaded assets/materials and dynamic route material | Asset unload/removal and route material cleanup added | Lifecycle cleanup is in `destroy()` |
| Interaction | POI selection did not update the 3D marker state | Added selected marker highlight and scale change | Selection calls viewer API |
| Accessibility | Canvas was not keyboard focusable; POI options lacked selection semantics; shortcut hint was not wired | Added canvas `tabIndex`, `role=option`, `aria-selected`, Cmd/Ctrl+K search focus, and visible focus styles | Source audit; browser DOM exposes named controls |
| Pipeline gap | Frame preparation stopped before a real, inspectable reconstruction boundary | Added COLMAP preflight and sparse reconstruction adapter with stage reports | Missing COLMAP produces a blocked report, not fake success |
| Browser verification | Built-in browser click dispatch was unreliable | Added Playwright Chromium E2E with a reproducible Vite `webServer` | 6 browser tests passed against synthetic and generated GLB fixtures |
| Pipeline completeness | Dense and mesh stages were only described at the adapter boundary | Added COLMAP undistortion, PatchMatch, fusion, PLY validation, meshing, fake-executable contract coverage, and scene-bundle generation | 17 Vitest tests pass; real execution remains dependency-blocked |
| Navigation integrity | `clearanceMetres` was not operationally documented or testable | Added explicit obstacle-inflation utility and narrow doorway/corner tests; shipped fixture remains pre-baked to avoid double inflation | Navigation suite passes; utility is for raw geometry authoring |

## Remaining blockers

- No `colmap` or `nvidia-smi` executable is available in the current environment; FFmpeg is available at `/opt/homebrew/bin/ffmpeg`.
- No real smartphone capture is present, so no genuine sparse reconstruction or browser-ready GLB has been produced.
- The generated GLB visibly loads in the built-in browser and all supported DOM interactions now pass in Playwright Chromium. Pointer lock and WASD remain manual because headless Chromium is not a reliable permission/display test for those capabilities.
- The taste-skill screenshot inspector path is missing from the container, so the official 1440/768/390 inspection gate could not run.
- The lazy PlayCanvas chunk remains large; further optimization should wait until actual judging-device load measurements exist.
- `npm audit --omit=dev --audit-level=moderate` reports no production dependency vulnerabilities. The initial full install audit reported development-tool advisories; no force-upgrade was applied.

## Next step

The current local quality gate includes typecheck, lint, 17 Vitest tests, 6 Playwright tests, production build, scene validation, bundle benchmarking, and reconstruction preflight. Next, install or provide a reproducible Linux COLMAP/Open3D environment and one consented indoor capture, then run the documented image-folder → sparse → dense → mesh path before publishing a genuine captured scene bundle.
