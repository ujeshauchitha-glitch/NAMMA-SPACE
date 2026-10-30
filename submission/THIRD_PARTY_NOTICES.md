# Third-Party Notices — Namma Space

**Inventory of every third-party component in the release, with exact versions, roles, licenses, and the evidence used to verify each license.**

| | |
|---|---|
| Repo | `nammaspace` (branch `ashwinwork`, commit `828f262`) |
| Compiled | 2026-10-30 (day before submission deadline 2026-10-31) |
| Purpose | Techfest 2026-27 competition rule 4 — crediting open-source tools with licenses |
| Convention | Every license below cites its source: an in-repo/in-install **LICENSE file path**, a **lockfile/`METADATA` license field** (package-manager metadata published by the package itself), or an **official URL fetched on 2026-10-30**. Anything that could not be checked that way is marked **`UNVERIFIED — <what was checked>`**. |
| Disclaimer | This is an engineering inventory, **not legal advice**. Items marked *consult human* need a person's judgment before submission. |

---

## 0. What actually ships (scope of this inventory)

| Surface | Status | Notes |
|---|---|---|
| `apps/studio/` web app (Vite build → `dist/assets/*.js`, `dist/fonts`, `dist/scenes`) | **Ships as built output** (source tracked; `dist/` and `node_modules/` are gitignored local build products) | Round-2 studio app. Bundle contents proven by `apps/studio/scripts/check_chunks.py` (output in §10). |
| `viewer/` web app (`vercel.json` → `installCommand: cd viewer && npm ci`, `outputDirectory: viewer/dist`) | **Ships as the hosted/Vercel deploy** | Per README architecture: React + react-three-fiber + Spark first-person viewer. |
| `apps/studio/public/fonts/*` (3 woff2 + 3 license/provenance texts) | **Tracked and shipped** (copied into `dist/fonts/`) | SIL OFL 1.1 — full texts travel with the files (§7). |
| Scene fixtures (`public/scenes/fixture`, `public/scenes/glb-fixture` incl. `architectural-fixture.glb`) | **Tracked and shipped** | First-party, procedurally generated (§7). |
| `pipeline/`, `apps/studio/scripts/`, `tests/` (Python + TS) | **Tracked** | Our code; third-party Python packages listed in §5. |
| `node_modules/`, `apps/studio/node_modules/`, `.venv/`, `tools/`, `work/`, `dist/` (root) | **NOT shipped** — all gitignored (`git ls-files` returns 0 entries for `tools/`, `work/`, `dist/`, `.venv/`) | Local installation/working state; licenses recorded here anyway because they were used to produce the release. |
| Playwright browser binaries (`~/Library/Caches/ms-playwright/*`) | **NOT shipped** — outside the repo, test-only (§8). | |
| Model weights / datasets | **None ship** (§9). | |

**Entry counts by category**

| # | Category | Entries |
|---|---|---|
| 1 | npm runtime — `apps/studio` (lockfile non-dev) | **14** (11 direct + 3 transitive) |
| 2 | npm runtime — `viewer` (lockfile non-dev) | **19** (5 direct + 14 transitive) |
| 3 | npm dev-only — `apps/studio` | **248** lock entries (16 direct devDeps) — full list: Appendix A |
| 4 | npm dev-only — `viewer` | **71** lock entries (8 direct devDeps) — full list: Appendix B |
| 5 | npm — `tools/splat-transform` install tree | **8** — Appendix C |
| 6 | Python (`.venv`) | **8** (2 pipeline runtime, 5 test-only, 1 tooling) |
| 7 | Native pipeline tools | **4** headline (COLMAP, ffmpeg, Brush, splat-transform CLI) + Homebrew dependency tree note |
| 8 | Web fonts shipped | **3 files / 2 families** |
| 9 | Static assets shipped (own + one brand glyph) | **5 artifacts** (2 favicons, 1 icon sprite, 2 scene bundles) |
| 10 | Test-only browsers/tools | **3 packages + 6 browser binaries** |
| 11 | Model weights / datasets | **0 shipped** |

---

## 1. npm runtime dependencies — `apps/studio` (the shipped JS bundle)

Source: `apps/studio/package-lock.json` (non-`dev` entries). Bundle role proven by marker-based chunk attribution run on the real `dist/` (§10, `check_chunks.py` output). Lockfile note: `package.json` ranges `playcanvas ^2.6.0`, `react ^19.1.1`, `zod ^4.1.5` resolve to the exact versions below.

