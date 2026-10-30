#!/usr/bin/env python3
"""Pre-deploy gate for the Namma Space studio app.

Runs before any production deploy (`npm run predeploy`). It asserts only
things this script can actually verify, and says so:

1. Every scene bundle under public/scenes/ passes validate_scene.py.
2. dist/ exists (run `npm run build` first) and is reported by size.
3. The built assets still carry the honest Live-Scan label — the production
   bundle must keep stating that the `/ws` signalling relay only exists in
   the Vite dev server, so the hosted build never implies Live Scan works.

What this script does NOT check (delegated to the human checklist in
submission/DEPLOYMENT.md): hosting auth, DNS, runtime console cleanliness,
real-device camera capture, and route-planner behaviour in a browser.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent

# The exact honesty label rendered by LiveScanWorkspace.tsx when the relay is
# absent. If this string disappears from a production bundle, the dev-only
# limitation is no longer visible to users — that is a deploy blocker.
HONESTY_LABEL = "hosted build has no relay"


def fail(message: str) -> int:
    print(f"PREDEPLOY FAIL  {message}")
    return 1


def main() -> int:
    failures = 0

    # 1 — scene bundles validate against the shared URI/integrity contract.
    scenes_root = APP_ROOT / "public" / "scenes"
    result = subprocess.run(
        [sys.executable, str(APP_ROOT / "scripts" / "validate_all_scenes.py"), str(scenes_root)],
        check=False,
    )
    if result.returncode != 0:
        failures += fail(f"scene validation failed (exit {result.returncode})")

    # 2 — dist/ must exist (build first) and is reported by size, not judged.
    dist = APP_ROOT / "dist"
    if not dist.is_dir():
        print("PREDEPLOY FAIL  dist/ does not exist — run `npm run build` first.")
        return 1
    files = [path for path in dist.rglob("*") if path.is_file()]
    total_bytes = sum(path.stat().st_size for path in files)
    print(f"dist/: {len(files)} files, {total_bytes / (1024 * 1024):.2f} MiB total")

    # Same-origin scene bundles must have been copied into the build output;
    # sceneLoader.ts rejects cross-origin manifests under /scenes/.
    bundled_manifests = sorted(dist.glob("scenes/*/manifest.json"))
    if not bundled_manifests:
        failures += fail("no scene manifests found under dist/scenes/ — public/scenes/ did not reach the build output")
    else:
        print(f"dist/scenes/: {len(bundled_manifests)} scene bundle(s): {', '.join(p.parent.name for p in bundled_manifests)}")

    # 3 — the honest dev-only Live Scan label must survive minification.
    haystacks = [path for path in files if path.suffix in {".js", ".html", ".css"}]
    if not any(HONESTY_LABEL in path.read_text(encoding="utf-8", errors="ignore") for path in haystacks):
        failures += fail(
            f"built assets no longer contain the Live-Scan dev-only label ({HONESTY_LABEL!r}) — "
            "the hosted build would silently imply a relay exists"
        )
    else:
        print(f"built assets: honest dev-only label present ({HONESTY_LABEL!r})")

    if failures:
        print(f"PREDEPLOY FAIL  {failures} check(s) failed — do not deploy.")
        return 1
    print("PREDEPLOY PASS  deployable (browser/runtime checks remain in the DEPLOYMENT.md checklist).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
