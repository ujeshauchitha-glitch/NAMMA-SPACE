# Namma Space

**A browser-first spatial twin for Techfest 2026–27 at IIT Bombay.** Your phone becomes
the camera, the browser stages every frame honestly, an offline COLMAP pipeline
reconstructs the space, and you walk the result in first person — with points of interest
you can search and routes that are either verified A* or explicitly unavailable.

> **Honesty contract.** This repository ships no fake metrics, no hardcoded demos, and no
> unshipped feature claims. Everything below is either (a) code committed through `T20`
> and covered by tests, or (b) explicitly marked as not shipped. The current prototype
> includes a **synthetic demonstration fixture**, not a smartphone reconstruction — the
> fixture uses the same versioned manifest, navigation grid, POI data, quality report,
> and viewer contracts intended for captured venues.

## The problem

Spatial-twin demos usually fake the hard part. Progress bars jump to 100%, coverage
numbers are invented, and "instant reconstruction" hides a pipeline that actually needs
a GPU, minutes of COLMAP, and careful capture discipline. Judges rightly distrust it.

Namma Space splits the problem at the honest boundary:

- **In the browser** — capture staging, IndexedDB persistence, bundle export with
  digests, scene validation, first-person viewing, POI search, verified routing, and
  phone-to-desktop pairing UI. Deterministic, testable, shippable.
- **Outside the browser** — photogrammetry. COLMAP on a workstation, driven by
  checked-in Python scripts, reporting real statuses (`BLOCKED` when GPU/COLMAP is
  missing). Never simulated in the UI.

This prototype proves the browser half is real and that the boundary is drawn honestly.

## What ships today

Three workspaces behind one accessible shell (current through `T20`):

| Workspace | What you can do |
|---|---|
| **01 · Capture Studio** | Stage JPEGs and watch honest ingest (magic-byte sniff → decode → hash → batch isolation), inspect images, see view-group occupancy, and export a ZIP scene bundle with SHA-256 digests. State survives reloads (IndexedDB). |
| **02 · Spatial Viewer** | Walk a scene bundle in first person (PlayCanvas, lazily loaded), search POIs, open a destination dossier, get a verified A* route strip or an explicit "route unavailable", use HUD chips, compass, and pointer lock. |
| **03 · Live Scan** | Pair a phone: QR pairing card, `NS-XXXX` session token, and the frozen stage rail `IDLE → PAIRING → LIVE → CAPTURING → STAGED → OFFLINE/ERROR`. Insecure contexts render a derived `BLOCKED` screen with the `dev:lan` remedy — never a silent failure. |

**Try the viewer without a phone or a GPU:**

```bash
npm install
npm run dev
```