| # | Package | Version | Role in release | License | License source (evidence) |
|---|---|---|---|---|---|
| 1 | `react` | 19.3.1 | Runtime — **entry chunk** (`dist/assets/index-CY1ys4oe.js`); imported by 32 source files | MIT | `apps/studio/node_modules/react/LICENSE`; lockfile `license: MIT` |
| 2 | `react-dom` | 19.3.1 | Runtime — entry chunk | MIT | `apps/studio/node_modules/react-dom/LICENSE` |
| 3 | `scheduler` | 0.28.0 | Runtime — entry chunk (react-dom transitive) | MIT | `apps/studio/node_modules/scheduler/LICENSE` |
| 4 | `zod` | 4.6.7 | Runtime — entry chunk (`src/types/pairing.ts`, `src/types/scene.ts`, `src/lib/sceneLoader.ts`) | MIT | `apps/studio/node_modules/zod/LICENSE` |
| 5 | `three` | 0.186.1 | Runtime — **lazy chunk** `three.module-Dljb2UHm.js` (746,766 B; markers `REVISION`+`SRGBColorSpace`); dynamic import `src/lib/scan/scene3d`→`CoverageVisualizer.tsx:9` | MIT | `apps/studio/node_modules/three/LICENSE` |
| 6 | `playcanvas` | 2.23.3 | Runtime — **lazy chunk** `PlayCanvasViewer-BbhGi6Qi.js` (2,032,736 B; marker `playcanvas.inspector`) | MIT | `apps/studio/node_modules/playcanvas/LICENSE` |
| 7 | `fflate` | 0.8.3 | Runtime — **lazy chunk** `browser-Cgug2DPz.js` (marker `deflateSync`; import site `src/lib/capture/exportBundle.ts:81`) | MIT | `apps/studio/node_modules/fflate/LICENSE` |
| 8 | `idb` | 8.0.4 | Runtime — **lazy chunk** `index-V7xXUF1b.js` (marker `deleteDB`; import site `src/lib/storage/db.ts:85`) | ISC | `apps/studio/node_modules/idb/LICENSE` |
| 9 | `qrcode-generator` | 2.0.4 | Runtime — **lazy chunk** `qrcode-5IewWFXk.js` (marker `stringToBytes`; import site `src/components/scan/qr-code.ts:48`) | MIT | **No LICENSE file in the package dir** — verified instead from `package.json` `license: "MIT"` **and** npm registry `https://registry.npmjs.org/qrcode-generator/latest` (`"license":"MIT"`, fetched 2026-10-30) |
| 10 | `gsap` | 3.15.0 | **Declared but NOT in any built chunk** — `check_chunks.py` reports `[EXCEPT] gsap → imported nowhere in the bundle (declared dependency; laziness vacuous)`. Only referenced in comments/animation tokens (`src/styles/motion.ts`, `src/motion/index.ts` plans a future dynamic `import('gsap')`). | GSAP Standard **"No Charge" License** (custom, © Webflow; **not OSI**) | `package.json` `"license": "Standard 'no charge' license: https://gsap.com/standard-license."`; full text fetched 2026-10-30 from `https://gsap.com/standard-license/` |
| 11 | `@gsap/react` | 2.1.2 | **Declared but NOT in the bundle** (same evidence as #10) | Same GSAP Standard License | `package.json` `"license": "SEE LICENSE AT https://gsap.com/standard-license"` — **no LICENSE file in package dir** |
| 12 | `ws` | 8.22.0 | **Not in the bundle** (0 occurrences of `WebSocketServer` in all `dist/assets/*.js`). Dev/build-time only: WebSocket signalling plugin `apps/studio/scripts/ws-signalling-plugin.ts` loaded by `vite.config.ts`, plus `tests/signalling-relay.test.ts` | MIT | `apps/studio/node_modules/ws/LICENSE` |
| 13 | `@types/webxr` | 0.5.24 | Type declarations only (transitive via `playcanvas`); not emitted into JS | MIT | `apps/studio/node_modules/@types/webxr/LICENSE` |
| 14 | `@webgpu/types` | 0.1.74 | Type declarations only (transitive via `playcanvas`); not emitted into JS | BSD-3-Clause | `apps/studio/node_modules/@webgpu/types/LICENSE` |

License mix (runtime): MIT ×10, ISC ×1, BSD-3-Clause ×1, GSAP Standard License ×2 (both **not shipped**).

## 2. npm runtime dependencies — `viewer` (the Vercel-deployed app)

Source: `viewer/package-lock.json` (non-`dev` entries). `viewer/node_modules` is **not installed locally**, so no per-package LICENSE files exist to read; verification basis is the lockfile license field (npm copies it verbatim from each package's own `package.json`), upgraded to registry confirmation for the two headline renderer packages. Exact bundle roles (which chunk holds what) are **not re-verified for viewer** — its build output is produced on Vercel; treated as *runtime set = lockfile non-dev set*.

| # | Package | Version | Role | License | License source |
|---|---|---|---|---|---|
| 1 | `@sparkjsdev/spark` | 2.4.0 | Runtime (direct) — Gaussian-splat renderer for three.js | MIT | lockfile license field; **confirmed** at `https://registry.npmjs.org/@sparkjsdev/spark/latest` (`"license":"MIT"`, 2026-10-30) |
| 2 | `@react-three/fiber` | 9.8.2 | Runtime (direct) — React renderer for three.js | MIT | lockfile license field; **confirmed** at `https://registry.npmjs.org/@react-three/fiber/latest` (`"license":"MIT"`, 2026-10-30) |
| 3 | `three` | 0.186.1 | Runtime (direct) | MIT | lockfile field; LICENSE file also exists in `apps/studio/node_modules/three/LICENSE` (same version) |
| 4 | `react` | 19.3.1 | Runtime (direct) | MIT | lockfile field; LICENSE also at `apps/studio/node_modules/react/LICENSE` |
| 5 | `react-dom` | 19.3.1 | Runtime (direct) | MIT | lockfile field; LICENSE at `apps/studio/node_modules/react-dom/LICENSE` |
| 6 | `zustand` | 5.0.15 | Runtime (via fiber) | MIT | lockfile license field |
| 7 | `its-fine` | 2.1.1 | Runtime (via fiber) | MIT | lockfile license field |
| 8 | `suspend-react` | 0.1.3 | Runtime (via fiber) | MIT | lockfile license field |
| 9 | `react-use-measure` | 2.1.7 | Runtime (via fiber) | MIT | lockfile license field |
| 10 | `use-sync-external-store` | 1.7.0 | Runtime (via fiber) | MIT | lockfile license field |
| 11 | `scheduler` | 0.28.0 | Runtime (via react-dom) | MIT | lockfile field; LICENSE also at `apps/studio/node_modules/scheduler/LICENSE` |
| 12 | `buffer` | 6.0.3 | Runtime (via fiber) | MIT | lockfile license field |
| 13 | `base64-js` | 1.5.1 | Runtime (via fiber) | MIT | lockfile license field |
| 14 | `ieee754` | 1.2.1 | Runtime (via buffer) | BSD-3-Clause | lockfile license field |
| 15 | `@babel/runtime` | 7.29.10 | Runtime (via fiber) | MIT | lockfile license field |
| 16 | `csstype` | 3.2.3 | Runtime (via @types/react types) | MIT | lockfile license field |
| 17 | `@types/react` | 19.3.0 | Types (lockfile non-dev) | MIT | lockfile license field |
| 18 | `@types/react-reconciler` | 0.28.9 | Types (lockfile non-dev) | MIT | lockfile license field |
| 19 | `@types/webxr` | 0.5.24 | Types (lockfile non-dev) | MIT | lockfile license field; LICENSE at `apps/studio/node_modules/@types/webxr/LICENSE` |

License mix (viewer runtime): MIT ×18, BSD-3-Clause ×1. **No copyleft, no custom licenses in the deployed viewer bundle.**

## 3. Dev-only npm — build, lint, test (never in a shipped bundle)

**`apps/studio` — 16 direct devDependencies (248 lock entries total; full machine-generated list: Appendix A).**

| Package | Version | Role | License | License source |
|---|---|---|---|---|
| `typescript` | 5.9.3 | typecheck/build | Apache-2.0 | `apps/studio/node_modules/typescript/LICENSE.txt` |
| `vite` | 7.3.7 | bundler/dev server | MIT | `apps/studio/node_modules/vite/LICENSE.md` |
| `vitest` | 5.0.5 | unit tests | MIT | `apps/studio/node_modules/vitest/LICENSE.md` |
| `@playwright/test` | 1.64.1 | e2e tests | Apache-2.0 | `apps/studio/node_modules/@playwright/test/LICENSE` (text read: "Apache License Version 2.0") |
| `eslint` | 9.39.5 | lint | MIT | `apps/studio/node_modules/eslint/LICENSE` |
| `@eslint/js` | 9.39.5 | lint | MIT | lockfile license field |
| `eslint-plugin-react-hooks` | 6.1.1 | lint | MIT | lockfile license field |
| `eslint-plugin-react-refresh` | 0.4.26 | lint | MIT | lockfile license field |
| `typescript-eslint` | 8.72.0 | lint | MIT | lockfile license field |
| `globals` | 16.5.0 | lint | MIT | lockfile license field |
| `@types/node` | 26.6.5 | types | MIT | lockfile license field |
| `@types/react` | 19.3.0 | types | MIT | lockfile license field |
| `@types/react-dom` | 19.3.0 | types | MIT | lockfile license field |
| `@types/three` | 0.186.0 | types | MIT | lockfile license field |
| `@vitejs/plugin-react` | 5.2.0 | build | MIT | lockfile license field |
| `@vitejs/plugin-basic-ssl` | 2.3.0 | dev HTTPS (LAN mode) | MIT | lockfile license field |

Notable licenses inside the 248-entry dev tree (all dev-only, none shipped):
- `caniuse-lite` 1.0.30001819 — **CC-BY-4.0** (browserslist data; attribution license) — lockfile field.
- `argparse` 2.0.1 — **Python-2.0** license — lockfile field.
- `minimatch` 10.2.6 (under `@typescript-eslint`) — **BlueOak-1.0.0** — lockfile field.
- Remaining dev entries: MIT ×206, Apache-2.0 ×20, ISC ×11, BSD-2-Clause ×6, BSD-3-Clause ×2 (Appendix A has every row).

**`viewer` — 8 direct devDependencies (71 lock entries total; Appendix B).** Notable: **`lightningcss` 1.33.0 and its 11 platform binaries — MPL-2.0** (Vite's CSS minifier; build tool only, **not distributed**, MPL is file-level copyleft so it does not attach to generated CSS). Rest: MIT ×54, Apache-2.0 ×3, ISC ×1, BSD-3-Clause ×1.

## 4. npm-installed pipeline CLI — `tools/splat-transform`

Installed by `scripts/setup_tools.sh` (`npm install --prefix tools/splat-transform --no-audit --no-fund @playcanvas/splat-transform@3.10.3`). `tools/` is **gitignored → not redistributed**. Full tree: Appendix C.

| Package | Version | Role | License | License source |
|---|---|---|---|---|
| `@playcanvas/splat-transform` | 3.10.3 | Pipeline tool — compress/convert Gaussian splats → `.sog` | MIT | `tools/splat-transform/node_modules/@playcanvas/splat-transform/LICENSE` (text read: "Copyright (c) 2011-2026 PlayCanvas Ltd. Permission is hereby granted…") |
| `@adobe/spz` | 0.2.3 | transitive (SPZ compression) | ISC | `tools/splat-transform/node_modules/@adobe/spz/LICENSE` |
| `playcanvas` | 2.23.3 | transitive (engine lib used by transform) | MIT | `tools/splat-transform/node_modules/playcanvas/LICENSE` |
| `webgpu` | 0.6.2 | transitive (Dawn native bindings; includes `dawn.node`, Windows `dxcompiler.dll`/`d3dcompiler_47.dll`) | MIT | lockfile license field (`tools/splat-transform/package-lock.json`) |
| `debug` | 4.4.3 | transitive | MIT | lockfile license field |
| `ms` | 2.1.3 | transitive | MIT | lockfile license field |
| `@types/webxr` | 0.5.24 | transitive types | MIT | lockfile license field |
| `@webgpu/types` | 0.1.74 | transitive types | BSD-3-Clause | lockfile license field |

## 5. Python dependencies (`.venv`, Python 3.15.2)

Manifest check: **there is no `pyproject.toml` / `uv.lock` / `requirements.txt` anywhere in the repo** (find over repo root, excluding `node_modules`/`.venv` → no matches). The environment is a plain `pip` venv created by `scripts/setup_tools.sh` / `.venv` (`pyvenv.cfg`: `home = /opt/homebrew/opt/python@3.15`, `include-system-site-packages = false`). **The entire environment is 8 packages** (`.venv/bin/python -m pip list --format=freeze`, run 2026-10-30). No COLMAP Python bindings, no PyTorch/nerfstudio (docs/TRAINING.md defers those to an optional CUDA machine), no Open3D.

| # | Package | Version | Role | License | License source (evidence) |
|---|---|---|---|---|---|
| 1 | `numpy` | 2.5.4 | **Pipeline runtime** (`pipeline/make_demo_splat.py`, `pipeline/checks.py`) | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 (the extra terms cover numpy's vendored components: libdivide, highway, pythoncapi-compat) | `.venv/lib/python3.15/site-packages/numpy-2.5.4.dist-info/METADATA` → `License-Expression:` line; full text `.venv/.../numpy-2.5.4.dist-info/licenses/LICENSE.txt` |
| 2 | `opencv-python-headless` | 5.0.0.93 | **Pipeline runtime** (`pipeline/run_pipeline.py:55`, `pipeline/preflight.py:129`; blur/matrix work) | Apache-2.0 (bundled third-party components enumerated by upstream) | `.venv/.../opencv_python_headless-5.0.0.93.dist-info/LICENSE.txt`, `LICENSE-3RD-PARTY.txt`, `METADATA` `License: Apache 2.0`; confirmed by `pip show` |
| 3 | `pytest` | 9.2.0 | Test-only (`tests/`, 65 tests) | MIT | `.venv/.../pytest-9.2.0.dist-info/METADATA` `License-Expression: MIT` + `licenses/LICENSE` |
| 4 | `pluggy` | 1.7.0 | Test-only (pytest dep) | MIT | `.venv/.../pluggy-1.7.0.dist-info/METADATA` + `licenses/LICENSE` |
| 5 | `iniconfig` | 2.3.1 | Test-only (pytest dep) | MIT | `.venv/.../iniconfig-2.3.1.dist-info/METADATA` + `licenses/LICENSE` |
| 6 | `packaging` | 26.3 | Test-only (pytest dep) | Apache-2.0 OR BSD-2-Clause | `.venv/.../packaging-26.3.dist-info/METADATA` + `licenses/LICENSE.APACHE`, `LICENSE.BSD` |
| 7 | `Pygments` | 2.21.0 | Test-only (pytest dep) | BSD-2-Clause | `.venv/.../pygments-2.21.0.dist-info/METADATA` + `licenses/LICENSE` |
| 8 | `pip` | 26.2.2 | venv tooling (installer) | MIT | `.venv/.../pip-26.2.2.dist-info/METADATA` `License-Expression: MIT` + `licenses/LICENSE.txt` |

## 6. Native pipeline tools (dev-machine tooling — **none are redistributed**)

Provenance recorded in `logs/round1-rescue/COMMANDS_AND_TESTS.md`, `logs/round1-rescue/EVENT_LOG.md`, `scripts/setup_tools.sh`, `scripts/setup_tools.ps1`, `docs/CAPTURE_DAY.md`. `tools/` and system installs (Homebrew) are gitignored/outside the repo.

| # | Tool | Exact version | Role | License | License source (evidence) |
|---|---|---|---|---|---|
| 1 | **COLMAP** | **4.2.1** (`colmap -h` → "COLMAP 4.2.1 … without GPU support"; Homebrew `/opt/homebrew/bin/colmap`) | Pipeline — structure-from-motion (feature extraction, matching, mapper) | **BSD 3-Clause** (COLMAP itself; dependencies separately licensed) | `/opt/homebrew/Cellar/colmap/4.2.1_4/COPYING.txt` — text read: "The COLMAP library is licensed under the new BSD license. Note that this text refers only to the license for COLMAP itself, independent of its dependencies, which are separately licensed." Copyright ETH Zurich / UNC Chapel Hill. Corroborated by `brew info` (`"license":"BSD-3-Clause"`). Install: `brew install colmap` (COMMANDS_AND_TESTS.md row 5) |
| 2 | **ffmpeg** | **9.0.2** (Homebrew build `9.0.2_1`; `ffmpeg -version` → "ffmpeg version 9.0.2") | Pipeline — video frame extraction / filters (invoked as a subprocess by `pipeline/compress.py` et al.) | **This build: GPL-3.0-or-later.** Upstream baseline is LGPL-2.1+; the Homebrew formula configures `--enable-gpl --enable-version3 --enable-libx264 --enable-libx265 --enable-libmp3lame …`, which re-licenses *the ffmpeg binary as a whole* under GPLv3 | `/opt/homebrew/Cellar/ffmpeg/9.0.2_1/LICENSE.md` (text read: LGPL v2.1+ baseline, "you have explicitly pass `--enable-gpl` … FFmpeg's license changes to GPL v2+"), plus `COPYING.LGPLv2.1`, `COPYING.GPLv2`, `COPYING.GPLv3` files; `ffmpeg -version` prints the exact `configuration:` line; `brew info` → `"license":"GPL-3.0-or-later"` |
| 3 | **Brush** | **v0.3.0** (`tools/brush-app-aarch64-apple-darwin/brush_app --version` → `brush-cli 0.3.0`) | Pipeline — 3D Gaussian Splatting trainer (WebGPU) | **Apache-2.0** | `tools/brush-app-aarch64-apple-darwin/LICENSE` — text read: "Apache License Version 2.0, January 2004". Provenance: upstream GitHub release `ArthurBrussee/brush` (URL pattern in `scripts/setup_tools.sh`; macOS binary sha256 `65b26313…8c` verified per `EVENT_LOG.md` line 25 and `docs/CAPTURE_DAY.md:82`). No `NOTICE` file present next to the binary |
| 4 | **@playcanvas/splat-transform** (CLI) | **3.10.3** | Pipeline — web compression stage (`.ply` → `.sog`) | **MIT** | see §4 (license file read) |
| — | Homebrew dependency tree of COLMAP (boost, ceres-solver, eigen, cgal, flann, glog, metis, ffmpeg, faiss, onnxruntime, qt, … — full list from `brew deps colmap`) | system-managed | Build/runtime libraries **of COLMAP**, on the dev machine only | Various (not redistributed; not individually re-verified) | `brew deps colmap` output; **not enumerated here** — see *consult human* note in §10 if any of these ever ships |
| — | macOS `sips` | system | Image normalization (`COMMANDS_AND_TESTS.md` row 6) | Apple system tool (proprietary, not open-source) | N/A — system utility; not distributed |

## 7. Web fonts and static assets actually shipped

| # | Asset | Shipped where | License | License source |
|---|---|---|---|---|
| 1 | `archivo-latin-var-wght400-700.woff2` (Archivo variable, wght 400–700, latin) | `apps/studio/public/fonts/` (tracked) → `dist/fonts/` → served by the studio app; `@font-face` in `src/styles/base.css:13`, preloaded `index.html:11` | **SIL OFL 1.1** | `apps/studio/public/fonts/OFL-Archivo.txt` (full license text, "Copyright 2020 The Archivo Project Authors") — **also copied into `dist/fonts/OFL-Archivo.txt`, so the notice ships with the font** |
| 2 | `ibm-plex-mono-latin-400.woff2` | same (base.css:24, index.html:12) | **SIL OFL 1.1** | `apps/studio/public/fonts/OFL-IBMPlexMono.txt` (ships in `dist/fonts/` too; "Copyright © 2017 IBM Corp.") |
| 3 | `ibm-plex-mono-latin-500.woff2` | same (base.css:35, index.html:13) | **SIL OFL 1.1** | same file as #2 |
| 3a | Provenance record | `apps/studio/public/fonts/OFL-note.md` (ships in `dist/fonts/`) | — | States: retrieved from Google Fonts CSS API (latin subsets) on 2026-10-24, self-hosted, never fetched at runtime from a third-party host |
| 4 | `favicon.svg` (`apps/studio/public/favicon.svg`, `viewer/public/favicon.svg`, both `dist/`) | shipped | First-party (no third-party source cited anywhere in the repo) | Created in repo scaffold commits; no icon-library import in either app |
| 5 | `viewer/public/icons.svg` (SVG sprite containing a **Bluesky butterfly glyph**) | shipped with viewer, **but no in-repo consumer found** (`grep icons.svg viewer/index.html viewer/src` → no references) | **UNVERIFIED — checked: full-repo grep for provenance/attribution, `git log viewer/public/icons.svg` (scaffold commit `9951d1d`), searched for a LICENSE/README attribution — none found.** The glyph is a third-party brand mark, not covered by an open-source license identified in this repo | *Consult human* (§10) |
| 6 | Scene fixtures: `public/scenes/fixture/*` (manifest, nav, semantic, quality JSON) and `public/scenes/glb-fixture/*` incl. `visual/architectural-fixture.glb` | tracked + copied to `dist/scenes/` | First-party, procedurally generated | `apps/studio/scripts/generate_glb_fixture.py` header: "genuine glTF 2.0 binary file made only from generated box geometry and local material colours … not a smartphone reconstruction"; companion `generate_scene_bundle.py` |
| 7 | `viewer/dev-assets/fixtures/SYNTHETIC/*` (`synthetic_room.ply` + JSON) | **dev/preview only** (`vite.config.ts`; README: "never ships in the production build") | First-party, procedurally generated | `viewer/dev-assets/fixtures/SYNTHETIC/README.txt`: "Generated by pipeline/make_demo_splat.py. NOT a reconstruction" |

## 8. Test-only tooling and browsers

| # | Item | Version | Role | License | License source |
|---|---|---|---|---|---|
| 1 | `@playwright/test` / `playwright` / `playwright-core` | 1.64.1 | e2e tests only (`apps/studio/playwright.config.ts`, `browserName: 'chromium'`) | Apache-2.0 | `apps/studio/node_modules/@playwright/test/LICENSE` and `.../playwright/LICENSE` (Apache 2.0 text read) |
| 2 | Playwright browser: `chromium-1243`, `chromium-1248` | per cache dir | Test-only, **not in the repo** (`~/Library/Caches/ms-playwright`) | **UNVERIFIED — checked: `find ~/Library/Caches/ms-playwright/chromium-1248 -maxdepth 3 -iname '*license*' -o -iname '*copying*'` → no matches; only `INSTALLATION_COMPLETE`/`DEPENDENCIES_VALIDATED` present.** (Chromium upstream is BSD-3-Clause with many vendored components, but no local license text was found to cite.) | *Not redistributed → low risk; flagged for completeness* |
| 3 | Playwright browser: `chromium_headless_shell-1243`, `chromium_headless_shell-1248` | per cache dir | Test-only, not in the repo | **UNVERIFIED — same check as #2, no license file found** | — |
| 4 | Playwright `ffmpeg-1011`, `ffmpeg-1013` | per cache dir | Test-only video recording for Playwright; not in the repo | **LGPL-2.1+ file present**: `~/Library/Caches/ms-playwright/ffmpeg-1013/COPYING.LGPLv2.1` (listed; full text not read) | local file listing |
| 5 | `vitest` (+ `@vitest/*`, `chai`, `tinybench`, …) | 5.0.5 tree | Unit-test runner | MIT (and MIT-family) | `apps/studio/node_modules/vitest/LICENSE.md`; Appendix A |
| 6 | `pytest` stack | see §5 | Python tests | MIT/BSD/Apache-family | §5 |

## 9. Model weights and datasets — **none ship**

- Search for weight formats (`.pth .pt .onnx .safetensors .ckpt .h5 .tflite .npz` plus >2 MB files outside `node_modules`) returns **no model weights anywhere in the repo**. The only `*.bin` hits are COLMAP sparse-reconstruction outputs under `work/captures/**` (`cameras.bin`, `images.bin`, `points3D.bin`…) — **`work/` is gitignored, never committed, not model weights**, and are runtime artifacts of COLMAP, not third-party data.
- **No training ever ran** on real photos: `docs/SUBMISSION_ROUND1.md:75` ("Real splat / trained scene — Does not exist"), so no trained checkpoint exists to declare.
- External references (hosted outside the repo, not distributed by us):
  - `viewer/public/models/scene.json` → `https://huggingface.co/datasets/Ojas-CoderAI/namma-space-splats/resolve/main/synthetic_room.ply` — **defaults to the synthetic room fixture** (`pipeline/make_demo_splat.py`), badged `SYNTHETIC` in the viewer.
  - `viewer/public/scenes/synthetic.json` → `huggingface.co/datasets/Ojas-CoderAI/namma-space-splats/.../synthetic_room.ply` — **our own procedurally generated fixture** (`pipeline/make_demo_splat.py`), labelled `SYNTHETIC` in the UI. No third-party dataset or pretrained weights involved.
- Conclusion: **no third-party datasets or model weights are included in, or required by, the release.** If a real trained splat is uploaded to Hugging Face before submission, re-run this check (it would still be first-party capture data, but the statement should be re-verified).

---

## 10. License obligations that matter for the submission (conservative reading)

**a) Shipped JS bundles — permissive only, attribution required.**
Both apps' bundles contain MIT/ISC/BSD-3-Clause code (viewer: MIT ×18 + BSD-3; studio: MIT/ISC + type-only BSD). These licenses are permissive, **not copyleft** — nothing "infects" our source. But MIT/BSD/Apache all require that *the copyright notice and permission notice be included in all copies or substantial portions of the software*; a browser receiving `dist/assets/*.js` does receive a copy. The minified chunks do **not** currently embed license texts.
→ **Action: include this file (and ideally an in-app "Credits/Licenses" view or `/licenses` route) with the submission/deploy.** *Flag: human decision on adding an in-app credits page before the deadline.*

**b) GPL boundary — accurate and conservative statement.**
- **ffmpeg (GPL-3.0-or-later build)** and **COLMAP (BSD-3-Clause for COLMAP itself; its Homebrew dependency tree is separately licensed, per its own `COPYING.txt`)** are used *only on the development machine*, invoked as separate executables from our Python pipeline, and are **not distributed** in the repo or the web demo (verified: `git ls-files` → 0 entries under `tools/`, `dist/`, `.venv/`; Homebrew installs live outside the repo). Running them and consuming their outputs (camera poses, extracted frames) is *use/aggregation*, not creation of a derivative work — **no copyleft obligation attaches to our Python scripts, our TypeScript, or the browser bundle.**
- **Do not** bundle an ffmpeg binary (or a COLMAP binary without its `COPYING.txt`) into any submission ZIP or installer — that would trigger GPLv3 distribution obligations (source availability etc.) for the ffmpeg binary. If a judge machine needs it, link to the Homebrew/apt package instead. *If the submission package would include any of these binaries: consult human.*
- Verified: **no GPL/LGPL/MPL code is present in either shipped web bundle** (bundle licenses are MIT/ISC/BSD; the only non-permissive dev-only license, MPL-2.0 lightningcss, is a build tool in `viewer`'s dev tree).

**c) Apache-2.0 components** (Brush 0.3.0, opencv-python-headless, Playwright, TypeScript, plus 20 dev packages): permissive; obligations are *retain license text*, *state changes*, and *preserve NOTICE files* if redistributing. We do not redistribute Brush/Playwright/OpenCV (not tracked / system-installed); Brush's `LICENSE` already sits beside the binary in `tools/` should that ever be zipped. No `NOTICE` file was found for Brush. Low risk.

**d) GSAP Standard "No Charge" License (custom, non-OSI)** — `gsap` 3.15.0 and `@gsap/react` 2.1.2 are declared in `apps/studio/package.json` but **verified absent from every built chunk** (`check_chunks.py` → `[EXCEPT] gsap → imported nowhere in the bundle`). Therefore no GSAP code is being distributed and no live obligation exists today. Terms (fetched 2026-10-30, effective 2025-04-30): permitted = use on websites/web apps (including commercial); must not remove proprietary notices; prohibited = use in no-code animation builders competing with Webflow. If GSAP is wired in later (the planned `import('gsap')` in `src/motion/index.ts`), credit GSAP and keep its notices; commercial use is explicitly allowed. *Not legal advice; the license is custom — consult human before any use outside a normal website/app.*

**e) SIL OFL 1.1 fonts** — we **distribute** the Archivo and IBM Plex Mono subsets, which is expressly permitted; conditions are (i) keep the copyright notice and license with the fonts — **satisfied**: `OFL-Archivo.txt`, `OFL-IBMPlexMono.txt`, `OFL-note.md` ship in the same directory as the woff2 files; (ii) don't sell the fonts alone; (iii) renamed derivatives carry a different reserved name (we did not modify them). Compliant as built.

