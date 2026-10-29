# Demo video plan (target 4:15, limit 5:00)

Record screen + voice-over; no people on camera or in the splat view (crop or avoid the right-hand desk in the second screenshot's direction). Use real numbers only (from `report.json`).

| Time | Say | Show |
|---|---|---|
| 0:00-0:25 | "Floor plans don't show what an indoor space feels like. We turn a phone video into a room you can walk through in a browser." | Title card; clip of the raw phone video |
| 0:25-1:15 | Capture SOP: 1x lens, stabilisation off, locked exposure, slow ~0.5 m/s loop, doorways both ways, original-quality file. "A WhatsApp copy registered 14%; the original 94%." | Phone settings screen; sped-up capture clip; `docs/SOP.md` checklist |
| 1:15-2:15 | Pipeline: validate, frames, COLMAP, Brush, checks, compress, human approval. 287/306 frames, 1.83M splats, 430.9 MB to 27.7 MB. | Architecture diagram; sped-up terminal run of `run_pipeline.py`; `report.json` |
| 2:15-3:45 | Walkthrough: spawn, WASD, mouse look, windows and curtains, desks, fan. Say honestly: smeared ceiling, ghosting near people. | Public viewer URL in browser, full screen; show fps counter (`&debug`) |
| 3:45-4:10 | Limitations and Round 2: no collision yet, scale set by hand; POIs, search, A* on a walkable grid next. | One slide, 3 bullets |
| 4:10-4:15 | Close | Viewer URL and repo URL on screen |

## Before recording
- [ ] Viewer is public, scene aligned, metric scale set, scene approved (`--approve`)
- [ ] Note fps and device from the debug overlay; put in abstract section 5
- [ ] Capture the pipeline terminal run with `Start-Transcript` or screen-record the existing log; speed up 8x
- [ ] Export 1080p MP4 and upload to the Drive folder

## Shot list
1. Phone-in-hand capture b-roll (film once, 20 s, no faces)
2. Phone settings screenshot (lens, stabilisation, HDR off)
3. Architecture diagram (draw from `ABSTRACT.md` section 2)
4. Terminal: `--check`, then the full run (sped up)
5. `report.json` highlighted: registration, splats, MB
6. Viewer walkthrough: 90 s continuous take, start at spawn, loop the room
7. Closing card
