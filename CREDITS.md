# Credits and licences

Namma Space is built on the open-source tools and data below. Every licence was checked at its source on
15 Nov 2026: the project's own LICENSE file on GitHub, the npm registry entry for the installed version, or the
PyPI entry for the pinned version. Versions are the ones installed or pinned in this repository
(`apps/studio/package-lock.json`, `pipeline/`, `scripts/setup_tools.*`, `notebooks/build_kaggle_notebook.py`).

## Web app (`apps/studio`, shipped to browsers)

| Tool | Version | Licence | Use |
|---|---|---|---|
| [PlayCanvas engine](https://github.com/playcanvas/engine) | 2.23.3 | MIT | 3D viewer: Gaussian splats (SOG, PLY, compressed PLY), meshes, route ribbon, pins |
| [React](https://github.com/facebook/react) / react-dom | 19.3.1 | MIT | UI |
| [zod](https://github.com/colinhacks/zod) | 4.6.7 | MIT | scene bundle schema and validation |
| [three.js](https://github.com/mrdoob/three.js) | 0.186.1 | MIT | coverage visualiser in Live Scan |
| [GSAP](https://gsap.com) and @gsap/react | 3.15.0 / 2.1.2 | GreenSock "Standard no-charge" licence (free, **not** open source: [gsap.com/standard-license](https://gsap.com/standard-license)) | UI motion |
| [idb](https://github.com/jakearchibald/idb) | 8.0.4 | ISC | IndexedDB storage for captures |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3 | MIT | ZIP export of capture bundles |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 2.0.4 | MIT | pairing QR code |
| [Archivo](https://fonts.google.com/specimen/Archivo), [IBM Plex Mono](https://github.com/IBM/plex) fonts | — | SIL Open Font Licence 1.1 (texts in `apps/studio/public/fonts/`) | typography, self-hosted |

## Build and test (development only)

| Tool | Version | Licence | Use |
|---|---|---|---|
| [Vite](https://github.com/vitejs/vite) | 7.3.7 | MIT | dev server and build |
| [TypeScript](https://github.com/microsoft/TypeScript) | 5.9.3 | Apache-2.0 | types |
| [Vitest](https://github.com/vitest-dev/vitest) | 5.0.5 | MIT | unit tests |
| [Playwright](https://github.com/microsoft/playwright) | 1.64.1 | Apache-2.0 | end-to-end tests |
| [ESLint](https://github.com/eslint/eslint) | 9.39.5 | MIT | lint |
| [ws](https://github.com/websockets/ws) | 8.22.0 | MIT | development-only signalling relay for phone pairing |
| [Node.js](https://github.com/nodejs/node) | ≥ 22 (Kaggle notebook pins 22.23.5) | MIT | runs the build and splat-transform |

## Reconstruction pipeline (`pipeline/`, run offline on a GPU machine)

| Tool | Version | Licence | Use |
|---|---|---|---|
| [COLMAP](https://github.com/colmap/colmap) | 4.2.1 (Windows CUDA build) | BSD-3-Clause ("new BSD"; dependencies separately licensed) | camera poses, sparse model, undistortion |
| [pycolmap / pycolmap-cuda12](https://pypi.org/project/pycolmap-cuda12/) | 4.2.1 | BSD-3-Clause | the same on Linux/Kaggle, including GLOMAP global mapping |
| COLMAP vocabulary tree (faiss, 256K words) | 3.11.1 release asset | as COLMAP | loop closure in sequential matching |
| [Brush](https://github.com/ArthurBrussee/brush) | v0.3.0 | Apache-2.0 | Gaussian splat training (Windows default) |
| [gsplat](https://github.com/nerfstudio-project/gsplat) | 1.5.3 | Apache-2.0 | Gaussian splat training (Linux/Kaggle default; MCMC strategy) |
| [PyTorch](https://github.com/pytorch/pytorch) | as installed (Kaggle image) | BSD-3-Clause | gsplat runtime |
| [@playcanvas/splat-transform](https://github.com/playcanvas/splat-transform) | 3.11.2 | MIT | PLY → SOG / compressed PLY for the web |
| [Ultralytics](https://github.com/ultralytics/ultralytics) with YOLOv8m-seg weights | 8.4.213 | **AGPL-3.0** | masking people out of training frames (`--mask-people`). Used **offline only** on the reconstruction machine; nothing from it is distributed with the web app or in scene bundles |
| [OpenCV](https://github.com/opencv/opencv) (opencv-python-headless) | 5.0 | Apache-2.0 | frame blur scores, mask processing, coverage maps |
| [NumPy](https://github.com/numpy/numpy) | 2.x | BSD-3-Clause (bundled parts 0BSD, MIT, Zlib) | everything numeric |
| [SciPy](https://github.com/scipy/scipy) | 1.x | BSD-3-Clause | KD-trees, coverage and scene-bundle geometry |
| [FFmpeg](https://ffmpeg.org) | system build (Gyan.dev on Windows, apt on Linux) | LGPL-2.1+ (the Gyan.dev and many distro builds include GPL parts) | frame extraction; run as a separate program, never linked or redistributed |

## Data

| Data | Licence | Use |
|---|---|---|
| [Eyeful Tower](https://github.com/facebookresearch/EyefulTower) "apartment" scene (Meta; VR-NeRF, Xu et al., SIGGRAPH Asia 2023) | MIT (full text in `apps/studio/public/scenes/apartment/LICENSE-EyefulTower.txt`) | the Apartment scene: we trained the splat and derived navigation and places from it |
| Classroom and workshop captures | ours | the Classroom and Workshop room scenes, `tests/sample_data/` |

## Namma Space's own licence

Our code is released under the **MIT licence** ([LICENSE](LICENSE)), copyright 2026 the four team members. Two
third-party pieces carry different terms, and neither changes that:

- **Ultralytics YOLOv8 (AGPL-3.0) is optional and offline.** It runs only when the pipeline is called with
  `--mask-people`, on the reconstruction machine, to mask people out of training frames. It is not imported by
  the web app, not shipped to browsers and nothing of it ends up in a scene bundle. Anyone who redistributes
  the pipeline *with* Ultralytics installed must follow the AGPL for that part.
- **GSAP is free to use but not open source.** The web app uses it for UI motion under GreenSock's
  "Standard no-charge" licence ([gsap.com/standard-license](https://gsap.com/standard-license)); it is a
  dependency, not part of our MIT-licensed code.