**f) MPL-2.0 (`lightningcss`, viewer dev tree)** — file-level copyleft, applies to the tool's own source, not its output; the tool is not distributed. No obligation. Re-check only if `node_modules` is ever shipped.

**g) CC-BY-4.0 (`caniuse-lite`, dev-only)** — attribution license; not in any bundle, not distributed → no action beyond this record.

**h) Brand asset: Bluesky glyph in `viewer/public/icons.svg`** — **UNVERIFIED** (§7 row 5). Trademark/brand-guideline territory rather than an OSS license, and the sprite appears unreferenced. Options: remove it, or confirm usage against Bluesky's brand guidelines. *Consult human; trivial to fix, lowest-priority flag.*

**i) Uncertain / consult-human summary:** (1) in-app license/credits surface for the shipped bundles (a); (2) confirm no binaries (ffmpeg/COLMAP) ride along in any submission archive (b); (3) GSAP if/when it is actually bundled (d); (4) Bluesky glyph (h); (5) if the team decides to publish the Homebrew COLMAP dependency tree or any system binary alongside the submission, licenses were not enumerated individually (§6).

---

## 11. Attribution text for the abstract / PoC (paste-ready)

```text
Open-source components used in Namma Space (full inventory: submission/THIRD_PARTY_NOTICES.md):
• three.js 0.186.1, PlayCanvas 2.23.3, React 19.3.1, zod 4.6.7, fflate 0.8.3, idb 8.0.4,
  qrcode-generator 2.0.4 — MIT/ISC (web bundle)
• viewer: @sparkjsdev/spark 2.4.0 and @react-three/fiber 9.8.2 — MIT (web bundle)
• COLMAP 4.2.1 — BSD 3-Clause (camera-pose reconstruction; run locally, not distributed)
• ffmpeg 9.0.2 (Homebrew build, GPL-3.0) — video frame extraction; run locally, not distributed
• Brush 0.3.0 — Apache-2.0 (Gaussian-splatting trainer; run locally, not distributed)
• @playcanvas/splat-transform 3.10.3 — MIT (splat compression for the web)
• NumPy 2.5.4 — BSD-3-Clause; OpenCV (opencv-python-headless) 5.0.0.93 — Apache-2.0 (pipeline)
• Archivo and IBM Plex Mono webfonts — SIL Open Font License 1.1 (self-hosted, license texts shipped)
• Playwright 1.64.1 — Apache-2.0 (testing only)
No GPL code is included in the shipped web bundle; no third-party model weights or datasets are
distributed with this release. Details, versions and license-file paths: submission/THIRD_PARTY_NOTICES.md.
```

