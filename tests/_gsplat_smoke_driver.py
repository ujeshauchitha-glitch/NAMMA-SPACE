"""Run train_gsplat.train() on the CPU with a stand-in `gsplat` (see test_train_gsplat_smoke.py).

    python tests/_gsplat_smoke_driver.py <dataset> <out.ply> <result.json>
Runs in its own process because torch must not share one with pycolmap (both bundle OpenMP).
"""
import json
import sys
import types
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

calls = []


class FakeMCMC:
    def __init__(self, **kw):
        self.kw = kw
        calls.append(("init", kw))

    def check_sanity(self, params, optimizers):
        assert {"means", "scales", "quats", "opacities"} <= set(params) and set(optimizers) == set(params)

    def initialize_state(self):
        return {}

    def step_pre_backward(self, params, optimizers, state, step, info):
        pass

    def step_post_backward(self, params, optimizers, state, step, info, lr):
        # every parameter must have received a gradient this step (the loss reaches all of them)
        assert all(p.grad is None for p in params.values())  # optimisers already zeroed them (set_to_none)
        calls.append(("post", step, lr, len(params["means"])))


def fake_rasterization(means, quats, scales, opacities, colors, viewmats, Ks, width, height, sh_degree, packed,
                       rasterize_mode):
    assert colors.shape[1:] == (16, 3) and rasterize_mode == "antialiased" and not packed
    assert viewmats.shape == (1, 4, 4) and Ks.shape == (1, 3, 3) and 0 <= sh_degree <= 3
    w = opacities[:, None] * torch.exp(-scales.mean(1, keepdim=True)) * quats.norm(dim=1, keepdim=True)
    base = (colors[:, 0, :] * 0.2820948 + 0.5 + colors[:, 1:, :].mean(1)) * w + means.mean() * 0
    rgb = torch.sigmoid(base.sum(0) / (w.sum() + 1e-6))
    ramp = torch.linspace(0, 1, width)[None, None, :, None]
    img = (rgb[None, None, None, :] * (0.5 + 0.5 * ramp)).expand(1, height, width, 3)
    return img, torch.ones(1, height, width, 1), {}


gs = types.ModuleType("gsplat")
gs.rasterization = fake_rasterization
strategy = types.ModuleType("gsplat.strategy")
strategy.MCMCStrategy = FakeMCMC
gs.strategy = strategy
sys.modules["gsplat"], sys.modules["gsplat.strategy"] = gs, strategy

import train_gsplat  # noqa: E402

dataset, out, result = map(Path, sys.argv[1:4])
cfg = train_gsplat.TrainConfig(steps=60, max_width=160, max_splats=5000)
stats = train_gsplat.train(dataset, out, cfg, log_every=20, device="cpu")
result.write_text(json.dumps({"stats": {k: v for k, v in stats.items() if k != "config"}, "calls": calls}))
