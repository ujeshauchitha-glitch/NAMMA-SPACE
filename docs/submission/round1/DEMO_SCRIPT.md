# Round 1 demo video script (3-5 min) — SKELETON

> **Status (29 Oct 2026): not recordable as written.** No real reconstruction exists
> (blocker `logs/round1-rescue/BLOCKERS.md` BLK-001 — the 70-photo capture splits into
> two rooms and fails the registration gate). The Pipeline and Walkthrough segments below
> presuppose a real reconstructed room. Two honest options before recording:
> **(a)** re-shoot per `docs/SOP.md` and process successfully first (preferred), or
> **(b)** record a clearly-labelled *synthetic* walkthrough — every synthetic frame must
> carry the on-screen `SYNTHETIC` badge and the narration must say it is synthetic.
> Do NOT record synthetic content presented as a real capture.

| Time | Segment | Show |
|---|---|---|
| 0:00-0:30 | Problem | Why 2D blueprints fail indoors; the goal (Google Maps for interiors) |
| 0:30-1:30 | Capture SOP | Real footage of the capture: phone settings, perimeter loop, doorway crossings, corners (from `docs/SOP.md`) |
| 1:30-2:30 | Pipeline | Architecture diagram; run `run_pipeline.py` (sped-up recording); real processing times and resource use — **only measurable after a successful real run; today only synthetic/benchmark numbers exist** |
| 2:30-4:15 | Walkthrough | Browser walkthrough of the reconstructed room: WASD, mouse look, doorway, close inspection of furniture; honest note of artefacts — **requires a real reconstruction (BLK-001); otherwise use option (b) with the SYNTHETIC badge** |
| 4:15-4:45 | Limitations and next | No collision yet; Round 2 POIs, search, A* on a walkable grid |
| 4:45-5:00 | Close | Link to the live viewer and repo |

Checklist before recording: viewer deployed at a public URL; scene aligned (floor level, scale, spawn); frame rate noted on the recording machine; no synthetic assets visible.
