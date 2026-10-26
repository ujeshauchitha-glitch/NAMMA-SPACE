# Round 1 submission checklist (deadline Sat 31 Oct 2026)

Submit via the Techfest portal: a Google Drive folder, "Anyone with the link can view". Extra links go in ONE master document (e.g. `Additional_Links_and_Prototypes.pdf`); loose links or files are not reviewed.

## Deliverables
| # | Deliverable | Source in this repo | Status (update honestly) |
|---|---|---|---|
| 1 | Technical Abstract PDF (max 5 pages): architecture, pipeline, SOP, approach | `docs/ABSTRACT.md` -> PDF | draft with TBD placeholders; real numbers need the capture |
| 2 | Proof of concept + web viewer link (free roaming) | `viewer/`, deployed via `.github/workflows/pages.yml` | NOT deployed; needs a real splat first |
| 3 | Demo video, 3-5 min | `docs/DEMO_SCRIPT.md` | NOT recorded |
| 4 | Code repo with setup instructions + sample data in a test dir | this repo; `tests/sample_data/` | setup done; sample data missing |
| 5 | Master links document inside the Drive folder | write last | not created |

Evaluation criteria to design for: SOP and pipeline soundness, visual quality and model fidelity, web viewer performance, documentation and video clarity.

## Gate: nothing below is "done" until the capture is reconstructed and inspected
1. Film one room per `docs/CAPTURE_DAY.md`.
2. `run_pipeline.py clip.mp4 --out work/room1 --check`, then the full run.
3. Walk the whole result; align `scene.json`; `--approve` with a real note.
4. Only then: deploy, record the video, fill the abstract's numbers.

## Day plan (today is Mon 26 Oct)
| Day | Work | Who |
|---|---|---|
| Mon 26 | repo prep: deploy config, abstract draft, this plan (done); film as soon as you are in the room | Claude / you |
| Tue 27 | film (1-2 attempts), run pipeline, read the report | you film; Claude runs |
| Wed 28 | fix whatever failed (re-shoot is likely); align scene, inspect, approve; commit real splat | both |
| Thu 29 | enable Pages + deploy; test the public URL on another device; record the demo video | you record; Claude checks |
| Fri 30 | abstract numbers + PDF; sample data into `tests/`; Drive folder + master doc; dry-run the submission | both |
| Sat 31 | buffer / submit early. Do not plan new work here. | you |

If a re-shoot is needed on Wed, Thu absorbs it; if two re-shoots are needed, cut: skip the optional station-capture layout and submit with the single best capture, documented honestly.

## Decisions that need you
- Enable GitHub Pages (Settings -> Pages -> Source: GitHub Actions) so the workflow can publish the viewer. Public URL will be `https://ujeshauchitha-glitch.github.io/NAMMA-SPACE/`.
- Where to host the splat if the compressed copy is over ~90 MB (GitHub's 100 MB per-file limit).
- Who records and edits the demo video.
- Whether a teammate's photo-based capture (Ashwin's imaging idea) should feed the same pipeline.
