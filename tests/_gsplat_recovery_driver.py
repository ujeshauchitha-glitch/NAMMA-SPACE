"""Run train_gsplat.train() on the CPU with a stand-in `gsplat` whose rasteriser can be told to run out of
memory or to go bad for a stretch of steps (see test_train_recovery in test_kaggle_smoke_fixes.py).

    python tests/_gsplat_recovery_driver.py <scenario: diverge|oom|oom_twice|screen> <tmp_dir> <result.json>
Its own process: torch must not share one with pycolmap (both bundle OpenMP).
"""
import json
import math
import sys
import types
from pathlib import Path

import cv2
import numpy as np
import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

scenario, tmp, result = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
calls = {"n": 0, "widths": [], "counts": []}


class FakeMCMC:
    def __init__(self, **kw):
        pass

    def check_sanity(self, params, optimizers):
        pass

    def initialize_state(self):
        return {}

    def step_pre_backward(self, *a):
        pass

    def step_post_backward(self, *a, **k):
        pass


def fake_rasterization(means, quats, scales, opacities, colors, viewmats, Ks, width, height, sh_degree, packed,
                       rasterize_mode):
    calls["n"] += 1
    calls["widths"].append(width)
    calls["counts"].append(len(means))
    if scenario.startswith("oom") and calls["n"] > 50 and (width > 32 or scenario == "oom_twice"):
        raise torch.OutOfMemoryError("CUDA out of memory. Tried to allocate 2.20 GiB (stand-in)")
    w = opacities[:, None] * torch.exp(-scales.mean(1, keepdim=True)) * quats.norm(dim=1, keepdim=True)
    base = (colors[:, 0, :] * 0.2820948 + 0.5 + colors[:, 1:, :].mean(1)) * w + means.mean() * 0
    rgb = torch.sigmoid(base.sum(0) / (w.sum() + 1e-6))
    img = rgb[None, None, None, :].expand(1, height, width, 3)
    if scenario == "diverge" and 45 <= calls["n"] < 60:  # a bad stretch: the loss jumps, then recovers
        img = (img + 0.6).clamp(0, 1) * 0 + 1.0
    return img, torch.ones(1, height, width, 1), {}


gs = types.ModuleType("gsplat")
gs.rasterization = fake_rasterization
strategy = types.ModuleType("gsplat.strategy")
strategy.MCMCStrategy = FakeMCMC
gs.strategy = strategy
sys.modules["gsplat"], sys.modules["gsplat.strategy"] = gs, strategy

import train_gsplat as tg  # noqa: E402

tg.LossMonitor.__init__.__defaults__ = (10, tg.DIVERGENCE_FACTOR)  # 10-step window for a 120-step run

W, H, F = 64, 48, 50.0
img_dir = tmp / "images"
img_dir.mkdir(parents=True, exist_ok=True)
for k in range(12):
    cv2.imwrite(str(img_dir / f"v{k:02d}.png"), np.full((H, W, 3), 128, np.uint8))


def fake_load(dataset, max_width):
    f = tg.downscale_factor(W, max_width)
    views = []
    for k in range(12):
        a = 2 * math.pi * k / 12
        eye = np.array([2 * math.cos(a), 0.0, 2 * math.sin(a)])
        fwd = -eye / np.linalg.norm(eye)
        right = np.cross([0, 1, 0], fwd)
        right /= np.linalg.norm(right)
        up = np.cross(fwd, right)
        c2w = np.eye(4)
        c2w[:3, :3] = np.stack([right, up, fwd], 1)
        c2w[:3, 3] = eye
        K = np.array([[F, 0, W / 2], [0, F, H / 2], [0, 0, 1]], np.float64)
        K[:2] /= f
        views.append(tg.View(f"v{k:02d}.png", img_dir / f"v{k:02d}.png", None, K, c2w, W // f, H // f))
    pts = np.random.default_rng(0).uniform(-0.5, 0.5, (200, 3))
    return views, pts, np.full((200, 3), 0.5, np.float32)


tg.load_dataset = fake_load
out = {}
if scenario == "screen":
    vm = torch.eye(4)
    K = torch.tensor([[F, 0, W / 2], [0, F, H / 2], [0, 0, 1]])
    means = torch.tensor([[0, 0, 0.1], [0, 0, 2.0], [0, 0, -0.5]])
    logs = torch.log(torch.tensor([[0.1] * 3, [0.01] * 3, [5.0] * 3]))
    out["keep"] = tg.screen_keep(means, logs, vm, K, W, H, tg.MAX_SCREEN_RADIUS_FRAC).tolist()
else:
    cfg = tg.TrainConfig(steps=120, max_width=64, max_splats=300, guard_start=40, guard_every=20, init_scale=50.0)
    try:
        out["stats"] = tg.train(tmp, tmp / "splat.ply", cfg, log_every=20, device="cpu")
        _, props, data = __import__("clean_splat").read_ply(tmp / "splat.ply")
        logs = data[:, [props.index(f"scale_{i}") for i in range(3)]]
        out["max_log_scale_normalised"] = float(logs.max() + math.log(out["stats"]["normalisation"]["scale"]))
    except Exception as e:  # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {e}"
        out["oom"] = tg.is_oom(e)
        out["attempts"] = getattr(e, "attempts", None)
out["widths"] = sorted(set(calls["widths"]))
out["counts"] = sorted(set(calls["counts"]))
result.write_text(json.dumps(out, default=str))
