"""Train a Gaussian splat with gsplat (CUDA) from an undistorted COLMAP dataset.

    python pipeline/train_gsplat.py <dataset> <out.ply> [--steps 30000] [--max-width 1920] [--max-splats 1500000]

The dataset is what run_pipeline's sfm stage writes: images/, sparse/ (PINHOLE cameras) and, after
--mask-people, masks/<stem>.png (255 = train on it, 0 = ignore).

Choices aimed at the "needle" streaks seen from off-path viewpoints:
  * MCMC densification (gsplat MCMCStrategy, Kheradmand et al. 2024) with a hard cap on the splat count,
    instead of gradient-threshold splitting that keeps spawning thin splats along view rays;
  * scale regularisation (mean splat size) and opacity regularisation, the MCMC paper's defaults (0.01);
  * an anisotropy penalty on splats whose longest axis exceeds MAX_ANISOTROPY x their shortest, which is
    exactly the needle shape; clean_splat.py additionally caps the aspect after training;
  * antialiased rasterisation (gsplat's 2D mip filter) so splats cannot shrink below a pixel to fit one
    view and smear in the others.

Hyperparameters follow gsplat v1.5.3 examples/simple_trainer.py ("mcmc" config: init_opa 0.5, init_scale
0.1, opacity_reg 0.01, scale_reg 0.01; learning rates and the means LR decay to 1% over training). Those
values assume a normalised world, so training runs in one: centred on the cameras and scaled so the camera
path has radius 1 (see Normalisation). Unnormalised, the scale regulariser and MCMC's position noise (lr x
noise_lr x covariance, i.e. proportional to extent^3) change with COLMAP's arbitrary scale. The exported PLY
is mapped back to COLMAP's frame, so scene_bundle.py's alignment still applies.

Divergence guard: a smoothed loss (mean of the last LOSS_WINDOW steps) is checked at GUARD_STEP; if it is
more than DIVERGENCE_FACTOR x its running minimum, training restarts once with every learning rate x
RESTART_LR_SCALE; a second divergence, or an unhealthy final loss, fails with exit code 3 and no PLY.
In the 7k-step preview, MCMC refinement starts at step 116 (every 23 steps) and the SH degree rises at
steps 233, 466 and 699; that is what switches on around step 500.

Everything above `train()` is plain numpy and is unit tested without a GPU.
"""
from __future__ import annotations

import argparse
import json
import math
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))  # run as a script: find colmap_bin next to it

SH_DEGREE = 3
MAX_ANISOTROPY = 10.0
SH_C0 = 0.28209479177387814

# Divergence guard (see the module docstring). Healthy Kaggle preview runs ended at 0.016-0.017; the
# diverged ones went 0.17-0.32 at step 501 -> 0.61 at 1001 and stayed there.
LOSS_WINDOW = 100
GUARD_STEP = 1500
DIVERGENCE_FACTOR = 2.0
RESTART_LR_SCALE = 0.3
MAX_HEALTHY_FINAL_LOSS = 0.25
DIVERGED_EXIT_CODE = 3


class TrainingDiverged(RuntimeError):
    def __init__(self, message: str, monitor: "LossMonitor"):
        super().__init__(message)
        self.monitor = monitor


@dataclass
class TrainConfig:
    steps: int = 30_000
    max_width: int = 1920
    max_splats: int = 1_500_000
    antialiased: bool = True
    scale_reg: float = 0.01
    opacity_reg: float = 0.01
    aniso_reg: float = 0.1
    ssim_lambda: float = 0.2
    sh_degree_interval: int = 1000
    init_opacity: float = 0.5
    init_scale: float = 0.1
    means_lr: float = 1.6e-4
    scales_lr: float = 5e-3
    opacities_lr: float = 5e-2
    quats_lr: float = 1e-3
    sh0_lr: float = 2.5e-3
    shN_lr: float = 2.5e-3 / 20
    seed: int = 42
    lr_scale: float = 1.0        # multiplies every learning rate (RESTART_LR_SCALE on the restart)

    def guard_step(self) -> int | None:
        """Step at which the divergence guard looks; None for runs too short to judge (tests)."""
        return GUARD_STEP if self.steps >= 2 * GUARD_STEP else None

    def scaled_schedule(self) -> dict:
        """MCMC refinement window scaled with the step count (gsplat's adjust_steps does the same)."""
        f = self.steps / 30_000
        return {"refine_start_iter": int(500 * f), "refine_stop_iter": int(25_000 * f),
                "refine_every": max(1, int(100 * f)), "sh_degree_interval": max(1, int(self.sh_degree_interval * f))}