Open the printed local URL, select **02 · Spatial Viewer**, choose a destination, plot a
route, or enter the walkthrough with the mouse and `WASD`. Press `Escape` to return to
the surrounding interface. The checked-in fixture loads immediately — it is a fixture,
not a reconstruction (see [Limitations](#limitations)).

## Run it

Requirements:

- Node.js 20+ and npm.
- Python 3.10+ for the CPU-safe capture preparation and validation commands.
- A WebGL 2-capable browser.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on loopback (HTTP, no pairing) |
| `npm run dev:lan` | Dev server with self-signed HTTPS + `/ws` signalling relay for on-LAN phone pairing (`T19`) |
| `npm run build` | `tsc -b` then production build |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | `eslint .` |
| `npm run test` | Vitest unit suite |
| `npm run test:e2e` | Playwright end-to-end suite |
| `npm run quality` | The single local gate (see below) |
| `npm run validate:scene` | Validate the fixture scene bundle |
| `npm run validate:scenes` | Validate every bundle under `public/scenes` |
| `npm run preflight:reconstruction` | Check COLMAP/GPU availability; reports `BLOCKED` honestly |
| `npm run reconstruct:colmap` | Run the real COLMAP reconstruction |
| `npm run benchmark:build` | Record production bundle scopes |

For a production-build smoke test:

```bash
npm run build
npm run preview
```

## How it works

### Phone → browser, honestly

Scan the QR shown on **03 · Live Scan** and the token (`NS-XXXX`) becomes the room key
for `/ws?session=TOKEN` on the dev server. Rooms hold exactly two peers: a third gets a
`ROOM_FULL` error frame and close code `4003`. SDP and ICE frames are relayed verbatim
as zod-validated messages; the peer connection tries host candidates first, so two
devices on the same LAN connect directly with no third party. Each session has a
10-minute countdown, and expiry outranks every transition table.

Shipped and tested: token minting, the pairing state machine, signalling client and
relay, peer-connection logic, QR encoding, and the pairing UI (`T18`–`T20`, see
[Evidence](#evidence)). **Not yet shipped:** the live camera-capture slice (`T21`) that
moves frames from the phone over the data channel into Capture Studio. Until it lands,
the Live Scan workspace shows the QR card and stage rail only — it never fakes a
connection.

Plain `npm run dev` stays on loopback HTTP; the pairing UI then shows the derived
`BLOCKED` state with `npm run dev:lan` as the remedy. The `BLOCKED` screen is a
presentation decision, never one of the canonical pairing states
(`src/state/types.ts`).

### Capture → reconstruction, honestly

Frames staged in Capture Studio export as a ZIP bundle (zod-validated manifest, images,
SHA-256 digests). A separate Python CLI ([`PIPELINE.md`](./PIPELINE.md)) prepares them,
runs COLMAP, and publishes a scene bundle. The browser never claims reconstruction is
happening: the UI says `Prepared` or `Staged` until a real reconstruction report exists.

### Route, honestly

Routing is deterministic A* over the scene's verified occupancy grid with diagonal
corner-cut prevention, and the route visualization is built from the actual returned
path. If no path exists, the route strip says so. No smoothing, no invented paths.

## Architecture

```text
        browser (this repo)                         workstation (Python CLI)
┌────────────────────────────────┐     ZIP    ┌────────────────────────────────┐
│ 01 Capture Studio              │ ─────────► │ prepare_capture.py → frames    │
│    ingest · IDB · bundle export│            │ reconstruct_colmap.py (COLMAP) │
│ 03 Live Scan                   │   /ws      │ process_geometry.py (Open3D)   │
│    QR pairing · stage rail     │ ◄─relay──► │ generate_scene_bundle.py       │
│ 02 Spatial Viewer              │   (T19)    │ validate_scene.py              │
│    PlayCanvas · POI · A* · HUD │ ◄─bundle── │ scene bundle (manifest/GLB/    │
└────────────────────────────────┘            │  navigation/POIs/quality)      │
                                              └────────────────────────────────┘

capture media → frame manifest → reconstruction adapter → visual asset
                                  ├→ explicit geometry → walkable grid → A*
                                  └→ semantic POIs → browser scene bundle
```

## Implementation

### Task ledger (all committed, `T01`–`T20`)

| Area | Tasks |
|---|---|
| Foundation | `T2` verified deps · `T3` stdlib magic-byte sniffing · `T4` GROUNDTRUTH tokens/base/motion/fonts · `T5` hand-rolled icon set · `T6` UI primitive layer · `T9` pure workspace reducer · `T8` three-workspace shell with a11y tabs · `T10` IndexedDB behind one typed access point |
| Capture | `T7` honest coverage indicator + view-group chips · `T11` honest ingest pipeline (sniff, decode, hash, batch isolation) · `T12` Capture Studio workspace (rooms, chips, ingest wiring, inspector) · `T13` ZIP bundle export (lazy fflate, zod manifest, verifiable digests) |
| Viewer | `T14` Viewer workspace (scene skeleton, pose restore, single-context invariant) · `T15` engine additive motion API (eased jump, tape reveal, marker pulse) · `T16` Viewer rail (POI search, destination detail, route strip, dossier) · `T17` HUD (chips, compass, pointer-lock choreography) |
| Pairing | `T18` protocol library (tokens, machine, signalling, peer, zod types) · `T19` LAN HTTPS dev server, ws signalling relay, insecure-context blocking · `T20` QR pairing card + stage rail |

Not shipped yet: `T21` live camera capture over WebRTC, `T22` three.js coverage,
`T23` GSAP, `T24` expanded e2e (a 28-test Playwright suite already exists),
`T25` scene scripts, `T26` docs, `T27` release gate.

### Stack

React 18 · TypeScript (strict, `tsc -b`) · Vite 7 · PlayCanvas Engine 2 (lazy-loaded
after bundle validation, [D-012](./DECISION_LOG.md)) · Zod · `ws` relay as a Vite plugin
([D-013](./DECISION_LOG.md)) · IndexedDB · fflate + qrcode (both lazy) · Vitest +
Testing Library · Playwright · Python for the COLMAP/Open3D pipeline. Design identity:
GROUNDTRUTH, palette direction A = MERIDIAN (light mineral cartography).

## Evidence

Every number below came from a green run of the checked-in suite:

| Gate | Result |
|---|---|
| `npx tsc -b` | exit 0, clean |
| `npm run test` | **395 / 395** tests passed across 21 files |
| `npm run lint` | **0 errors**, 5 warnings (all `react-refresh/only-export-components`, tolerated) |
| `npm run test:e2e` | **28 / 28** passed across 5 specs (`app`, `capture`, `viewer`, `viewer-hud`, `viewer-route`) |
| `npm run build` | green in 2.35 s |

Production bundle (lazy splitting verified):

- main app chunk: **412.7 kB** minified (128.2 kB gzip) + 38.9 kB CSS (8.3 kB gzip)
- `qrcode` chunk, loaded only on the pairing card: **21.1 kB** (7.6 kB gzip)
- `PlayCanvasViewer` chunk, loaded only when the viewer opens: 2,032 kB (523 kB gzip) —
  Rollup warns on its size, which is the accepted trade-off for keeping it out of the
  initial payload ([D-012](./DECISION_LOG.md))

`npm run quality` is the single local gate. It runs core checks, records the bundle
scopes, runs browser E2E, and prints `PASS`, `FAIL`, or `BLOCKED` for
environment-dependent reconstruction prerequisites. A blocked COLMAP/CUDA preflight
does not hide a failing application test and does not prevent the fixture gate from
completing.

## Capture preparation

Prepare an image folder:

```bash
python3 scripts/prepare_capture.py ./my-capture-photos --output ./capture-output
```

Prepare a video when `ffmpeg` is installed:

```bash
python3 scripts/prepare_capture.py ./capture.mp4 --output ./capture-output --fps 2 --limit 120
```

This produces a provenance-preserving `frame-manifest.json`. It does **not** claim to
have reconstructed a scene. COLMAP, GPU reconstruction, geometry extraction, and scene
publishing remain separate pipeline stages; see [`PIPELINE.md`](./PIPELINE.md).

Generate the local GLB fixture reproducibly:

```bash
python3 scripts/generate_glb_fixture.py \
  --output public/scenes/glb-fixture/visual/architectural-fixture.glb
```

## COLMAP boundary

Run the environment preflight before attempting reconstruction:

```bash
npm run preflight:reconstruction
```

When COLMAP is installed, run the sparse baseline against prepared frames:

```bash
npm run reconstruct:colmap -- \
  --frames ./capture-output/frames \
  --output ./capture-output/colmap
```

The adapter writes `reconstruction-report.json`, a COLMAP database, and a sparse model.
It stops with an explicit blocked status when COLMAP is unavailable. It does not publish
a scene or pretend that sparse cameras are already a browser-ready visual or collision
asset.

When the supported COLMAP installation has dense stereo available:

```bash
npm run reconstruct:colmap -- \
  --frames ./capture-output/frames \
  --output ./capture-output/colmap \
  --dense
```

Add `--mesh` to run COLMAP's optional surface mesher after dense fusion; `--simplify`
and `--texture` are available as separate optional stages when supported by the
installed COLMAP build. For the Open3D route, invoke `scripts/process_geometry.py`
against `dense/fused.ply`; it performs filtering, Poisson reconstruction, PLY export,
and generated untextured GLB export. Sparse and dense outputs remain valid if a later
mesh stage is blocked.

For a generated captured-scene bundle after a genuine GLB and geometry report exist:

```bash
python3 scripts/generate_scene_bundle.py \
  --output ./capture-output/scene \
  --visual-asset ./capture-output/geometry/reconstructed-mesh.glb \
  --geometry-report ./capture-output/geometry/geometry-report.json \
  --semantic ./capture-output/pois.json \
  --navigation ./capture-output/navigation/nav-data.json \
  --frame-manifest ./capture-output/frame-manifest.json \
  --processing-report ./capture-output/colmap/reconstruction-report.json \
  --scene-id amber-hall-capture \
  --display-name "Amber Hall capture" \
  --source "consented smartphone capture" \
  --scale-status estimated
python3 scripts/validate_scene.py ./capture-output/scene
```

## Scene bundle

The fixture lives at [`public/scenes/fixture`](./public/scenes/fixture):

```text
public/scenes/fixture/
├── manifest.json
├── navigation/nav-data.json
├── quality/report.json
└── semantic/pois.json
```

The manifest supports procedural, GLB/glTF, and future SOG visual asset references. The
viewer currently renders the procedural fixture through PlayCanvas and keeps
collision/navigation data separate. A captured bundle can replace the visual branch
without rewriting search or A*.

## Limitations

- The current visible scene is synthetic and explicitly labelled as such; the generated
  architectural GLB fixture loads through the same manifest-driven path and is not
  reconstruction output.
- No real smartphone capture was processed in this environment because the workspace
  has no sample media and no COLMAP executable.
- Phone pairing ships as QR card + stage rail + tested protocol/relay (`T18`–`T20`);
  the live camera slice (`T21`) is not implemented yet, so no frames have crossed a
  real phone-to-browser data channel.
- The ws signalling relay and self-signed HTTPS are development-only (`dev:lan`),
  bound for a trusted LAN; there is no production deployment, no Origin validation,
  and no backend beyond the relay.
- PlayCanvas primitive collision is represented by the same verified navigation grid
  for fixture mode; a reconstructed collision GLB must be added for real venues.
- There is no GPU worker yet. Missing reconstruction dependencies are reported by the
  CLI rather than hidden behind fake success.
- Dense reconstruction and both COLMAP/Open3D mesh-export routes are implemented as
  optional adapter stages but remain blocked until COLMAP/Open3D and real capture data
  are supplied.
- The reconstruction adapter is implemented for COLMAP's sparse stages, but COLMAP is
  not available in the current environment so no real sparse model has been generated.
- AR, automatic semantic extraction, multi-floor routing, and hosted deployment remain
  future work.

## Documentation

- [`PROJECT_SCOPE.md`](./PROJECT_SCOPE.md)
- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`TECH_STACK_COMPARISON.md`](./TECH_STACK_COMPARISON.md)
- [`ROADMAP.md`](./ROADMAP.md)
- [`DECISION_LOG.md`](./DECISION_LOG.md)
- [`CAPTURE_SOP.md`](./CAPTURE_SOP.md)
- [`PIPELINE.md`](./PIPELINE.md)
- [`VALIDATION.md`](./VALIDATION.md)
