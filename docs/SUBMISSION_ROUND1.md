# Namma Space — Round 1 submission package (index)

**Competition:** Techfest 2026-27, IIT Bombay — Round 1
**Deadline:** **31 Oct 2026** · **Branch:** `ashwinwork` · **This document:** verified
**29 Oct 2026** against the repository and the sprint logs (`logs/round1-rescue/`).

> **Honest headline.** The software is green and demonstrable end-to-end on synthetic
> content; the **real-capture → 3D reconstruction leg is blocked** with precise,
> reproducible evidence (blocker `BLK-001`), and **no real splat exists**. Everything
> below separates *demonstrated* from *blocked*; nothing is inflated.

---

## 1. What Namma Space is

Turn an ordinary phone capture of an indoor space into a photorealistic 3D model that
anyone can walk through in a browser, with no manual 3D modelling.

```
phone capture ──► ffmpeg + blur filter ──► COLMAP (camera poses) ──► Brush (3D Gaussian Splatting) ──► splat-transform ──► scene.sog
                        pipeline/run_pipeline.py                                                              │
                                                                                                              ▼
                            viewer/  React + TS + Vite + react-three-fiber + Spark ──► first-person WASD walkthrough
                            apps/studio/  Capture Studio · Live Scan phone pairing · PlayCanvas · POIs · A* routes (Round 2 groundwork)
```

Round 1 covers capture procedure, reconstruction, and free-roaming first-person
exploration. POIs, search and pathfinding exist as **synthetic-only** Round 2
groundwork in `apps/studio/`.

**Package contents (this repo):**

| Document | What it is |
|---|---|
| `README.md` | project overview, requirements, run instructions |
| `docs/ABSTRACT.md` | technical abstract source (→ PDF, max 5 pages) |
| `docs/CAPTURE_DAY.md` | the real-capture record: every run, every number |
| `docs/SUBMISSION_ROUND1.md` | this index: evidence, verification, limitations |
| `docs/SOP.md` · `docs/DEMO_SCRIPT.md` · `docs/HANDOFF_UJESHA.md` · `docs/PAIRING.md` | capture procedure, demo script, capture-machine handoff, pairing runbook |
| `logs/round1-rescue/` | append-only sprint logs: `EVENT_LOG`, `BLOCKERS`, `COMMANDS_AND_TESTS`, `DECISIONS`, `STATUS`, `HANDOFF` |

---

## 2. Demonstrated vs blocked (evidence table)

### 2.1 Demonstrated — verified by re-running the commands on 29 Oct 2026

