# Capture SOP

This procedure is designed for ordinary smartphone capture of a single indoor venue. It is a target operating procedure for the future reconstruction pipeline; the current fixture is synthetic and does not claim to have been captured this way.

## Before recording

1. Clean the phone lens.
2. Use the highest stable video mode available; avoid portrait filters, digital zoom, and aggressive stabilization that changes the optical model.
3. Keep the lens at approximately chest or eye height.
4. Decide on one route through the space. Mark a measured distance if metric scale matters: a tape-measured doorway, a known tile width, or a clearly measured wall segment.
5. Remove people from the area where possible. Do not publish identifiable faces or private signage without permission.

## Walking pattern

- Move slowly and steadily. Turn the phone instead of swinging it.
- Keep adjacent views overlapping. A practical starting target is roughly two-thirds visual overlap between nearby views.
- Walk around the perimeter first, then make a second pass through the middle.
- Pause briefly at corners, doorways, room transitions, and important furniture.
- Capture floors and ceiling edges often enough that the pipeline can infer a stable floor plane.
- Avoid sudden exposure changes between bright windows and dark interiors.
- Avoid motion blur, reflective mirrors, blank walls, and moving crowds where possible.
- Capture entrances and connecting doorways from both sides so rooms remain connected.

## Recommended input organisation

```text
capture-2026-10-24-main-hall/
├── source.mp4
├── notes.txt
└── anchors.json
```

For still images, use one directory with sequential names. Do not mix unrelated rooms in one capture unless the connecting path is recorded.

## Pre-upload quality check

- Can a person follow the camera route without abrupt jumps?
- Are there enough views of every corner and doorway?
- Are most frames sharp enough to read fine edges?
- Are there large moving objects or people covering the scene?
- Is there at least one measured scale reference if route distances matter?
- Is the source video/image set accessible and within the configured frame/size limits?

## Prepare and inspect locally

Use one capture directory per walk and keep the original media unchanged:

```bash
python3 scripts/prepare_capture.py ./capture-2026-10-24-main-hall \
  --output ./capture-output --limit 120
```

For video, sample conservative key views before reconstruction:

```bash
python3 scripts/prepare_capture.py ./capture-2026-10-24-main-hall/source.mp4 \
  --output ./capture-output --fps 2 --limit 120
```

The frame manifest records source/frame hashes, duplicate-frame count, tiny-file
warnings, unreadable-raster heuristics, and measurements that are deliberately
not claimed: blur, exposure consistency, camera coverage, pose registration,
scale accuracy, geometry completeness, and navigation trustworthiness. A warning
is a reason to inspect or recapture; it is not proof that COLMAP will fail.

Before spending time on dense processing, check:

```bash
npm run preflight:reconstruction
python3 scripts/validate_scene.py ./capture-output/scene
```

If preparation reports invalid files, replace or re-export those frames. If it
reports redundant frames, recapture the weak section with slower turns and more
distinct viewpoints. If it reports fewer than eight frames, the set is almost
certainly too small for a useful indoor reconstruction.

## When quality is poor

Do not silently publish the result. Re-record the weak section, reduce motion, add overlap, or provide a measured anchor. The processing report should identify whether the failure came from blur, low texture, insufficient overlap, exposure, scale, incomplete geometry, missing navigation evidence, or a missing dependency. A valid visual asset without a trusted walkability map may be published only as visual exploration, never as navigation-ready.
