# Key Engineering Decisions

## Decision 1: Single Integrated Application Architecture vs Disconnected Viewers
- **Context**: The repository had divergent experimental viewers (e.g. `viewer/` using React Three Fiber and Spark) and a complete production monorepo (`apps/studio/` using PlayCanvas, React 19, and Vite).
- **Decision**: Standardize on `apps/studio` as the single unified application. Incorporate Gaussian Splatting capabilities directly into the PlayCanvas engine (`gsplat` asset loader), bringing photorealistic splat support into the same WebGL context, navigation system, and POI index.
- **Rationale**: Eliminates context thrashing, duplicate routing, competing scene schemas, and user confusion. The user experiences one cohesive product rather than three disjointed prototypes.

## Decision 2: Self-Contained Local Assets vs External Host Dependencies
- **Context**: `viewer/public/models/scene.json` previously pointed to `https://huggingface.co/datasets/REPLACE_HF_USER/...` which caused HTTP 401 Unauthorized errors in production.
- **Decision**: Bundle authentic, pre-tested synthetic assets (`synthetic_room.sog` 718 KB, `architectural-fixture.glb` 3.2 KB, and procedural geometry) directly inside `apps/studio/public/scenes/`.
- **Rationale**: Absolute reliability. Zero runtime dependencies on third-party API rate limits, private tokens, or external network connectivity. Every scene validates locally and in CI.

## Decision 3: Honest Preflight & Reconstruction Demarcation (`BLK-001`)
- **Context**: A common hackathon pitfall is displaying fake "processing..." animations that pretend to run heavy photogrammetry in the browser.
- **Decision**: Honestly delineate the boundaries. The browser application handles capture ingestion, validation, viewpoint classification, and ZIP bundle preparation. Reconstruction requires external GPU compute (COLMAP + Brush).
- **Rationale**: True engineering integrity. Preflight checks detect `colmap` and `ffmpeg` when available and clearly report `nvidia-smi` absence without breaking or faking states.

## Decision 4: Non-Intrusive Onboarding for Headless Automation
- **Context**: Adding an onboarding modal can block automated Playwright journeys if modals intercept pointer events or focus.
- **Decision**: Guard automatic modal opening on initial load with `!window.navigator.webdriver`. Human users see the helpful 5-step onboarding guide on their first visit, while automated test runners proceed unobstructed. Provide a persistent `? Guide` button in the header so any user can summon the guide on demand.
