# Capture day — real-capture record (Round 1 rescue sprint)

**Status: BLOCKED with evidence.** This is the honest record of the one real capture
attempt made for Round 1. It produced *no* reconstruction and *no* splat; it produced a
precise, reproducible diagnosis instead. Numbers below were re-verified from
`report.json` files on 29 Oct 2026. Competing deadline: **31 Oct 2026**
(real-capture outputs were targeted for the evening of 30 Oct — `docs/HANDOFF_UJESHA.md`).

## 1. What was shot

| | |
|---|---|
| Date shot | 28 Oct 2026 (delivered into the repo 29 Oct, 02:09 IST — `logs/round1-rescue/EVENT_LOG.md`) |
| Medium | 70 still photos of an indoor room, transferred through **WhatsApp** (not camera-native files) |
| Format | JPEG, portrait; mixed widths **740×1600 and 738×1600**; EXIF stripped by WhatsApp |
| Not shot | No video walk-through. The pipeline's default sequential matcher targets video; a stills set with weak doorway overlap is what it had to work with. |

This is a different set from the earlier 73-photo workshop capture documented in
`PROJECT_STATE.md` §11.1 (the original "2/73 unusable" verdict — now known to be at
least partly a pipeline bug, see §3).

## 2. What was normalized

- All 70 photos resized to a **uniform 740×1600** with `sips -z 1600 740` into
  `work/captures/room_norm/` (70/70 — `logs/round1-rescue/COMMANDS_AND_TESTS.md` #6).
- Why: the pipeline runs COLMAP with `--ImageReader.single_camera 1`, and mixed image
  sizes are silently dropped (`PROJECT_STATE.md` §11.2: 30 of 73 photos dropped on the
  earlier set). Uniform size removes that failure mode before it can bite.

## 3. Pipeline run-by-run

Unchanged gates for every run (never weakened): **≥60 % of frames registered** (needs
42/70), **≥2000 sparse points**, **mean reprojection error ≤1.5 px**, single connected
model.

| # | Run | Input | Result | Verdict |
|---|---|---|---|---|
| R0 | manual COLMAP (default `SIMPLE_RADIAL`, exhaustive matcher) | `room_norm` 70 imgs / 2415 pairs | **59/70** first run; reruns 3/26/50 (best 50/70) | Large model reproducible, but mapper is nondeterministic |
| R1 | pipeline run #1 — COLMAP forced `--ImageReader.camera_model OPENCV` | `room_norm` | **2/70 (3 %)**, 229 pts, 0.37 px, exit 1 | FAIL at the SfM gate, as designed |
| R1b | isolation: OPENCV, no `use_gpu` flag, fresh db | `room_norm` | models of 2/20/19 imgs (best **20/70**) | `use_gpu` exonerated; **camera model is the cause** |
| — | **fix `a4299f5`**: force `SIMPLE_RADIAL` (after `7f4f060` COLMAP 4.x flag fix) | — | — | 3 % → 57 % on identical inputs |
| R2 | pipeline run #2 (post-fix) | `room_norm` | **40/70 (57 %)** connected + disconnected **17-img** model, 13 unregistered; 2857 pts; 0.92 px | FAIL 57 % < 60 % + WARN "room split" |
| R3 | pipeline run #3 (documented rerun) | `room_norm` | **40/70 (57 %)** + 17-img fragment — *identical topology*; **2966 pts** ✓; **0.92 px** ✓ | FAIL 57 % < 60 % — split is deterministic → **BLK-001** |
| R4 | disclosed subset run: the 40-image connected component only, same gates | `room_subset40` | **29/40 (72 %)** ✓, 0.96 px ✓, but **886 pts < 2000** ✗ | FAIL — capture-quality blocker confirmed |

Evidence files (all **local-only**, see §4): `work/captures/pipeline_run.log` (R1),
`pipeline_run2.log` (R2), `pipeline_run3.log` (R3), `pipeline_subset_run2.log` (R4),
`opencv_test.log` (R1b); reports `work/captures/room_run/report.json` (R3) and
`work/captures/room_subset_run/report.json` (R4). Full analysis in
`logs/round1-rescue/BLOCKERS.md` and `logs/round1-rescue/EVENT_LOG.md`.

### Diagnosis (why 57 % and why the split)

1. **Pipeline defect, fixed:** the adapter forced COLMAP's `OPENCV` camera model, which
   fails initial-pair selection / bundle adjustment on these real photos
   (`2/70`), while `SIMPLE_RADIAL` reaches `40–59/70` on *identical* inputs. Fixed in
   `a4299f5`; the earlier team verdict "2/73 unusable capture" was at least partly this
   bug (`PROJECT_STATE.md` §11.1 update, `logs/round1-rescue/EVENT_LOG.md` 03:12 IST).
2. **Capture defect, not fixed (BLK-001):** the room splits into two halves with no
   shared viewpoints — the capture never crossed the doorway with overlap, so the two
   room halves cannot be registered into one model. Two independent pipeline runs
   converged on the same 40+17 topology, so this is not mapper luck.
3. **Quality defect, not fixed:** even the best-connected 40-image region triangulates
   only **886 points** (< 2000). WhatsApp compression + 740-px resolution + probable
   motion blur starve SfM of texture and parallax. The software is exonerated
   end-to-end; the photos are the limitation.

## 4. Where the raw logs are

`work/` is **git-ignored** (`.gitignore`, since commit `1e722a1`). The pipeline logs
listed in §3 exist **only on this machine** and are not in the repository; the numbers
recorded in this document and in `logs/round1-rescue/*` are the durable copy. Nothing
large (photos, COLMAP databases, models) is committed.

## 5. What this capture did NOT produce

- **No dense reconstruction.** Dense MVS (`patch_match_stereo`) has no CPU fallback and
  needs CUDA; this Mac has a CPU-only COLMAP 4.2.1 (`logs/round1-rescue/BLOCKERS.md`
  B-001).
- **No trained splat — real or otherwise from these photos.** Both pipeline runs exited
  at the SfM gate *before* the training stage; no Brush training ever started on real
  photos. (Brush v0.3.0 Apple Silicon binary itself is installed and sha256-verified —
  `EVENT_LOG.md` 03:00 — but that is a binary check, not a trained scene.)
- **No screenshots of a real room in the viewer**, because there is nothing to view.
  The viewer's demonstrated content is the **synthetic** fixture, permanently badged
  `SYNTHETIC` (`README.md`, "Run the viewer").

## 6. Next capture (re-shoot ask — per the pipeline's own remediation text)

Per `docs/SOP.md` and BLK-001's continuation notes:

1. **Video walk-through, not a stills set** (the default sequential matcher expects it).
2. **Native camera files** (≥1080p, no WhatsApp transfer), 1× lens, stabilisation off,
   AE/AF locked.
3. **Deliberate doorway traversal**, both directions, slow — this is the specific defect
   that split this capture into two rooms.
4. 60–70 % overlap, slow motion (~0.5 m/s), textured surfaces in frame.

With the `SIMPLE_RADIAL` + normalization fixes now in place, a compliant capture on this
same machine has a credible path to passing all four gates; dense MVS + splat training
continue on the team's RTX 5060 host (`docs/HANDOFF_UJESHA.md`).