# ---------------------------------------------------------------- dataset (numpy)
@dataclass
class View:
    name: str
    image: Path
    mask: Path | None
    K: np.ndarray          # 3x3 at the training resolution
    cam_to_world: np.ndarray  # 4x4
    width: int
    height: int


def downscale_factor(width: int, max_width: int) -> int:
    """Integer downscale so the training width is at most max_width (integer keeps pixels aligned)."""
    return max(1, math.ceil(width / max_width))


def load_dataset(dataset: Path, max_width: int) -> tuple[list[View], np.ndarray, np.ndarray]:
    """Cameras, image paths and the sparse points (xyz, rgb 0..1) from an undistorted COLMAP dataset.

    Read with colmap_bin, never pycolmap: this process imports torch, and the two OpenMP runtimes clash."""
    import colmap_bin

    sparse = dataset / "sparse" / "0" if (dataset / "sparse" / "0" / "cameras.bin").exists() else dataset / "sparse"
    cams = colmap_bin.read_cameras(sparse / "cameras.bin")
    views = []
    for img in sorted(colmap_bin.read_images(sparse / "images.bin").values(), key=lambda i: i.name):
        cam = cams[img.camera_id]
        if cam.model not in ("PINHOLE", "SIMPLE_PINHOLE"):
            raise ValueError(f"{img.name}: camera model {cam.model}; train on the undistorted dataset")
        f = downscale_factor(cam.width, max_width)
        K = cam.K()
        K[:2, :] /= f
        mask = dataset / "masks" / (Path(img.name).stem + ".png")
        views.append(View(img.name, dataset / "images" / img.name, mask if mask.is_file() else None,
                          K, np.linalg.inv(img.world_to_cam()), cam.width // f, cam.height // f))
    if not views:
        raise ValueError(f"{sparse}: no posed images")
    pts, rgb = colmap_bin.read_points(sparse / "points3D.bin")
    return views, pts, rgb.astype(np.float32) / 255.0


def scene_scale(views: list[View]) -> float:
    """Radius of the camera path (gsplat's parser.scene_scale * 1.1): sets the means learning rate."""
    centres = np.array([v.cam_to_world[:3, 3] for v in views])
    return float(np.linalg.norm(centres - centres.mean(0), axis=1).max() * 1.1) or 1.0


@dataclass
class Normalisation:
    """World -> training frame: x' = (x - centre) * scale. Uniform scale and no rotation, so quaternions and
    SH are unchanged and log-scales shift by log(scale)."""
    centre: np.ndarray
    scale: float

    @classmethod
    def from_views(cls, views: list[View]) -> "Normalisation":
        centres = np.array([v.cam_to_world[:3, 3] for v in views], np.float64)
        return cls(centres.mean(0), 1.0 / scene_scale(views))

    def points(self, xyz: np.ndarray) -> np.ndarray:
        return ((np.asarray(xyz, np.float64) - self.centre) * self.scale).astype(np.float32)

    def cam_to_world(self, c2w: np.ndarray) -> np.ndarray:
        out = np.array(c2w, np.float64)
        out[:3, 3] = (out[:3, 3] - self.centre) * self.scale
        return out

    def export(self, means: np.ndarray, log_scales: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Training frame -> COLMAP frame, for the PLY."""
        return (np.asarray(means, np.float64) / self.scale + self.centre).astype(np.float32), \
            (np.asarray(log_scales, np.float64) - math.log(self.scale)).astype(np.float32)


class LossMonitor:
    """Smoothed training loss (mean of the last `window` steps), its running minimum, and the checks the
    divergence guard and the train-stage cache use."""

    def __init__(self, window: int = LOSS_WINDOW, factor: float = DIVERGENCE_FACTOR):
        self.window, self.factor = window, factor
        self.recent: list[float] = []
        self.smoothed: float | None = None
        self.min: float | None = None
        self.history: list[tuple[int, float]] = []  # (step, smoothed) every `window` steps

    def add(self, step: int, loss: float) -> None:
        self.recent.append(float(loss))
        if len(self.recent) > self.window:
            self.recent.pop(0)
        if len(self.recent) == self.window:
            self.smoothed = sum(self.recent) / self.window
            if math.isfinite(self.smoothed):
                self.min = self.smoothed if self.min is None else min(self.min, self.smoothed)
            if (step + 1) % self.window == 0:
                self.history.append((step + 1, round(self.smoothed, 5)))

    def diverged(self) -> bool:
        if self.smoothed is None:
            return False
        if not math.isfinite(self.smoothed):
            return True
        return self.min is not None and self.smoothed > self.factor * self.min

    def healthy(self) -> bool | None:
        """Final verdict: None if too few steps to tell."""
        if self.smoothed is None:
            return None
        return not self.diverged() and self.smoothed <= MAX_HEALTHY_FINAL_LOSS

    def summary(self) -> dict:
        r = lambda v: None if v is None or not math.isfinite(v) else round(v, 5)
        return {"final_loss": r(self.smoothed), "min_loss": r(self.min), "loss_window": self.window,
                "healthy": self.healthy(), "loss_history": self.history}


def knn_mean_distance(points: np.ndarray, k: int = 3) -> np.ndarray:
    """Mean distance to the k nearest other points (initial splat size), via scipy's KD-tree."""
    from scipy.spatial import cKDTree

    if len(points) <= 1:
        return np.full(len(points), 0.01, np.float32)
    k = min(k, len(points) - 1)
    d, _ = cKDTree(points).query(points, k=k + 1)
    return np.sqrt((d[:, 1:] ** 2).mean(1)).astype(np.float32).clip(1e-7)


def anisotropy(log_scales: np.ndarray) -> np.ndarray:
    """Longest / shortest axis per splat from log-scales (what the needle penalty and clean_splat measure)."""
    return np.exp(log_scales.max(1) - log_scales.min(1))


# ---------------------------------------------------------------- PLY export (numpy)
def ply_properties(sh_degree: int = SH_DEGREE) -> list[str]:
    """Standard 3DGS (INRIA) vertex layout, as Brush, gsplat's exporter and splat-transform write/read it."""
    rest = 3 * ((sh_degree + 1) ** 2 - 1)
    return (["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2"]
            + [f"f_rest_{i}" for i in range(rest)]
            + ["opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"])


def write_ply(path: Path, means: np.ndarray, log_scales: np.ndarray, quats: np.ndarray, opacity_logits: np.ndarray,
              sh0: np.ndarray, shN: np.ndarray) -> int:
    """Binary little-endian float32 PLY. sh0 is (N,1,3), shN (N,K-1,3); f_rest is stored channel-major
    (all R coefficients, then G, then B), the INRIA convention every splat viewer expects. Quaternions
    are wxyz (rot_0 = w). Rows with any non-finite value are dropped. Returns the number written."""
    n = len(means)
    sh0 = np.asarray(sh0, np.float32).reshape(n, 1, 3)
    shN = np.asarray(shN, np.float32).reshape(n, -1, 3)
    cols = [np.asarray(means, np.float32).reshape(n, 3), np.zeros((n, 3), np.float32), sh0[:, 0, :],
            shN.transpose(0, 2, 1).reshape(n, -1), np.asarray(opacity_logits, np.float32).reshape(n, 1),
            np.asarray(log_scales, np.float32).reshape(n, 3), np.asarray(quats, np.float32).reshape(n, 4)]
    data = np.concatenate(cols, axis=1)
    data = data[np.isfinite(data).all(1)]
    sh_degree = int(round(math.sqrt(shN.shape[1] + 1))) - 1
    props = ply_properties(sh_degree)
    assert data.shape[1] == len(props), (data.shape, len(props))
    header = "\n".join(["ply", "format binary_little_endian 1.0", f"element vertex {len(data)}",
                        *[f"property float {p}" for p in props], "end_header"]) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header.encode("ascii") + data.astype("<f4").tobytes())
    return len(data)


# ---------------------------------------------------------------- training (torch + gsplat, CUDA)
def ssim(x, y, window: int = 11):
    """SSIM with a Gaussian window (plain torch; avoids building fused-ssim). x, y: [B,3,H,W] in 0..1."""
    import torch
    import torch.nn.functional as F

    g = torch.exp(-((torch.arange(window, device=x.device) - window // 2) ** 2) / (2 * 1.5 ** 2))
    g = (g / g.sum()).float()
    kernel = (g[:, None] @ g[None, :]).expand(3, 1, window, window).contiguous()
    conv = lambda t: F.conv2d(t, kernel, groups=3)
    mx, my = conv(x), conv(y)
    sxx, syy, sxy = conv(x * x) - mx ** 2, conv(y * y) - my ** 2, conv(x * y) - mx * my
    c1, c2 = 0.01 ** 2, 0.03 ** 2
    return (((2 * mx * my + c1) * (2 * sxy + c2)) / ((mx ** 2 + my ** 2 + c1) * (sxx + syy + c2))).mean()


def load_image(view: View):
    import cv2

    img = cv2.cvtColor(cv2.imread(str(view.image)), cv2.COLOR_BGR2RGB)
    if img.shape[1] != view.width:
        img = cv2.resize(img, (view.width, view.height), interpolation=cv2.INTER_AREA)
    mask = None
    if view.mask is not None:
        m = cv2.imread(str(view.mask), cv2.IMREAD_GRAYSCALE)
        mask = cv2.resize(m, (view.width, view.height), interpolation=cv2.INTER_NEAREST) > 127
    return img, mask


def train(dataset: Path, out: Path, cfg: TrainConfig, log_every: int = 500, device: str = "cuda") -> dict:
    """Train and export. `device` is "cuda" in real runs; tests pass "cpu" with a stand-in rasteriser.
    Raises TrainingDiverged (no PLY written) if training diverges twice or ends with an unhealthy loss."""
    import torch

    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("gsplat training needs a CUDA GPU")
    views, pts, rgb = load_dataset(dataset, cfg.max_width)
    norm = Normalisation.from_views(views)
    print(f"gsplat: {len(views)} views at {views[0].width}x{views[0].height}, {len(pts)} SfM points, "
          f"{cfg.steps} steps, cap {cfg.max_splats:,} splats, masks: {sum(v.mask is not None for v in views)}, "
          f"camera-path radius {1 / norm.scale:.3g} model units (normalised to 1)", flush=True)
    t0 = time.time()
    # Images stay on the CPU as uint8 (a 2-minute 1080p walk is ~2 GB); one is copied to the GPU per step.
    cache = [load_image(v) for v in views]
    attempts = []

    def attempt(c: TrainConfig) -> tuple[dict, LossMonitor]:
        return _fit(views, cache, pts, rgb, norm, c, log_every, torch.device(device))

    params, monitor, used = run_with_restart(attempt, cfg, attempts)
    if monitor.healthy() is False:
        raise TrainingDiverged(f"training ended with an unhealthy loss ({monitor.summary()['final_loss']}, "
                               f"minimum {monitor.summary()['min_loss']})", monitor)
    import torch.nn.functional as F
    with torch.no_grad():
        q = F.normalize(params["quats"], dim=-1)
        means, log_scales = norm.export(params["means"].cpu().numpy(), params["scales"].cpu().numpy())
        written = write_ply(out, means, log_scales, q.cpu().numpy(), params["opacities"].cpu().numpy(),
                            params["sh0"].cpu().numpy(), params["shN"].cpu().numpy())
        aniso = anisotropy(log_scales)
    dev = torch.device(device)
    stats = {"splats": written, "views": len(views), "resolution": [views[0].width, views[0].height],
             "seconds": round(time.time() - t0, 1), "needles_over_max_anisotropy": int((aniso > MAX_ANISOTROPY).sum()),
             "gpu": torch.cuda.get_device_name(0) if dev.type == "cuda" else "cpu",
             "peak_gpu_gb": round(torch.cuda.max_memory_allocated() / 1e9, 2) if dev.type == "cuda" else 0,
             **monitor.summary(), "restarts": len(attempts) - 1, "attempts": attempts,
             "lr_scale": used.lr_scale, "schedule": used.scaled_schedule(),
             "normalisation": {"centre": np.round(norm.centre, 5).tolist(), "scale": norm.scale},
             "config": asdict(used)}
    print("gsplat:", json.dumps({k: v for k, v in stats.items() if k not in ("config", "loss_history")}))
    return stats


def run_with_restart(attempt, cfg: TrainConfig, log: list) -> tuple:
    """attempt(cfg) -> (params, monitor), raising TrainingDiverged at the guard step. One restart with
    lower learning rates; a second divergence is re-raised. `log` collects one summary per attempt."""
    from dataclasses import replace
    for n, c in enumerate([cfg, replace(cfg, lr_scale=cfg.lr_scale * RESTART_LR_SCALE)]):
        try:
            params, monitor = attempt(c)
        except TrainingDiverged as e:
            log.append({"lr_scale": c.lr_scale, "diverged": str(e), **e.monitor.summary()})
            if n == 0:
                print(f"gsplat: {e}; restarting once with learning rates x{RESTART_LR_SCALE}", flush=True)
                continue
            raise TrainingDiverged(f"training diverged twice (learning rates x1 and x{c.lr_scale:g}): {e}",
                                   e.monitor) from e
        log.append({"lr_scale": c.lr_scale, "diverged": None, **monitor.summary()})
        return params, monitor, c
    raise AssertionError("unreachable")


def _fit(views: list[View], cache: list, pts: np.ndarray, rgb: np.ndarray, norm: Normalisation, cfg: TrainConfig,
         log_every: int, dev) -> tuple:
    """One training run in the normalised frame. Returns (params, LossMonitor)."""
    import torch
    import torch.nn.functional as F
    from gsplat import rasterization
    from gsplat.strategy import MCMCStrategy

    torch.manual_seed(cfg.seed)
    np.random.seed(cfg.seed)
    sched = cfg.scaled_schedule()
    Ks = torch.tensor(np.stack([v.K for v in views]), dtype=torch.float32, device=dev)
    c2w = torch.tensor(np.stack([norm.cam_to_world(v.cam_to_world) for v in views]), dtype=torch.float32, device=dev)
    viewmats = torch.linalg.inv(c2w)
    radius = 1.0  # the camera path radius after normalisation (scene_scale already includes gsplat's 1.1)
    p = norm.points(pts)

    n = len(p)
    log_scales = np.log(knn_mean_distance(p) * cfg.init_scale)[:, None].repeat(3, 1)
    sh = np.zeros((n, (SH_DEGREE + 1) ** 2, 3), np.float32)
    sh[:, 0, :] = (rgb - 0.5) / SH_C0
    params = torch.nn.ParameterDict({
        "means": torch.nn.Parameter(torch.tensor(p, device=dev)),
        "scales": torch.nn.Parameter(torch.tensor(log_scales, device=dev)),
        "quats": torch.nn.Parameter(torch.rand((n, 4), device=dev)),
        "opacities": torch.nn.Parameter(torch.logit(torch.full((n,), cfg.init_opacity, device=dev))),
        "sh0": torch.nn.Parameter(torch.tensor(sh[:, :1], device=dev)),
        "shN": torch.nn.Parameter(torch.tensor(sh[:, 1:], device=dev)),
    })
    k = cfg.lr_scale
    lrs = {"means": cfg.means_lr * radius * k, "scales": cfg.scales_lr * k, "quats": cfg.quats_lr * k,
           "opacities": cfg.opacities_lr * k, "sh0": cfg.sh0_lr * k, "shN": cfg.shN_lr * k}
    optimizers = {k: torch.optim.Adam([{"params": params[k], "lr": lr, "name": k}], eps=1e-15) for k, lr in lrs.items()}
    means_sched = torch.optim.lr_scheduler.ExponentialLR(optimizers["means"], gamma=0.01 ** (1.0 / cfg.steps))
    strategy = MCMCStrategy(cap_max=cfg.max_splats, refine_start_iter=sched["refine_start_iter"],
                            refine_stop_iter=sched["refine_stop_iter"], refine_every=sched["refine_every"])
    strategy.check_sanity(params, optimizers)
    state = strategy.initialize_state()
    log_aniso = math.log(MAX_ANISOTROPY)
    monitor = LossMonitor()
    guard = cfg.guard_step()
    t0 = time.time()

    order = np.random.permutation(len(views))
    for step in range(cfg.steps):
        i = int(order[step % len(order)])
        if step % len(order) == len(order) - 1:
            order = np.random.permutation(len(views))
        img, mask = cache[i]
        gt = torch.from_numpy(img).to(dev, non_blocking=True).float().div_(255.0)[None]
        v = views[i]
        sh_degree = min(step // sched["sh_degree_interval"], SH_DEGREE)
        colors, alphas, info = rasterization(
            means=params["means"], quats=params["quats"], scales=torch.exp(params["scales"]),
            opacities=torch.sigmoid(params["opacities"]), colors=torch.cat([params["sh0"], params["shN"]], 1),
            viewmats=viewmats[i:i + 1], Ks=Ks[i:i + 1], width=v.width, height=v.height, sh_degree=sh_degree,
            packed=False, rasterize_mode="antialiased" if cfg.antialiased else "classic")
        strategy.step_pre_backward(params, optimizers, state, step, info)
        if mask is not None:  # masked pixels (people): replace the render with the target there, so zero loss
            keep = torch.from_numpy(mask).to(dev)[None, ..., None].float()
            colors = colors * keep + gt * (1 - keep)
        l1 = F.l1_loss(colors, gt)
        loss = (1 - cfg.ssim_lambda) * l1 + cfg.ssim_lambda * (1 - ssim(colors.permute(0, 3, 1, 2), gt.permute(0, 3, 1, 2)))
        loss = loss + cfg.opacity_reg * torch.sigmoid(params["opacities"]).mean()
        loss = loss + cfg.scale_reg * torch.exp(params["scales"]).mean()
        s = params["scales"]
        loss = loss + cfg.aniso_reg * F.relu(s.max(1).values - s.min(1).values - log_aniso).mean()
        loss.backward()
        for opt in optimizers.values():
            opt.step()
            opt.zero_grad(set_to_none=True)
        means_sched.step()
        strategy.step_post_backward(params, optimizers, state, step, info, lr=means_sched.get_last_lr()[0])
        monitor.add(step, loss.item())
        if step % log_every == 0 or step == cfg.steps - 1:
            el = time.time() - t0
            print(f"gsplat: step {step + 1}/{cfg.steps} loss {loss.item():.4f} smoothed "
                  f"{monitor.smoothed if monitor.smoothed is not None else float('nan'):.4f} splats "
                  f"{len(params['means']):,} {el / 60:.1f} min (~{el / (step + 1) * (cfg.steps - step - 1) / 60:.0f} "
                  f"min left)", flush=True)
        if guard is not None and step + 1 == guard and monitor.diverged():
            raise TrainingDiverged(f"loss diverged by step {guard}: smoothed {monitor.smoothed:.4f} > "
                                   f"{DIVERGENCE_FACTOR:g} x running minimum {monitor.min:.4f}", monitor)
    return params, monitor


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dataset", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--steps", type=int, default=TrainConfig.steps)
    ap.add_argument("--max-width", type=int, default=TrainConfig.max_width)
    ap.add_argument("--max-splats", type=int, default=TrainConfig.max_splats)
    ap.add_argument("--no-antialias", action="store_true")
    ap.add_argument("--stats", type=Path, help="write training stats JSON here")
    a = ap.parse_args()
    a.out.unlink(missing_ok=True)  # a PLY from an earlier run must never stand in for this one
    try:
        stats = train(a.dataset, a.out, TrainConfig(steps=a.steps, max_width=a.max_width, max_splats=a.max_splats,
                                                    antialiased=not a.no_antialias))
    except TrainingDiverged as e:
        if a.stats:
            a.stats.write_text(json.dumps({"diverged": str(e), **e.monitor.summary(), "healthy": False}, indent=1))
        print(f"gsplat: FAILED: {e}. No splat written. Check the SfM result (report.json sfm, "
              "sfm_global_positioning) before retraining.", file=sys.stderr, flush=True)
        sys.exit(DIVERGED_EXIT_CODE)
    if a.stats:
        a.stats.write_text(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
