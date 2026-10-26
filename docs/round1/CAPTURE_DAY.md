# Capture day card (10 minutes in the room)

Full reasoning is in `SOP.md`. This is the short version to read on the phone.

## Pick the room
A real room you can walk around freely: ideally 12-30 m², not a hallway, not an all-white empty box. A bedroom or study with furniture is ideal. Plain glossy floors, mirrors and big windows are hard.

## Before filming (3 min)
- Lights ON, curtains open, no strong sun beams. No flash.
- Move people/pets out. Open the doors you want mapped.
- Phone: **1x lens, landscape, 4K or 1080p, 30 fps. Stabilisation OFF.** Lock focus + exposure (long-press the screen on the first frame). Do not zoom.
- Phone storage free (4K is ~400 MB/min).

## Film (4-5 min, ONE continuous take)
Walk slowly (about half a metre per second), phone at chest height, never rotate fast.
1. Perimeter loop: along the walls, camera angled ~20 degrees toward the wall, all the way round, back to the start.
2. Centre pass: straight down the middle, then a second line ~1.5 m to the side, camera slightly down so the floor is covered.
3. Corners: stop at each, pan slowly 90 degrees.
4. Doorway: cross it slowly twice, once each way, with both sides visible.
5. Furniture: one half-arc around each large item at ~1 m.
6. Finish where you started.

Optional, only if the room is small and you have time: ring of 8-12 standing stations around the room's centre, a slow full turn at three tilts (up, level, down) at each. This is the capture layout from the team sketch; it is untested.

## Check before leaving (1 min)
- [ ] Scrub the video: no long blurry or dark stretch.
- [ ] Both directions through the doorway are there.
- [ ] You ended where you started.

## Then
Copy the video to the laptop and send it/put it in the project folder. Then:
`py -3.12 pipeline/run_pipeline.py clip.mp4 --out work/room1 --check`
