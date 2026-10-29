# Open issues: work to hand out

State on 29 Oct 2026: the classroom capture goes through the full pipeline. COLMAP poses it, people are masked, Brush trains it, the viewer auto-aligns it and you can walk it. What is wrong is listed below. Each card can be given to one person as it stands. Branch to work from: `ujesha/round1-fixes`. Tests: `.venv\Scripts\python -m pytest tests`.

Priority: **P1** = hurts the Round 1 submission, **P2** = needed for Round 2, **P3** = quality of life.

---

## 1. [P1] Objects close to the camera look streaky
**Symptom:** walk low between the desks and chairs and tables smear into long streaks. The room as a whole looks fine from the filmed path.
**Cause:** Brush grows long thin "needle" splats. From the filmed angles they blend into a sharp picture; from any other angle they show up as streaks. Brush 0.3 has no flag to penalise them. Near objects were also seen in too few frames at 3 fps.
**Already tried:**
- `pipeline/clean_splat.py` caps aspect at 8:1 after training. It helps a little.
- Dropping large or faint splats removed the streaks but darkened the whole room.
- A 6 fps rerun (`work/classroom_6fps`) is in progress to see whether more views fix it.

**Task:** train the same dataset (`work/classroom_masked_v2`: images, `sparse/`, `masks/`) with a trainer that supports scale/anisotropy regularisation. Use gsplat's `simple_trainer.py` with `--scale_reg` and the anisotropy/"mcmc" strategy, or another 3DGS trainer with an equivalent. Export a PLY, run it through `clean_splat.py` and splat-transform, then compare against the current `scene.sog` at the same low view among the desks.
**Done when:** you have side-by-side screenshots at 3 fixed viewpoints (low among the desks, the doorway, the spawn point) and a recommendation on which trainer the pipeline should use. If gsplat wins, also deliver a `--trainer gsplat` option in `pipeline/run_pipeline.py`.

## 2. [P1] No objective quality number
**Symptom:** every "this is better" so far was judged by eye from one or two views.
**Task:** hold out every 8th frame from training. After training, render those poses and compute PSNR, SSIM and LPIPS against the real frames, ignoring masked pixels (people). Put the numbers into `report.json` under `"quality"`. Brush has an eval-split option (`--eval-every`/similar; check `brush --help`); otherwise render the held-out poses with gsplat.
**Files:** new `pipeline/eval_holdout.py`, a stage in `pipeline/run_pipeline.py`, and a test in `tests/`.
**Done when:** a pipeline run prints `quality: PSNR xx.x dB` and the number is stored in `report.json`. Run it on the existing classroom outputs to get a baseline.

## 3. [P1] Unfilmed areas are smeared (doorway, ceiling, room edges)
**Symptom:** `work/classroom_coverage/coverage_topdown.png` shows the floor plan 82% seen and the ceiling 31% seen. Those regions look like fog.
**Task, part A (capture, non-coding):** re-film following `work/classroom_coverage/RECAPTURE.txt` and `docs/SOP.md`. Add a ceiling pass (phone tilted up ~45° on a second loop) and walk slowly through the doorway both ways.
**Task, part B (code):** in the viewer, hide or fade splats outside `scene.json` `bounds`, so fog beyond the filmed area is not drawn. Look at Spark's SplatMesh edit/clip options in `viewer/src/SplatScene.tsx`.
**Done when:** (A) `pipeline/room_coverage.py` reports `room_closed: true` (exit code 0), or (B) standing at the doorway shows no fog.

## 4. [P1] Round 1 deliverables that need a person
These cannot be automated:
- **Walkthrough sign-off:** someone walks the scene in the viewer, then runs the pipeline with `--approve`.
- **Abstract:** fill every `[TBD]` in the submission docs.
- **Demo video:** 60–90 s screen recording of walking the classroom. Follow `docs/DEMO_SCRIPT.md`.
- **Public URL:** with Ojas, deploy the viewer (GitHub Pages workflow already exists) and the `.sog`.
- **Drive upload:** put `work/send_to_ojas/classroom/` into the team Drive folder. Refresh its `report.json` and `pipeline.log` from the newest run first; the ones there now are from the first run.

## 5. [DONE, estimated] Real-world scale
`pipeline/scene_bundle.py` assumes the phone was held 1.45 m above the floor. On the classroom this gives a 2.65 m room height, which is plausible. The manifest says `scaleStatus: "estimated"`. Still open, and optional: a printed marker in the room for a measured scale.

## 6. [DONE] Walls and collision
`pipeline/scene_bundle.py` writes a navigation grid: 10 cm cells, desks and walls blocked with a 25 cm clearance, and areas far from the filmed path marked unknown. The studio viewer (branch `ujesha/viewer-unify`) stops you at walls and slides you along them. Checked on the classroom: walking straight ahead stops at arm's length from the bookshelf.

## 7. [P2] Finish the merge into one branch
**Decision (29 Oct): the studio app (Ashwin's PlayCanvas viewer) is the viewer.** It renders our classroom `.sog` correctly and already has metres, routing, POI search and a HUD, all of which Round 2 needs. The Spark viewer (`viewer/`) is kept only until this card is done.
**Task:** on `ujesha/viewer-unify` (based on `integration/r1`), replace `reconstruction/pipeline/` with `pipeline/` from `ujesha/round1-fixes`, together with its tests. Make `run_pipeline.py` publish copy `work/<run>/bundle` into `public/scenes/<name>/`. Port two features from the Spark viewer: the touch controls and adaptive resolution. Then remove `spark-viewer/` and `viewer/`.
**Done when:** one branch, one viewer, and a pipeline run opens in the studio app at `/?scene=/scenes/<name>/manifest.json` with no manual step.
**Not yet measured:** frame rate. Both viewers ran at about 2 fps while COLMAP was using the CPU, and the browser was on the integrated GPU. Measure again on an idle machine before deleting the Spark viewer.

## 8. [P3] A full run takes 3–4 hours
Exhaustive COLMAP matching plus Brush 30k steps, held to 8 cores so the laptop survives.
**Task:**
- add `--preview`: sequential matching, 1080p → 720p frames, 7k steps, aiming at under 30 min;
- reuse COLMAP output when only training settings change (the `train_fingerprint` logic already exists for training);
- move the thermal guard (`%TEMP%\thermal_governor2.ps1`, the core/priority limit and pause on heat) into the repo as `scripts/guard.ps1`, started automatically by the pipeline.

**Done when:** a `--preview` run on the classroom clip finishes in under 30 min with a recognisable room.

## 9. [P3] Masking side effects
`pipeline/mask_people.py` masks only the COCO "person" class, dilated by 45 px at confidence 0.15. On the classroom, people appear in 197 of 287 frames. Bags and chairs that people moved still leave ghosts, and a person right in front of the lens can hide most of a frame.
**Task:**
- drop frames where more than 40% is masked, and log how many;
- optionally add "backpack", "handbag" and "chair moved between frames" detection;
- add a test with a synthetic image.

**Done when:** `report.json` lists frames dropped for masking, and the test passes.

---
Not on this list because they are done and tested: auto-alignment, coverage report, people masking, path limiting, adaptive resolution and prefetch in the viewer. See `docs/STATUS.md`.