---

## 12. Verification spot-checks (re-run on 2026-10-30; outputs pasted verbatim)

| # | Command | Output |
|---|---|---|
| 1 | `cd apps/studio && node -p "JSON.parse(require('fs').readFileSync('node_modules/three/package.json','utf8')).version"` | `0.186.1` |
| 2 | `.venv/bin/python -m pip show numpy opencv-python-headless \| grep -E "^(Name\|Version\|License):"` | `Name: numpy / Version: 2.5.4`; `Name: opencv-python-headless / Version: 5.0.0.93 / License: Apache 2.0` |
| 3 | `colmap -h \| head -1` | `COLMAP 4.2.1 (Commit Unknown on Unknown without GPU support, std hash maps)` |
| 4 | `ffmpeg -version \| head -1` (+ `configuration:` line) | `ffmpeg version 9.0.2 Copyright (c) 2000-2026 the FFmpeg developers` — config contains `--enable-version3 --enable-gpl --enable-libx264 --enable-libx265 …` |
| 5 | `tools/brush-app-aarch64-apple-darwin/brush_app --version` | `brush-cli 0.3.0` |
| 6 | `node -e` over `tools/splat-transform/node_modules/@playcanvas/splat-transform/package.json` | `3.10.3 MIT` |
| 7 | `cd apps/studio && npx playwright --version` | `Version 1.64.1` |
| 8 | `.venv/bin/python apps/studio/scripts/check_chunks.py` | `Entry chunk: index-CY1ys4oe.js — 448455 B raw / 139805 B gzip`; `[LAZY] fflate → browser-Cgug2DPz.js`; `[EXCEPT] gsap → imported nowhere in the bundle`; `[LAZY] idb → index-V7xXUF1b.js`; `[LAZY] playcanvas → PlayCanvasViewer-BbhGi6Qi.js`; `[LAZY] qrcode-generator → qrcode-5IewWFXk.js`; `[LAZY] three → three.module-Dljb2UHm.js`; `[PASS] chunk check` (exit 0) |
| 9 | `brew info --json=v2 colmap / ffmpeg` (license fields) | `colmap 4.2.1 "BSD-3-Clause"`; `ffmpeg 9.0.2 "GPL-3.0-or-later"` — both corroborated by local files (`COPYING.txt`, `LICENSE.md`) |
| 10 | `.venv/bin/python -m pip list --format=freeze` | 8 packages: `iniconfig==2.3.1, numpy==2.5.4, opencv_python_headless==5.0.0.93, packaging==26.3, pip==26.2.2, pluggy==1.7.0, Pygments==2.21.0, pytest==9.2.0` |