| Claim | Evidence | Source |
|---|---|---|
| Unit suite green | **vitest 591/591, 32 files** | re-run 29 Oct (`npx vitest run`, `apps/studio/`) |
| Python suite green | **pytest 65/65** | re-run 29 Oct (`uv run --with pytest python -m pytest tests -q`) |
| Browser E2E green | **Playwright 28/28** | inside `npm run quality` (E2E step), re-run 29 Oct |
| Typecheck / lint | **0 errors** / 0 errors (6 known react-refresh warnings) | re-run 29 Oct |
| One-command quality gate | **10/10 checks, `GATE_EXIT=0`** (scene validation, production build, build benchmark, chunk budgets, reconstruction preflight, browser E2E, …) | `python3 scripts/quality_gate.py` in `apps/studio/`, re-run 29 Oct; introduced by T25 `1f3ddfa` |
| Scene bundles valid | **2/2 bundles PASS** | `npm run validate:scenes`, re-run 29 Oct; contract hardened by D2/D3 `d4acf04` |
| Bundle budgets held | entry chunk **139,693 B gzip vs 360 KB budget** (~220 KB headroom; re-measured per build); fflate/qrcode/idb/playcanvas/three chunk laziness **proven by marker evidence**, gsap honestly vacuous (not yet imported) | `apps/studio/benchmark/build-report.json`, `1f3ddfa` |
| Gate finds real bugs | quality-gate heuristic caught a **genuine object-URL leak** in Live Scan; fixed at source in the same cycle, guard promoted to green | `logs/round1-rescue/EVENT_LOG.md` 04:55 IST, `74a112b` |
| COLMAP 4.x compatibility | old `Sift*` flags rejected by COLMAP 4.2.1 → renamed `Feature*`, hermetic preflight test pins the contract | `7f4f060` |
| **Root cause of "2/73 unusable" found & fixed** | forced `OPENCV` camera model gave 2/70 (3 %); `SIMPLE_RADIAL` gives 40–59/70 on *identical* inputs → real photos now register **57 % instead of 3 %** | `a4299f5`, `logs/round1-rescue/EVENT_LOG.md` 03:12 IST |
| Studio ZIP capture-bundle ingest | Capture Studio ZIP → `scripts/prepare_capture.py` seam, 14 tests | `6a7654a` (Workstream C) |
| A* optimality fix | admissible octile heuristic for 8-connected grid, 13 tests | `6df7d8c` (D1) |
| Scene contract + integrity | enforced scene schema; URI policy + **sha256 verified in the browser via WebCrypto before load** | `d4acf04` (D2/D3) |
| Live Scan sender→receiver journey | `?pair=` entry, signalling, WebRTC chunked transfer with SHA-256 acks (nack+retry+timeout), ingest as `source:'phone'`; **mirrored-frame orientation bug fixed with red evidence** | `a56eaa1` (T21) |
| Coverage visualizer | three.js lazy chunk, honest unposed-frame markers, context-guard refusal, disposal proven (5 remounts → 0 live objects in node) | `74a112b` (T22) |
| Docs corrected against reality | README/ARCHITECTURE/DECISION_LOG/PIPELINE/PROJECT_STATE amendments + `docs/PAIRING.md` runbook | `b469fa8` (T26) |
| Real capture runs & fails honestly | all four gates enforced unchanged; two documented runs + one disclosed subset run; see `docs/CAPTURE_DAY.md` | `logs/round1-rescue/BLOCKERS.md` |
| Synthetic scene validated & walkable | synthetic fixture passes the scene validator (2/2) and is walkable in both viewers, permanently badged `SYNTHETIC` | `npm run validate:scenes` (re-run 29 Oct) |

### 2.2 Blocked or untested — stated as-is

| Item | Status | Evidence |
|---|---|---|
| **Real-capture reconstruction (BLK-001)** | **BLOCKED.** The 70-photo set registers **40/70 (57 %) in one connected model + a disconnected 17-image fragment**; gate needs 60 % (42 imgs). Points 2966 ✓ (≥2000), reprojection 0.92 px ✓ (≤1.5). Two independent runs produced the identical split → capture lacks doorway overlap. | `logs/round1-rescue/BLOCKERS.md`; `work/captures/room_run/report.json` (numbers copied into `docs/CAPTURE_DAY.md` — `work/` is git-ignored) |
| …and the best sub-region still fails quality | disclosed subset run (40-image component): registration 72 % ✓, **886 points < 2000 ✗** — WhatsApp 740×1600 JPEGs lack texture/parallax | BLK-001 amendment, `docs/CAPTURE_DAY.md` §3 |
| **Real splat / trained scene** | **Does not exist.** No training ever started on real photos (both runs exited at the SfM gate). Dense MVS needs CUDA. Brush v0.3.0 Apple Silicon binary is installed and sha256-verified — that is a binary check, not a trained scene. | `logs/round1-rescue/BLOCKERS.md` B-001, `EVENT_LOG.md` 03:00 IST |
| Real reconstruction screenshots / demo of a real room | **None.** Viewer demonstrations use the synthetic fixture, permanently badged `SYNTHETIC`. | `README.md` "Run the viewer" |
| Deployed viewer at a public URL | **Not done** for this submission; run locally (quickstart §5). | `README.md` Status |
| Demo video (3–5 min) | **Not recorded**; script is a skeleton that explicitly waits for a real reconstruction (`docs/DEMO_SCRIPT.md:3`). | — |
| Device-to-device pairing (Live Scan) | **Not hardware-tested.** Sender→receiver journey is wired and unit-tested; a *physical phone* completing QR → camera → datachannel → acks is an open checklist item. | `docs/PAIRING.md` "Manual / untested" checklist; `EVENT_LOG.md` 04:35 IST ("NOT claimed: device-to-device") |
| Accessibility / safety validation | **Not performed; not claimed.** | — |
| Browser frame-rate benchmarks | **Not claimed.** Pane measurements are unreliable on this hardware (`PROJECT_STATE.md` §11.10); the only hard perf numbers are build/bundle budgets (§2.1). | — |
| `kind: "sog"` rendering in the studio viewer | schema-accepted, **zero render consumers** — declared but unrendered. | `PROJECT_STATE.md` §11.5 |

