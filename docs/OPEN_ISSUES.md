# Open issues

State on 15 Nov 2026, branch `round2/poi-nav`. Everything below is either not done or done but not verified.

## Deployment
- **Production still serves Round 1.** <https://namma-space-pearl.vercel.app> runs the Round 1 build; the Round 2
  features exist on this branch and on Vercel preview deployments (behind team login). Promote after review.
- **Round 1 PDF links.** The submitted Round 1 PDFs link to files on `round1/viewer-pipeline` (e.g. `viewer/`,
  `docs/HANDOFF_UJESHA.md`) that Round 2 removed. They break once this branch is merged there; the HTML sources in
  `docs/submission/` now point at the Round 1 commit `d5aa11a` instead. Merge to the default branch only after
  Round 1 judging no longer needs those links, or keep `round1/viewer-pipeline` and merge elsewhere.

## Reconstruction
- **Kaggle path not run on a GPU.** `notebooks/kaggle_reconstruct.ipynb`, pycolmap-cuda12 and gsplat were tested on
  the CPU only (poses on the sample clip: 97/97 frames in 60 s; training loop with a stand-in rasteriser). Likely
  first failures, in order: pycolmap's CUDA libraries, gsplat's CUDA compile, the poses stage on GPU, T4 memory/time
  for 30k steps, splat-transform's WebGPU module. The ≤ 2 h (final) and ≤ 30 min (preview) targets are unmeasured.
- **Needle streaks.** gsplat training adds MCMC, scale/anisotropy regularisation and antialiasing against them;
  there is no before/after comparison yet. The live classroom is a Brush splat and still streaks near the camera.
- **No objective quality number.** Hold out every 8th frame and report PSNR/SSIM/LPIPS against the real frames.
- **Unfilmed areas smear** (doorway, ceiling, room edges): re-film using the coverage report (`work/<name>/coverage/RECAPTURE.txt`).
  The viewer hides splats centred outside the scene bounds (+0.3 m), not large splats inside the room.
- **Scale is estimated** from an assumed 1.45 m camera height (about ±15 %).

## Viewer and navigation
- **Zones and labels are not occluded** by the splat or furniture.
- **The classroom has one POI** (Start). The apartment has seven. Tag the classroom's desks, door and board with the
  POI editor (`?edit=1`) and commit the exported `pois.json`.
- **One floor only**: no stairs, lifts or multi-storey routes.
- **Phones**: tested in Chrome's 390 px touch emulation only, not on a real iPhone or Android device; there is no
  virtual joystick (walking is Follow route).
- **Live Scan pairing** (phone camera → studio over WebRTC) is building blocks, not a complete capture workflow;
  its e2e tests need a real camera and fail in headless CI.

## Done since Round 1 (for reference)
Search with typo tolerance and walking distances; spatial index and in-world labels; POI editor; heap A*, snapping,
string-pulling; route ribbon, guidance, re-routing and Follow route; Go to view along the route; drag-to-look and
touch; bounds crop; the Linux/Kaggle pipeline; the blur filter that split poses into pieces.
