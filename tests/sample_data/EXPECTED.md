# Expected results — tests/sample_data reproduction commands

Every command below was executed verbatim from a clean checkout of this
repository (macOS, 30 Oct 2026: python3 3.15.2, ffmpeg 9.0.2/Homebrew). All
sample data is **SYNTHETIC** (see [PROVENANCE.md](PROVENANCE.md)) — these
commands prove ingestion contracts, not reconstruction accuracy.

Note: `frame-manifest.json` contains absolute paths and a current `createdAt`
timestamp, so that file is not byte-stable. The values listed here (counts,
statuses, digests, IDs) are.

## 0. Digest check (optional, must match PROVENANCE.md)

```bash
shasum -a 256 tests/sample_data/images/*.jpg tests/sample_data/synthetic_capture_bundle.zip tests/sample_data/synthetic_clip.mp4
```

Expected: the 10 digests listed in [PROVENANCE.md](PROVENANCE.md).

## 1. Studio export ZIP ingest

```bash
python3 apps/studio/scripts/prepare_capture.py tests/sample_data/synthetic_capture_bundle.zip --output work/sample_zip
```

Stdout (paths vary):

```
Prepared 8 frames in <output-dir>
Manifest: <output-dir>/frame-manifest.json
Next stage: run a configured COLMAP adapter; this command does not claim reconstruction.
```

`work/sample_zip/frame-manifest.json` key values:

| Field | Expected |
|---|---|
| `source.kind` | `prepared-capture-bundle` |
| `source.sha256` | `971478e85c1c64aa725ad2449690f10d7f6c0a0fbd8dd77bd6368f439a87dc7e` (the ZIP itself) |
| `captureId` | `capture-971478e85c1c` |
| `quality.status` | `passed` (warnings: `[]`) |
| `quality.measured` | `frameCount: 8, duplicateFrameCount: 0, tinyFrameCount: 0` |
| `frames[0..7].sha256` | the 8 `sample_synthetic_0N.jpg` digests, in order (ZIP stores the same bytes) |
| `frames[0]` metadata | `sourceEntryId: img-01`, `viewGroupId: vg-1`, `roomId: room-1`, `width: 320`, `height: 240`, `source: operator` |
| `bundle.displayName` | `Synthetic Corridor Sample (SYNTHETIC — generated, not a real space)` |
| `nextStage` | `reconstruction-not-run` |

## 2. Image-folder ingest

```bash
python3 apps/studio/scripts/prepare_capture.py tests/sample_data/images --output work/sample_dir
```

Stdout: `Prepared 8 frames in <output-dir>` + the two lines above.

Key values: `source.kind: image-directory`, `quality.status: passed`, no
warnings, `frameCount: 8`, digests identical to the 8 image digests in order.
(The folder name becomes the capture ID: `capture-images`.)

## 3. Video ingest

```bash
python3 apps/studio/scripts/prepare_capture.py tests/sample_data/synthetic_clip.mp4 --output work/sample_video
```

Stdout: `Prepared 10 frames in <output-dir>` + the two lines above.

Key values: `source.kind: video`, `source.sha256` =
`34e3f89e08e1f2e833bddccda47f6cf58eb7b2c7db9cf11137f67ca63d91725a`,
`captureId: capture-34e3f89e08e1`, `quality.status: passed`, no warnings,
`frameCount: 10` (5 s clip × default `--fps 2`), `duplicateFrameCount: 0`.

- **Cross-machine caveat:** the count (10), status (`passed`) and uniqueness of
  the frames are the contract. The per-frame digests come from the local
  ffmpeg's H.264 decode + JPEG re-encode and may differ between ffmpeg builds.
  With the build used for this submission, the frame digests are:

```
22ad7edb81a76976ded216c7405d9169094c239243687c005f02f8ddbaa5fd1c  frames/frame-00001.jpg
f1b8686cd0e2ed9c57511f4ae73ba939ea2e8883ec0d737b779c72eaf3a4d0d6  frames/frame-00002.jpg
97d2086ffe4b2e0554963001dac82f0e49c429b61ffed8ac91d3a3d851a8ea26  frames/frame-00003.jpg
9bb84d58ba14ddb8f1efc20d41dc54e51013634177b358c316b7f5ca17e05700  frames/frame-00004.jpg
0b70bdfc8ddf9d34c987afd87cebbca0b874af485b98bb92f9c0b2a08ea0f908  frames/frame-00005.jpg
81be1c44a6b72b2b34e9097b890d00a2ce9da749ff61de0f6c05abe69a02c06f  frames/frame-00006.jpg
7a6b909f4cf638cd71c21bc668e2529cb8891e672545dd0ed4b3a2ab5dc0b453  frames/frame-00007.jpg
d40b0fddef748ffd016c20e1ebac39eec83a18c1ef9dcdd05484efadbaff39a4  frames/frame-00008.jpg
099f299ae3da3f3b458694c7636a2a6ea2ffbb0039b39c9490414a399bdd4682  frames/frame-00009.jpg
d0899521f6b9f5597d0d9c9930efde1d86e09a4f803f0c099cf655e445883270  frames/frame-00010.jpg
```

## 4. Studio scene validation (synthetic scene bundles)

```bash
cd apps/studio
npm ci
npm run validate:scenes
```

Expected tail (2 bundles, both synthetic demos):

```
PASS  The Amber Hall (synthetic-demo)
PASS  4 POIs, 128 blocked cells, 0 hashed assets
PASS  quality status: passed
PASS  The Amber Hall · GLB asset (synthetic-demo)
PASS  4 POIs, 128 blocked cells, 1 hashed assets
PASS  quality status: passed
Validated 2 scene bundles
```

Exit code 0.

## 5. Regenerating the fixtures (optional)

```bash
python3 tests/sample_data/generate_sample_data.py
```

Expected: prints all 10 digests above and regenerates the files byte-for-byte
for the same ffmpeg build. A different ffmpeg build may change the JPEG/MP4
bytes (and therefore the digests) while keeping the fixtures valid.