---

## 3. BLK-001 verbatim summary

> **BLK-001 (2026-10-29 03:46 IST) — Real-capture set splits into two disconnected
> rooms.** The user's 70-photo WhatsApp capture cannot produce ONE connected
> reconstruction. Pipeline runs #2 and #3 (both after the SIMPLE_RADIAL camera-model
> fix) produced IDENTICAL topology: model 0 = 40/70 images (57 %), model 1 = 17/70
> images disconnected, 13 unregistered. Gate needs ≥60 % registration in the connected
> solution (42 imgs); honest fail, no threshold weakening. Root cause: capture overlap
> weakness at doorways between room halves — matches the pipeline's own remediation
> text. NOT a software defect (camera-model bug fixed in `a4299f5` was the larger
> defect: 3 % → 57 %). Impact: full-room splat training for this capture is blocked. …
> Amendment (03:49 IST): the disclosed 40-image subset run registers 29/40 (72 %) but
> triangulates only **886 < 2000** points — even the best-connected region of this
> capture is too poor. Resolution: re-shoot per capture SOP (native resolution ≥1080p,
> 60–70 % overlap, deliberate doorway traversal, video preferred).

Full text: `logs/round1-rescue/BLOCKERS.md`. Run-by-run detail: `docs/CAPTURE_DAY.md`.

---

## 4. How to run and verify everything

All commands from the repo root unless noted. Verified on this machine (macOS,
Node 26.3.1, Python 3.14/3.15) on 29 Oct 2026.

```bash
git clone https://github.com/ujeshauchitha-glitch/NAMMA-SPACE && cd NAMMA-SPACE

# --- app + test verification (the submission's core evidence) ---
cd apps/studio
npm ci
npm run typecheck          # 0 errors
npx vitest run             # 591/591 (32 files)
npm run lint               # 0 errors (6 known react-refresh warnings)
npm run validate:scenes    # 2/2 scene bundles PASS
npm run quality            # python3 scripts/quality_gate.py — 10/10, GATE_EXIT=0 (incl. Playwright e2e 28/28)
cd ..

# --- python suite (pipeline + gate heuristics) ---
uv run --with pytest python -m pytest tests -q     # 65 passed

# --- pipeline dependency doctor (repo root) ---
.venv/bin/python pipeline/run_pipeline.py --doctor
#  on this Mac: every line [OK] except "[MISSING] nvidia GPU" → exit 1, expected;
#  use --cpu. On the Windows/NVIDIA machine all lines are OK. See docs/HANDOFF_UJESHA.md.

# --- viewers ---
cd apps/studio && npm ci && npm run dev   # Capture Studio, Live Scan, POIs/A*, coverage visualizer
cd viewer  && npm install && npm run dev  # first-person splat viewer
#  open http://localhost:5173/?scene=dev-assets/fixtures/SYNTHETIC/synthetic_room.json  (badged SYNTHETIC)
```