---

## Appendix A — Complete `apps/studio` lockfile inventory (262 entries: 14 runtime + 248 dev)


| # | Package | Version | License (lockfile field) | Role |
|---|---|---|---|---|
| 1 | `@gsap/react` | 2.1.2 | SEE LICENSE AT https://gsap.com/standard-license | runtime |
| 2 | `@types/webxr` | 0.5.24 | MIT | runtime |
| 3 | `@webgpu/types` | 0.1.74 | BSD-3-Clause | runtime |
| 4 | `fflate` | 0.8.3 | MIT | runtime |
| 5 | `gsap` | 3.15.0 | Standard 'no charge' license: https://gsap.com/standard-license. | runtime |
| 6 | `idb` | 8.0.4 | ISC | runtime |
| 7 | `playcanvas` | 2.23.3 | MIT | runtime |
| 8 | `qrcode-generator` | 2.0.4 | MIT | runtime |
| 9 | `react` | 19.3.1 | MIT | runtime |
| 10 | `react-dom` | 19.3.1 | MIT | runtime |
| 11 | `scheduler` | 0.28.0 | MIT | runtime |
| 12 | `three` | 0.186.1 | MIT | runtime |
| 13 | `ws` | 8.22.0 | MIT | runtime |
| 14 | `zod` | 4.6.7 | MIT | runtime |
| 15 | `@babel/code-frame` | 7.29.7 | MIT | dev-only |
| 16 | `@babel/compat-data` | 7.29.7 | MIT | dev-only |
| 17 | `@babel/core` | 7.29.7 | MIT | dev-only |
| 18 | `@babel/generator` | 7.29.8 | MIT | dev-only |
| 19 | `@babel/helper-compilation-targets` | 7.29.7 | MIT | dev-only |
| 20 | `@babel/helper-globals` | 7.29.7 | MIT | dev-only |
| 21 | `@babel/helper-module-imports` | 7.29.7 | MIT | dev-only |
| 22 | `@babel/helper-module-transforms` | 7.29.7 | MIT | dev-only |
| 23 | `@babel/helper-plugin-utils` | 7.29.7 | MIT | dev-only |
| 24 | `@babel/helper-string-parser` | 7.29.11 | MIT | dev-only |
| 25 | `@babel/helper-validator-identifier` | 7.29.7 | MIT | dev-only |
| 26 | `@babel/helper-validator-option` | 7.29.7 | MIT | dev-only |
| 27 | `@babel/helpers` | 7.29.10 | MIT | dev-only |
| 28 | `@babel/parser` | 7.29.11 | MIT | dev-only |
| 29 | `@babel/plugin-transform-react-jsx-self` | 7.29.7 | MIT | dev-only |
| 30 | `@babel/plugin-transform-react-jsx-source` | 7.29.7 | MIT | dev-only |
| 31 | `@babel/template` | 7.29.7 | MIT | dev-only |
| 32 | `@babel/traverse` | 7.29.10 | MIT | dev-only |
| 33 | `@babel/types` | 7.29.11 | MIT | dev-only |
| 34 | `@dimforge/rapier3d-compat` | 0.12.0 | Apache-2.0 | dev-only |
| 35 | `@esbuild/aix-ppc64` | 0.28.2 | MIT | dev-only |
| 36 | `@esbuild/android-arm` | 0.28.2 | MIT | dev-only |
| 37 | `@esbuild/android-arm64` | 0.28.2 | MIT | dev-only |
| 38 | `@esbuild/android-x64` | 0.28.2 | MIT | dev-only |
| 39 | `@esbuild/darwin-arm64` | 0.28.2 | MIT | dev-only |
| 40 | `@esbuild/darwin-x64` | 0.28.2 | MIT | dev-only |
| 41 | `@esbuild/freebsd-arm64` | 0.28.2 | MIT | dev-only |
| 42 | `@esbuild/freebsd-x64` | 0.28.2 | MIT | dev-only |
| 43 | `@esbuild/linux-arm` | 0.28.2 | MIT | dev-only |
| 44 | `@esbuild/linux-arm64` | 0.28.2 | MIT | dev-only |
| 45 | `@esbuild/linux-ia32` | 0.28.2 | MIT | dev-only |
| 46 | `@esbuild/linux-loong64` | 0.28.2 | MIT | dev-only |
| 47 | `@esbuild/linux-mips64el` | 0.28.2 | MIT | dev-only |
| 48 | `@esbuild/linux-ppc64` | 0.28.2 | MIT | dev-only |
| 49 | `@esbuild/linux-riscv64` | 0.28.2 | MIT | dev-only |
| 50 | `@esbuild/linux-s390x` | 0.28.2 | MIT | dev-only |
| 51 | `@esbuild/linux-x64` | 0.28.2 | MIT | dev-only |
| 52 | `@esbuild/netbsd-arm64` | 0.28.2 | MIT | dev-only |
| 53 | `@esbuild/netbsd-x64` | 0.28.2 | MIT | dev-only |
| 54 | `@esbuild/openbsd-arm64` | 0.28.2 | MIT | dev-only |
| 55 | `@esbuild/openbsd-x64` | 0.28.2 | MIT | dev-only |
| 56 | `@esbuild/openharmony-arm64` | 0.28.2 | MIT | dev-only |
| 57 | `@esbuild/sunos-x64` | 0.28.2 | MIT | dev-only |
| 58 | `@esbuild/win32-arm64` | 0.28.2 | MIT | dev-only |
| 59 | `@esbuild/win32-ia32` | 0.28.2 | MIT | dev-only |
| 60 | `@esbuild/win32-x64` | 0.28.2 | MIT | dev-only |
| 61 | `@eslint-community/eslint-utils` | 4.10.1 | MIT | dev-only |
| 62 | `@eslint-community/regexpp` | 4.12.2 | MIT | dev-only |
| 63 | `@eslint/config-array` | 0.21.2 | Apache-2.0 | dev-only |
| 64 | `@eslint/config-helpers` | 0.4.2 | Apache-2.0 | dev-only |
| 65 | `@eslint/core` | 0.17.0 | Apache-2.0 | dev-only |
| 66 | `@eslint/eslintrc` | 3.3.7 | MIT | dev-only |
| 67 | `@eslint/js` | 9.39.5 | MIT | dev-only |
| 68 | `@eslint/object-schema` | 2.1.7 | Apache-2.0 | dev-only |
| 69 | `@eslint/plugin-kit` | 0.4.1 | Apache-2.0 | dev-only |
| 70 | `@humanfs/core` | 0.19.2 | Apache-2.0 | dev-only |
| 71 | `@humanfs/node` | 0.16.8 | Apache-2.0 | dev-only |
| 72 | `@humanfs/types` | 0.15.0 | Apache-2.0 | dev-only |
| 73 | `@humanwhocodes/module-importer` | 1.0.1 | Apache-2.0 | dev-only |
| 74 | `@humanwhocodes/retry` | 0.4.3 | Apache-2.0 | dev-only |
| 75 | `@jridgewell/gen-mapping` | 0.3.13 | MIT | dev-only |
| 76 | `@jridgewell/remapping` | 2.3.5 | MIT | dev-only |
| 77 | `@jridgewell/resolve-uri` | 3.1.2 | MIT | dev-only |
| 78 | `@jridgewell/sourcemap-codec` | 1.6.0 | MIT | dev-only |
| 79 | `@jridgewell/trace-mapping` | 0.3.31 | MIT | dev-only |
| 80 | `@napi-rs/lzma-linux-x64-gnu` | 1.5.1 | MIT | dev-only |
| 81 | `@playwright/test` | 1.64.1 | Apache-2.0 | dev-only |
| 82 | `@rolldown/pluginutils` | 1.0.0-rc.3 | MIT | dev-only |
| 83 | `@rollup/rollup-android-arm-eabi` | 4.65.0 | MIT | dev-only |
| 84 | `@rollup/rollup-android-arm64` | 4.65.0 | MIT | dev-only |
| 85 | `@rollup/rollup-darwin-arm64` | 4.65.0 | MIT | dev-only |
| 86 | `@rollup/rollup-darwin-x64` | 4.65.0 | MIT | dev-only |
| 87 | `@rollup/rollup-freebsd-arm64` | 4.65.0 | MIT | dev-only |
| 88 | `@rollup/rollup-freebsd-x64` | 4.65.0 | MIT | dev-only |
| 89 | `@rollup/rollup-linux-arm-gnueabihf` | 4.65.0 | MIT | dev-only |
| 90 | `@rollup/rollup-linux-arm-musleabihf` | 4.65.0 | MIT | dev-only |
| 91 | `@rollup/rollup-linux-arm64-gnu` | 4.65.0 | MIT | dev-only |
| 92 | `@rollup/rollup-linux-arm64-musl` | 4.65.0 | MIT | dev-only |
| 93 | `@rollup/rollup-linux-loong64-gnu` | 4.65.0 | MIT | dev-only |
| 94 | `@rollup/rollup-linux-loong64-musl` | 4.65.0 | MIT | dev-only |
| 95 | `@rollup/rollup-linux-ppc64-gnu` | 4.65.0 | MIT | dev-only |
| 96 | `@rollup/rollup-linux-ppc64-musl` | 4.65.0 | MIT | dev-only |
| 97 | `@rollup/rollup-linux-riscv64-gnu` | 4.65.0 | MIT | dev-only |
| 98 | `@rollup/rollup-linux-riscv64-musl` | 4.65.0 | MIT | dev-only |
| 99 | `@rollup/rollup-linux-s390x-gnu` | 4.65.0 | MIT | dev-only |
| 100 | `@rollup/rollup-linux-x64-gnu` | 4.65.0 | MIT | dev-only |
| 101 | `@rollup/rollup-linux-x64-musl` | 4.65.0 | MIT | dev-only |
| 102 | `@rollup/rollup-openbsd-x64` | 4.65.0 | MIT | dev-only |
| 103 | `@rollup/rollup-openharmony-arm64` | 4.65.0 | MIT | dev-only |
| 104 | `@rollup/rollup-win32-arm64-msvc` | 4.65.0 | MIT | dev-only |
| 105 | `@rollup/rollup-win32-ia32-msvc` | 4.65.0 | MIT | dev-only |
| 106 | `@rollup/rollup-win32-x64-gnu` | 4.65.0 | MIT | dev-only |
| 107 | `@rollup/rollup-win32-x64-msvc` | 4.65.0 | MIT | dev-only |
| 108 | `@tweenjs/tween.js` | 23.1.3 | MIT | dev-only |
| 109 | `@types/babel__core` | 7.20.5 | MIT | dev-only |
| 110 | `@types/babel__generator` | 7.27.0 | MIT | dev-only |
| 111 | `@types/babel__template` | 7.4.4 | MIT | dev-only |
| 112 | `@types/babel__traverse` | 7.28.0 | MIT | dev-only |
| 113 | `@types/chai` | 5.2.3 | MIT | dev-only |
| 114 | `@types/deep-eql` | 4.0.2 | MIT | dev-only |
| 115 | `@types/estree` | 1.0.9 | MIT | dev-only |
| 116 | `@types/json-schema` | 7.0.15 | MIT | dev-only |
| 117 | `@types/node` | 26.6.5 | MIT | dev-only |
| 118 | `@types/react` | 19.3.0 | MIT | dev-only |
| 119 | `@types/react-dom` | 19.3.0 | MIT | dev-only |
| 120 | `@types/stats.js` | 0.17.4 | MIT | dev-only |
| 121 | `@types/three` | 0.186.0 | MIT | dev-only |
| 122 | `@typescript-eslint/eslint-plugin` | 8.72.0 | MIT | dev-only |
| 123 | `@typescript-eslint/parser` | 8.72.0 | MIT | dev-only |
| 124 | `@typescript-eslint/project-service` | 8.72.0 | MIT | dev-only |
| 125 | `@typescript-eslint/scope-manager` | 8.72.0 | MIT | dev-only |
| 126 | `@typescript-eslint/tsconfig-utils` | 8.72.0 | MIT | dev-only |
| 127 | `@typescript-eslint/type-utils` | 8.72.0 | MIT | dev-only |
| 128 | `@typescript-eslint/types` | 8.72.0 | MIT | dev-only |
| 129 | `@typescript-eslint/typescript-estree` | 8.72.0 | MIT | dev-only |
| 130 | `@typescript-eslint/utils` | 8.72.0 | MIT | dev-only |
| 131 | `@typescript-eslint/visitor-keys` | 8.72.0 | MIT | dev-only |
| 132 | `@vitejs/plugin-basic-ssl` | 2.3.0 | MIT | dev-only |
| 133 | `@vitejs/plugin-react` | 5.2.0 | MIT | dev-only |
| 134 | `@vitest/mocker` | 5.0.5 | MIT | dev-only |
| 135 | `@vitest/spy` | 5.0.5 | MIT | dev-only |
| 136 | `acorn` | 8.19.0 | MIT | dev-only |
| 137 | `acorn-jsx` | 5.3.2 | MIT | dev-only |
| 138 | `ajv` | 6.15.0 | MIT | dev-only |
| 139 | `ansi-styles` | 4.3.0 | MIT | dev-only |
| 140 | `argparse` | 2.0.1 | Python-2.0 | dev-only |
| 141 | `assertion-error` | 2.0.1 | MIT | dev-only |
| 142 | `balanced-match` | 4.0.4 | MIT | dev-only |
| 143 | `balanced-match` | 1.0.2 | MIT | dev-only |
| 144 | `baseline-browser-mapping` | 2.11.32 | Apache-2.0 | dev-only |
| 145 | `brace-expansion` | 5.0.12 | MIT | dev-only |
| 146 | `brace-expansion` | 1.1.21 | MIT | dev-only |
| 147 | `browserslist` | 4.29.4 | MIT | dev-only |
| 148 | `callsites` | 3.1.0 | MIT | dev-only |
| 149 | `caniuse-lite` | 1.0.30001819 | CC-BY-4.0 | dev-only |
| 150 | `chai` | 6.3.0 | MIT | dev-only |
| 151 | `chalk` | 4.1.2 | MIT | dev-only |
| 152 | `color-convert` | 2.0.1 | MIT | dev-only |
| 153 | `color-name` | 1.1.4 | MIT | dev-only |
| 154 | `concat-map` | 0.0.1 | MIT | dev-only |
| 155 | `convert-source-map` | 2.0.0 | MIT | dev-only |
| 156 | `cross-spawn` | 7.0.6 | MIT | dev-only |
| 157 | `csstype` | 3.2.3 | MIT | dev-only |
| 158 | `debug` | 4.4.3 | MIT | dev-only |
| 159 | `deep-is` | 0.1.4 | MIT | dev-only |
| 160 | `electron-to-chromium` | 1.5.464 | ISC | dev-only |
| 161 | `es-module-lexer` | 2.3.2 | MIT | dev-only |
| 162 | `esbuild` | 0.28.2 | MIT | dev-only |
| 163 | `escalade` | 3.2.0 | MIT | dev-only |
| 164 | `escape-string-regexp` | 4.0.0 | MIT | dev-only |
| 165 | `eslint` | 9.39.5 | MIT | dev-only |
| 166 | `eslint-plugin-react-hooks` | 6.1.1 | MIT | dev-only |
| 167 | `eslint-plugin-react-refresh` | 0.4.26 | MIT | dev-only |
| 168 | `eslint-scope` | 8.4.0 | BSD-2-Clause | dev-only |
| 169 | `eslint-visitor-keys` | 3.4.3 | Apache-2.0 | dev-only |
| 170 | `eslint-visitor-keys` | 5.0.1 | Apache-2.0 | dev-only |
| 171 | `eslint-visitor-keys` | 4.2.1 | Apache-2.0 | dev-only |
| 172 | `espree` | 10.4.0 | BSD-2-Clause | dev-only |
| 173 | `esquery` | 1.7.0 | BSD-3-Clause | dev-only |
| 174 | `esrecurse` | 4.3.0 | BSD-2-Clause | dev-only |
| 175 | `estraverse` | 5.3.0 | BSD-2-Clause | dev-only |
| 176 | `estree-walker` | 3.0.3 | MIT | dev-only |
| 177 | `esutils` | 2.0.3 | BSD-2-Clause | dev-only |
| 178 | `expect-type` | 1.4.0 | Apache-2.0 | dev-only |
| 179 | `fast-deep-equal` | 3.1.3 | MIT | dev-only |
| 180 | `fast-json-stable-stringify` | 2.1.0 | MIT | dev-only |
| 181 | `fast-levenshtein` | 2.0.6 | MIT | dev-only |
| 182 | `fdir` | 6.5.0 | MIT | dev-only |
| 183 | `file-entry-cache` | 8.0.0 | MIT | dev-only |
| 184 | `find-up` | 5.0.0 | MIT | dev-only |
| 185 | `flat-cache` | 4.0.1 | MIT | dev-only |
| 186 | `flatted` | 3.4.4 | ISC | dev-only |
| 187 | `fsevents` | 2.3.3 | MIT | dev-only |
| 188 | `gensync` | 1.0.0-beta.2 | MIT | dev-only |
| 189 | `glob-parent` | 6.0.2 | ISC | dev-only |
| 190 | `globals` | 14.0.0 | MIT | dev-only |
| 191 | `globals` | 16.5.0 | MIT | dev-only |
| 192 | `has-flag` | 4.0.0 | MIT | dev-only |
| 193 | `ignore` | 7.0.14 | MIT | dev-only |
| 194 | `ignore` | 5.3.2 | MIT | dev-only |
| 195 | `import-fresh` | 3.3.1 | MIT | dev-only |
| 196 | `imurmurhash` | 0.1.4 | MIT | dev-only |
| 197 | `is-extglob` | 2.1.1 | MIT | dev-only |
| 198 | `is-glob` | 4.0.3 | MIT | dev-only |
| 199 | `isexe` | 2.0.0 | ISC | dev-only |
| 200 | `js-tokens` | 4.0.0 | MIT | dev-only |
| 201 | `js-yaml` | 4.3.2 | MIT | dev-only |
| 202 | `jsesc` | 3.1.0 | MIT | dev-only |
| 203 | `json-buffer` | 3.0.1 | MIT | dev-only |
| 204 | `json-schema-traverse` | 0.4.1 | MIT | dev-only |
| 205 | `json-stable-stringify-without-jsonify` | 1.0.1 | MIT | dev-only |
| 206 | `json5` | 2.2.3 | MIT | dev-only |
| 207 | `keyv` | 4.5.4 | MIT | dev-only |
| 208 | `levn` | 0.4.1 | MIT | dev-only |
| 209 | `locate-path` | 6.0.0 | MIT | dev-only |
| 210 | `lodash.merge` | 4.6.2 | MIT | dev-only |
| 211 | `lru-cache` | 5.1.1 | ISC | dev-only |
| 212 | `magic-string` | 1.4.4 | MIT | dev-only |
| 213 | `meshoptimizer` | 1.1.1 | MIT | dev-only |
| 214 | `minimatch` | 10.2.6 | BlueOak-1.0.0 | dev-only |
| 215 | `minimatch` | 3.1.5 | ISC | dev-only |
| 216 | `ms` | 2.1.3 | MIT | dev-only |
| 217 | `nanoid` | 3.3.20 | MIT | dev-only |
| 218 | `natural-compare` | 1.4.0 | MIT | dev-only |
| 219 | `node-releases` | 2.0.60 | MIT | dev-only |
| 220 | `obug` | 3.0.0 | MIT | dev-only |
| 221 | `optionator` | 0.9.4 | MIT | dev-only |
| 222 | `p-limit` | 3.1.0 | MIT | dev-only |
| 223 | `p-locate` | 5.0.0 | MIT | dev-only |
| 224 | `parent-module` | 1.0.1 | MIT | dev-only |
| 225 | `path-exists` | 4.0.0 | MIT | dev-only |
| 226 | `path-key` | 3.1.1 | MIT | dev-only |
| 227 | `picocolors` | 1.1.1 | ISC | dev-only |
| 228 | `picomatch` | 4.0.7 | MIT | dev-only |
| 229 | `playwright` | 1.64.1 | Apache-2.0 | dev-only |
| 230 | `playwright-core` | 1.64.1 | Apache-2.0 | dev-only |
| 231 | `postcss` | 8.5.31 | MIT | dev-only |
| 232 | `prelude-ls` | 1.2.1 | MIT | dev-only |
| 233 | `punycode` | 2.3.1 | MIT | dev-only |
| 234 | `react-refresh` | 0.18.0 | MIT | dev-only |
| 235 | `resolve-from` | 4.0.0 | MIT | dev-only |
| 236 | `rollup` | 4.65.0 | MIT | dev-only |
| 237 | `semver` | 7.8.5 | ISC | dev-only |
| 238 | `semver` | 6.3.1 | ISC | dev-only |
| 239 | `shebang-command` | 2.0.0 | MIT | dev-only |
| 240 | `shebang-regex` | 3.0.0 | MIT | dev-only |
| 241 | `source-map-js` | 1.2.2 | BSD-3-Clause | dev-only |
| 242 | `std-env` | 4.3.0 | MIT | dev-only |
| 243 | `strip-json-comments` | 3.1.1 | MIT | dev-only |
| 244 | `supports-color` | 7.2.0 | MIT | dev-only |
| 245 | `tinybench` | 6.2.2 | MIT | dev-only |
| 246 | `tinyexec` | 1.3.1 | MIT | dev-only |
| 247 | `tinyglobby` | 0.2.17 | MIT | dev-only |
| 248 | `ts-api-utils` | 2.5.0 | MIT | dev-only |
| 249 | `type-check` | 0.4.0 | MIT | dev-only |
| 250 | `typescript` | 5.9.3 | Apache-2.0 | dev-only |
| 251 | `typescript-eslint` | 8.72.0 | MIT | dev-only |
| 252 | `undici-types` | 8.9.0 | MIT | dev-only |
| 253 | `update-browserslist-db` | 1.3.4 | MIT | dev-only |
| 254 | `uri-js` | 4.4.1 | BSD-2-Clause | dev-only |
| 255 | `vite` | 7.3.7 | MIT | dev-only |
| 256 | `vitest` | 5.0.5 | MIT | dev-only |
| 257 | `which` | 2.0.2 | ISC | dev-only |
| 258 | `why-is-node-running` | 3.2.1 | MIT | dev-only |
| 259 | `word-wrap` | 1.2.5 | MIT | dev-only |
| 260 | `yallist` | 3.1.1 | ISC | dev-only |
| 261 | `yocto-queue` | 0.1.0 | MIT | dev-only |
| 262 | `zod-validation-error` | 4.0.2 | MIT | dev-only |

