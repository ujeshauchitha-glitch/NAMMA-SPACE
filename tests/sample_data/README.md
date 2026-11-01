# Sample data

- `capture_short.mp4`: 36 s, 720p excerpt of the first real classroom capture (29 Oct 2026). It passes `run_pipeline.py --check`; a full reconstruction of the whole 180 s original is what produced the numbers in `docs/round1/ABSTRACT.md`.
  ```
  .venv\Scripts\python pipeline\run_pipeline.py tests\sample_data\capture_short.mp4 --out work\sample --check
  ```
- The full-quality splat (`scene.sog`, 27.7 MB) is not in git; it is hosted by Ojas (see the master links document).
- `viewer/dev-assets/fixtures/SYNTHETIC/synthetic_room.ply`: synthetic room that exercises the viewer only.