Pipeline on a capture (needs COLMAP; `--cpu` without CUDA) — see `docs/SOP.md` and
`docs/CAPTURE_DAY.md` for the real-capture history:

```bash
.venv/bin/python pipeline/run_pipeline.py <video-or-photo-folder> --out work/<name> --check   # validate only
.venv/bin/python pipeline/run_pipeline.py <video-or-photo-folder> --out work/<name> --cpu      # full run
```

---

## 5. Judge quickstart — verify in 5 minutes

| # | Min | Do | Expect |
|---|---|---|---|
| 1 | 0–1 | `cd apps/studio && npm ci && npm run quality` | **10/10 `GATE_EXIT=0`** (build, budgets, scene validation, reconstruction preflight, browser E2E 28/28) |
| 2 | 1–2 | `npx vitest run` (studio), then repo-root `uv run --with pytest python -m pytest tests -q` | **591/591** and **65/65** |
| 3 | 2–4 | `npm run dev` (studio): import photos → export ZIP → open Spatial Viewer, search a POI, take an A* route; open the Live Scan workspace and the coverage visualizer | working UI on synthetic content (badged; no reconstruction involved) |
| 4 | 4–5 | Read `docs/CAPTURE_DAY.md` §3 and `logs/round1-rescue/BLOCKERS.md` | the real-capture numbers above, reproducible from `report.json` |
| 5 | 5 | Optional: `cd viewer && npm run dev` and walk the synthetic room | first-person WASD walkthrough renders |

---

## 6. Known limitations (consolidated)

1. **BLK-001** (§3): the only real capture fails the unchanged registration gate
   (57 % < 60 %) and splits into two rooms; the best sub-region fails the points gate
   (886 < 2000). **Re-shoot per SOP is required** — see `docs/CAPTURE_DAY.md` §6.
2. **No real reconstruction or trained splat exists.** Every demonstrated scene is
   synthetic and badged as such. Dense MVS + training require CUDA (teammate's RTX 5060
   laptop is the training host — `docs/HANDOFF_UJESHA.md`).
3. **Device-to-device pairing is not hardware-tested** (`docs/PAIRING.md` checklist is
   open).
4. **No public deployment, no demo video yet** (`README.md` Status).
5. **No collision geometry:** the first-person viewer walks through walls except for an
   optional bounding rectangle; splats are a rendering representation, not surfaces.
   Scale/orientation/spawn are hand-set in `scene.json`.
6. **`kind: "sog"` is schema-accepted but unrendered** in the studio viewer
   (`PROJECT_STATE.md` §11.5); the Round-1 viewer renders `.ply`/`.sog` via Spark from
   an external URL (not yet uploaded → it shows a clear "file missing" message).
7. **Accessibility and safety validation: not performed.** No benchmark numbers beyond
   the build/bundle budgets in §2.1 are claimed; frame rate on target hardware is
   unmeasured (`PROJECT_STATE.md` §11.10).
8. **Environment:** pipeline doctor on macOS exits 1 solely for the missing NVIDIA GPU
   (expected; `--cpu` path). Linux setup script is untested (`README.md`).

---

## 7. Sprint provenance

Rescue sprint `logs/round1-rescue/` (29 Oct 2026, branch `ashwinwork`), workstreams B–G.
Key commits: `7f4f060` (COLMAP flags) · `a4299f5` (SIMPLE_RADIAL root-cause fix) ·
`6a7654a` (ZIP ingest) · `6df7d8c` (A*) · `d4acf04` (scene contract/integrity) ·
`a56eaa1` (Live Scan journey) · `74a112b` (coverage visualizer + leak fix) ·
`1f3ddfa` (quality gate + budgets) · `b469fa8` (docs correction) ·
`a0359fe`/`969543c` (BLK-001 + amendment). Log entries cite exact IST timestamps.

**Not claimed anywhere in this package:** successful real reconstruction · trained real
splat · verified device-to-device pairing · accessibility/safety validation ·
unmeasured performance/benchmark numbers.
