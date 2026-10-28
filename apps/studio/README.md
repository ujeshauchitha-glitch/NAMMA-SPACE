# Namma Space

**Capture an indoor space, build a trustworthy scene bundle, and explore it in the browser.**

Namma Space is a spatial-twin prototype for Techfest 2026–27 at IIT Bombay. It brings together an image-capture workspace, a first-person scene viewer, and an offline photogrammetry pipeline. The project is deliberately explicit about what is measured, what is generated, and what is still a prototype.

> **Current demo:** the bundled scene is synthetic. It demonstrates the viewer and navigation contracts; it is not a reconstruction of a real venue. COLMAP reconstruction and phone-to-browser frame delivery are not yet a complete, verified end-to-end flow.

## See it run

```bash
npm ci
npm run dev
```

Open the local URL, choose **02 · Spatial Viewer**, and try the walkthrough. Use **WASD** to move, the mouse to look, and **Escape** to leave pointer lock. The bundled fixture works without a phone, GPU, or reconstruction software.

For development on a phone and computer on the same local network, run `npm run dev:lan` instead. It uses self-signed HTTPS and the development signalling relay; see [Live Scan](#live-scan-and-capture) before relying on it.

## What works today

| Workspace | Available now |
|---|---|
| **Capture Studio** | Import and inspect images, organize captures, persist workspace data in IndexedDB, and export a scene bundle with a validated manifest and SHA-256 digests. |
| **Spatial Viewer** | Load the bundled scene, explore in first person, search points of interest, and request routes computed from the scene's occupancy grid. Unavailable routes are reported as unavailable. |
| **Live Scan** | Pairing UI, QR session tokens, a local signalling relay, WebRTC peer primitives, camera-access and frame-capture helpers, chunk planning, and SHA-256-verified frame assembly. The camera and transfer primitives are not yet wired into a complete phone-to-Capture-Studio workflow. |
| **Scene pipeline** | Prepare frames, run the COLMAP adapter when installed, optionally process geometry, generate scene bundles, and validate bundle contents with Python CLI tools. Missing external dependencies are reported as blocked rather than simulated as success. |

## How the pieces fit

```text
Browser app                                  Local processing tools
┌───────────────────────────────┐            ┌────────────────────────────┐
│ Capture Studio                │  image ZIP │ prepare frames             │
│   inspect · organize · export │ ─────────► │ COLMAP adapter (optional)  │
│                               │            │ geometry / scene bundling  │
│ Live Scan                     │  dev relay │ validate scene bundle      │
│   pairing · camera primitives│ ◄─────────►│                            │
│                               │  scene     └──────────────┬─────────────┘
│ Spatial Viewer                │ ◄─────────────────────────┘
│   PlayCanvas · POIs · A*      │
└───────────────────────────────┘
```

The scene bundle keeps visual assets, navigation data, points of interest, and quality/provenance metadata as separate inputs. This lets the viewer use a photorealistic asset for appearance while relying on explicit scene data for routes. The current fixture demonstrates that contract; it does not establish real-world reconstruction quality.

## Run and validate

**Requirements:** Node.js 20+ with npm. Python 3 is needed for capture and scene-pipeline commands. A WebGL 2-capable browser is needed for the viewer. Video frame extraction additionally requires `ffmpeg`; reconstruction requires a compatible COLMAP installation.

| Command | Purpose |
|---|---|
| `npm run dev` | Start the local Vite app |
| `npm run dev:lan` | Start the development HTTPS server and LAN signalling relay |
| `npm run build` | Type-check and build the production app |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Run the TypeScript project checks |
| `npm run lint` | Run ESLint |
| `npm run test` | Run the Vitest unit tests |
| `npm run test:e2e` | Run the Playwright browser tests |
| `npm run quality` | Run the repository's combined quality gate |
| `npm run validate:scenes` | Validate scene bundles under `public/scenes` |
| `npm run preflight:reconstruction` | Check reconstruction prerequisites |

To prepare an image directory:

```bash
python3 scripts/prepare_capture.py ./my-capture-photos --output ./capture-output
```

To sample a video (requires `ffmpeg`):

```bash
python3 scripts/prepare_capture.py ./capture.mp4 \
  --output ./capture-output \
  --fps 2 \
  --limit 120
```

Frame preparation is not reconstruction. When COLMAP is installed, run the sparse baseline against prepared frames:

```bash
npm run reconstruct:colmap -- \
  --frames ./capture-output/frames \
  --output ./capture-output/colmap
```

Dense reconstruction and mesh processing are optional, dependency-sensitive stages. See [PIPELINE.md](./PIPELINE.md) for stage requirements, outputs, and scene-bundle generation.

## Live Scan and capture

`npm run dev:lan` enables the development-only `/ws` signalling relay and self-signed HTTPS, which browsers require for camera access from another device. Use it only on a trusted local network. Plain `npm run dev` remains loopback HTTP.

The repository includes camera permission/error handling, a camera preview component, mirrored JPEG frame capture (capped at a 1600-pixel long edge), binary WebRTC data-channel support, and chunk reassembly that checks the complete frame's SHA-256 before acknowledging it. These are building blocks—not a claim that a phone can currently send a complete capture into Capture Studio. The relay is not a production signalling service, and the current app does not include a hosted backend.

## Technical overview

- **Frontend:** React, TypeScript, Vite, CSS Modules, and Zod schemas.
- **3D viewer:** PlayCanvas, loaded lazily when the viewer opens.
- **Local browser data:** IndexedDB-backed persistence.
- **Pairing:** WebRTC data channel with signalling over a Vite development WebSocket relay.
- **Processing:** Python command-line tools; COLMAP for reconstruction and optional Open3D geometry processing.
- **Tests:** Vitest, Testing Library, and Playwright.

## Known limitations

- The included viewer scene is synthetic; no real smartphone capture has been reconstructed into a scene in this repository.
- COLMAP, suitable capture data, and a configured reconstruction worker are required for real reconstruction. The project does not pretend these are available when they are not.
- Phone pairing and camera/frame-transfer code are not yet integrated into a complete capture workflow.
- LAN signalling and self-signed HTTPS are development facilities, not a production deployment.
- Automatic semantic extraction, hosted processing, multi-floor navigation, and AR are not implemented.

## Project documentation

- [Capture SOP](./CAPTURE_SOP.md) — recording and preparing useful input media.
- [Pipeline guide](./PIPELINE.md) — implemented processing stages and dependency boundaries.
- [Architecture](./ARCHITECTURE.md) — scene contracts and system boundaries.
- [Validation record](./VALIDATION.md) — automated and manual validation evidence.
- [Project scope](./PROJECT_SCOPE.md) and [roadmap](./ROADMAP.md) — milestones and planned work.
- [Decision log](./DECISION_LOG.md) and [technology comparison](./TECH_STACK_COMPARISON.md) — key technical choices.