_262 entries (14 runtime, 248 dev-only). Source: `apps/studio/package-lock.json`, key `packages[*].{version,license,dev}`._


## Appendix B — Complete `viewer` lockfile inventory (90 entries: 19 runtime + 71 dev)


| # | Package | Version | License (lockfile field) | Role |
|---|---|---|---|---|
| 1 | `@babel/runtime` | 7.29.10 | MIT | runtime |
| 2 | `@react-three/fiber` | 9.8.2 | MIT | runtime |
| 3 | `@sparkjsdev/spark` | 2.4.0 | MIT | runtime |
| 4 | `@types/react` | 19.3.0 | MIT | runtime |
| 5 | `@types/react-reconciler` | 0.28.9 | MIT | runtime |
| 6 | `@types/webxr` | 0.5.24 | MIT | runtime |
| 7 | `base64-js` | 1.5.1 | MIT | runtime |
| 8 | `buffer` | 6.0.3 | MIT | runtime |
| 9 | `csstype` | 3.2.3 | MIT | runtime |
| 10 | `ieee754` | 1.2.1 | BSD-3-Clause | runtime |
| 11 | `its-fine` | 2.1.1 | MIT | runtime |
| 12 | `react` | 19.3.1 | MIT | runtime |
| 13 | `react-dom` | 19.3.1 | MIT | runtime |
| 14 | `react-use-measure` | 2.1.7 | MIT | runtime |
| 15 | `scheduler` | 0.28.0 | MIT | runtime |
| 16 | `suspend-react` | 0.1.3 | MIT | runtime |
| 17 | `three` | 0.186.1 | MIT | runtime |
| 18 | `use-sync-external-store` | 1.7.0 | MIT | runtime |
| 19 | `zustand` | 5.0.15 | MIT | runtime |
| 20 | `@dimforge/rapier3d-compat` | 0.12.0 | Apache-2.0 | dev-only |
| 21 | `@oxc-project/types` | 0.155.0 | MIT | dev-only |
| 22 | `@oxlint/binding-android-arm-eabi` | 1.89.0 | MIT | dev-only |
| 23 | `@oxlint/binding-android-arm64` | 1.89.0 | MIT | dev-only |
| 24 | `@oxlint/binding-darwin-arm64` | 1.89.0 | MIT | dev-only |
| 25 | `@oxlint/binding-darwin-x64` | 1.89.0 | MIT | dev-only |
| 26 | `@oxlint/binding-freebsd-x64` | 1.89.0 | MIT | dev-only |
| 27 | `@oxlint/binding-linux-arm-gnueabihf` | 1.89.0 | MIT | dev-only |
| 28 | `@oxlint/binding-linux-arm-musleabihf` | 1.89.0 | MIT | dev-only |
| 29 | `@oxlint/binding-linux-arm64-gnu` | 1.89.0 | MIT | dev-only |
| 30 | `@oxlint/binding-linux-arm64-musl` | 1.89.0 | MIT | dev-only |
| 31 | `@oxlint/binding-linux-ppc64-gnu` | 1.89.0 | MIT | dev-only |
| 32 | `@oxlint/binding-linux-riscv64-gnu` | 1.89.0 | MIT | dev-only |
| 33 | `@oxlint/binding-linux-riscv64-musl` | 1.89.0 | MIT | dev-only |
| 34 | `@oxlint/binding-linux-s390x-gnu` | 1.89.0 | MIT | dev-only |
| 35 | `@oxlint/binding-linux-x64-gnu` | 1.89.0 | MIT | dev-only |
| 36 | `@oxlint/binding-linux-x64-musl` | 1.89.0 | MIT | dev-only |
| 37 | `@oxlint/binding-openharmony-arm64` | 1.89.0 | MIT | dev-only |
| 38 | `@oxlint/binding-win32-arm64-msvc` | 1.89.0 | MIT | dev-only |
| 39 | `@oxlint/binding-win32-ia32-msvc` | 1.89.0 | MIT | dev-only |
| 40 | `@oxlint/binding-win32-x64-msvc` | 1.89.0 | MIT | dev-only |
| 41 | `@rolldown/binding-android-arm-eabi` | 1.2.15 | MIT | dev-only |
| 42 | `@rolldown/binding-android-arm64` | 1.2.15 | MIT | dev-only |
| 43 | `@rolldown/binding-darwin-arm64` | 1.2.15 | MIT | dev-only |
| 44 | `@rolldown/binding-darwin-x64` | 1.2.15 | MIT | dev-only |
| 45 | `@rolldown/binding-freebsd-x64` | 1.2.15 | MIT | dev-only |
| 46 | `@rolldown/binding-linux-arm-gnueabihf` | 1.2.15 | MIT | dev-only |
| 47 | `@rolldown/binding-linux-arm64-gnu` | 1.2.15 | MIT | dev-only |
| 48 | `@rolldown/binding-linux-arm64-musl` | 1.2.15 | MIT | dev-only |
| 49 | `@rolldown/binding-linux-ppc64-gnu` | 1.2.15 | MIT | dev-only |
| 50 | `@rolldown/binding-linux-s390x-gnu` | 1.2.15 | MIT | dev-only |
| 51 | `@rolldown/binding-linux-x64-gnu` | 1.2.15 | MIT | dev-only |
| 52 | `@rolldown/binding-linux-x64-musl` | 1.2.15 | MIT | dev-only |
| 53 | `@rolldown/binding-openharmony-arm64` | 1.2.15 | MIT | dev-only |
| 54 | `@rolldown/binding-win32-arm64-msvc` | 1.2.15 | MIT | dev-only |
| 55 | `@rolldown/binding-win32-x64-msvc` | 1.2.15 | MIT | dev-only |
| 56 | `@rolldown/pluginutils` | 1.0.1 | MIT | dev-only |
| 57 | `@tweenjs/tween.js` | 23.1.3 | MIT | dev-only |
| 58 | `@types/node` | 24.19.2 | MIT | dev-only |
| 59 | `@types/react-dom` | 19.3.0 | MIT | dev-only |
| 60 | `@types/stats.js` | 0.17.4 | MIT | dev-only |
| 61 | `@types/three` | 0.186.0 | MIT | dev-only |
| 62 | `@vitejs/plugin-react` | 6.1.2 | MIT | dev-only |
| 63 | `detect-libc` | 2.1.2 | Apache-2.0 | dev-only |
| 64 | `fdir` | 6.5.0 | MIT | dev-only |
| 65 | `fflate` | 0.8.3 | MIT | dev-only |
| 66 | `fsevents` | 2.3.3 | MIT | dev-only |
| 67 | `lightningcss` | 1.33.0 | MPL-2.0 | dev-only |
| 68 | `lightningcss-android-arm64` | 1.33.0 | MPL-2.0 | dev-only |
| 69 | `lightningcss-darwin-arm64` | 1.33.0 | MPL-2.0 | dev-only |
| 70 | `lightningcss-darwin-x64` | 1.33.0 | MPL-2.0 | dev-only |
| 71 | `lightningcss-freebsd-x64` | 1.33.0 | MPL-2.0 | dev-only |
| 72 | `lightningcss-linux-arm-gnueabihf` | 1.33.0 | MPL-2.0 | dev-only |
| 73 | `lightningcss-linux-arm64-gnu` | 1.33.0 | MPL-2.0 | dev-only |
| 74 | `lightningcss-linux-arm64-musl` | 1.33.0 | MPL-2.0 | dev-only |
| 75 | `lightningcss-linux-x64-gnu` | 1.33.0 | MPL-2.0 | dev-only |
| 76 | `lightningcss-linux-x64-musl` | 1.33.0 | MPL-2.0 | dev-only |
| 77 | `lightningcss-win32-arm64-msvc` | 1.33.0 | MPL-2.0 | dev-only |
| 78 | `lightningcss-win32-x64-msvc` | 1.33.0 | MPL-2.0 | dev-only |
| 79 | `meshoptimizer` | 1.1.1 | MIT | dev-only |
| 80 | `nanoid` | 3.3.20 | MIT | dev-only |
| 81 | `oxlint` | 1.89.0 | MIT | dev-only |
| 82 | `picocolors` | 1.1.1 | ISC | dev-only |
| 83 | `picomatch` | 4.0.7 | MIT | dev-only |
| 84 | `postcss` | 8.5.31 | MIT | dev-only |
| 85 | `rolldown` | 1.2.15 | MIT | dev-only |
| 86 | `source-map-js` | 1.2.2 | BSD-3-Clause | dev-only |
| 87 | `tinyglobby` | 0.2.17 | MIT | dev-only |
| 88 | `typescript` | 6.0.3 | Apache-2.0 | dev-only |
| 89 | `undici-types` | 7.24.6 | MIT | dev-only |
| 90 | `vite` | 8.3.5 | MIT | dev-only |

_90 entries (19 runtime, 71 dev-only). Source: `viewer/package-lock.json`, key `packages[*].{version,license,dev}`._


## Appendix C — Complete `tools/splat-transform` install inventory (8 entries)


| # | Package | Version | License (lockfile field) | Role |
|---|---|---|---|---|
| 1 | `@adobe/spz` | 0.2.3 | ISC | runtime |
| 2 | `@playcanvas/splat-transform` | 3.10.3 | MIT | runtime |
| 3 | `@types/webxr` | 0.5.24 | MIT | runtime |
| 4 | `@webgpu/types` | 0.1.74 | BSD-3-Clause | runtime |
| 5 | `debug` | 4.4.3 | MIT | runtime |
| 6 | `ms` | 2.1.3 | MIT | runtime |
| 7 | `playcanvas` | 2.23.3 | MIT | runtime |
| 8 | `webgpu` | 0.6.2 | MIT | runtime |

_8 entries (8 runtime, 0 dev-only). Source: `tools/splat-transform/package-lock.json`, key `packages[*].{version,license,dev}`._

