# Commands and Test Verification

## Automated Test Suites

### 1. TypeScript Static Typecheck
```bash
npm run typecheck
```
- **Command**: `tsc -b`
- **Result**: PASSED (0 errors)

### 2. ESLint
```bash
npm run lint
```
- **Command**: `eslint .`
- **Result**: PASSED (0 errors)

### 3. Vitest Unit & Integration Suite
```bash
npm test
```
- **Command**: `vitest run`
- **Result**: PASSED (679/679 tests across 36 files)

### 4. Scene Manifest & Bundle Validation
```bash
npm run validate:scenes
```
- **Command**: `python3 scripts/validate_all_scenes.py public/scenes`
- **Validated Bundles**:
  - `The Amber Hall` (`fixture`): PASSED (4 POIs, 128 blocked cells, 0 hashed assets)
  - `The Amber Hall · GLB asset` (`glb-fixture`): PASSED (4 POIs, 128 blocked cells, 1 hashed asset)
  - `SYNTHETIC splat fixture` (`splat-fixture`): PASSED (1 POI, 40 blocked cells, 1 hashed asset)
- **Result**: PASSED (3/3 scenes validated)

### 5. Production Build & Chunk Budget Verification
```bash
npm run build
python3 scripts/check_chunks.py
```
- **Command**: `tsc -b && vite build` followed by chunk gzip auditing
- **Result**: PASSED (All entry and lazy chunks strictly within budget)

### 6. Python Observation Preprocessing & Pipeline Tests
```bash
uv run --with pytest python -m pytest tests -q
```
- **Result**: PASSED (78/78 tests passed)

### 7. Playwright Browser E2E Test Suite
```bash
npm run test:e2e
```
- **Command**: `playwright test`
- **Coverage**: 36 comprehensive browser tests spanning tab navigation, canvas lifecycle, image staging, ZIP export, POI search, A* routing, HUD responsiveness, and reduced motion.
