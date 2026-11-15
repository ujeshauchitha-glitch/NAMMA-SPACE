"""CPU smoke test of the gsplat training loop with a stand-in rasteriser (tests/_gsplat_smoke_driver.py).

gsplat's kernels need CUDA, so `gsplat` is replaced by a tiny differentiable fake. This checks everything
around the rasteriser: reading the COLMAP dataset (colmap_bin) and masks, initialisation, the loss (L1 +
SSIM + opacity/scale/anisotropy terms), backward, optimisers and LR decay, the MCMC strategy hooks and
the exported PLY. It says nothing about image quality. Training runs in a child process, as in the
pipeline, so torch never shares a process with pycolmap.
"""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

import checks
import clean_splat
import run_pipeline
import train_gsplat
from common import Report
from test_kaggle_pipeline import _render_synthetic_views, requires_pycolmap

requires_torch = pytest.mark.skipif(importlib.util.find_spec("torch") is None, reason="torch not installed")


@requires_pycolmap
@requires_torch
def test_training_loop_runs_and_exports_a_valid_ply(tmp_path):
    import cv2
    _render_synthetic_views(tmp_path / "frames")
    report = Report(tmp_path / "report.json", {"checks": {}, "stages": {}})
    old = checks.MIN_SPARSE_POINTS
    checks.MIN_SPARSE_POINTS = 100
    try:
        dataset = run_pipeline.sfm(tmp_path, "sequential", False, report, tmp_path / "log.txt", mapper="global",
                                   backend="pycolmap", loop_closure=False, max_image_size=640)
    finally:
        checks.MIN_SPARSE_POINTS = old
    (dataset / "masks").mkdir()  # people masks for two views (255 keep, 0 ignore), as mask_people.py writes them
    for img in sorted((dataset / "images").iterdir())[:2]:
        m = np.full((480, 640), 255, np.uint8)
        m[100:300, 200:400] = 0
        cv2.imwrite(str(dataset / "masks" / (img.stem + ".png")), m)

    out, result = tmp_path / "splat.ply", tmp_path / "result.json"
    driver = Path(__file__).with_name("_gsplat_smoke_driver.py")
    proc = subprocess.run([sys.executable, str(driver), str(dataset), str(out), str(result)],
                          capture_output=True, text=True, timeout=600)
    assert proc.returncode == 0, proc.stdout[-2000:] + proc.stderr[-2000:]
    r = json.loads(result.read_text())
    stats, calls = r["stats"], r["calls"]
    assert stats["views"] >= 20 and stats["resolution"][0] <= 160
    init = calls[0][1]
    assert calls[0][0] == "init" and init["cap_max"] == 5000 and init["refine_stop_iter"] < 60
    posts = [c for c in calls if c[0] == "post"]
    assert [c[1] for c in posts] == list(range(60))
    lrs = [c[2] for c in posts]
    assert lrs[-1] == pytest.approx(lrs[0] * 0.01 ** (59 / 60), rel=0.05)  # means LR decays to 1% over training
    assert "masks: 2" in proc.stdout  # the two masks were picked up

    report2 = Report(tmp_path / "r2.json", {"checks": {}, "stages": {}})
    old_min = checks.MIN_SPLATS
    checks.MIN_SPLATS = 10
    try:
        assert checks.check_splat(report2, out), report2.data["checks"]
    finally:
        checks.MIN_SPLATS = old_min
    _, props, data = clean_splat.read_ply(out)
    assert props == train_gsplat.ply_properties(3) and len(data) == stats["splats"]
    q = data[:, [props.index(f"rot_{i}") for i in range(4)]]
    assert np.allclose(np.linalg.norm(q, axis=1), 1, atol=1e-5)  # exported quaternions are normalised
