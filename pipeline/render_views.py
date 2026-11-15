"""Render a trained splat from a few of the capture's own camera poses (a quick visual check on Kaggle).

    python pipeline/render_views.py <work_dir> [--views 3] [--out <work_dir>/renders]

Uses the cleaned splat from report.json (else the newest splat_*/**.ply), the undistorted dataset's cameras
(read with colmap_bin, no pycolmap in this torch process) and gsplat on CUDA. Writes render_<i>.png next to
the matching photo (photo_<i>.jpg) so the two can be compared side by side.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from clean_splat import read_ply  # noqa: E402
from train_gsplat import load_dataset  # noqa: E402


def pick_views(n_total: int, k: int) -> list[int]:
    """k indices spread over the walk: start, middle(s), end."""
    if n_total <= k:
        return list(range(n_total))
    return sorted({round(i * (n_total - 1) / (k - 1)) for i in range(k)}) if k > 1 else [n_total // 2]


def find_splat(work: Path) -> Path:
    report = work / "report.json"
    if report.is_file():
        clean = json.loads(report.read_text()).get("train_output", {}).get("ply")
        if clean and Path(clean).with_name(Path(clean).stem + "_clean.ply").is_file():
            return Path(clean).with_name(Path(clean).stem + "_clean.ply")
        if clean and Path(clean).is_file():
            return Path(clean)
    plys = sorted(work.glob("splat_*/**/*.ply"), key=lambda p: p.stat().st_mtime)
    if not plys:
        raise FileNotFoundError(f"no trained splat under {work}")
    return plys[-1]


def render(work: Path, out: Path, k: int = 3, max_width: int = 1280) -> list[Path]:
    import cv2
    import torch
    from gsplat import rasterization

    dataset = work / "dataset_masked" if (work / "dataset_masked" / "sparse").exists() else work / "dataset"
    views, _, _ = load_dataset(dataset, max_width)
    _, props, d = read_ply(find_splat(work))
    col = {p: i for i, p in enumerate(props)}
    dev = torch.device("cuda")
    t = lambda cols: torch.tensor(d[:, [col[c] for c in cols]], device=dev)
    rest = sorted((p for p in props if p.startswith("f_rest_")), key=lambda p: int(p.split("_")[-1]))
    n, k_rest = len(d), len(rest) // 3
    sh = torch.cat([t(["f_dc_0", "f_dc_1", "f_dc_2"])[:, None, :],
                    t(rest).reshape(n, 3, k_rest).transpose(1, 2)], 1) if k_rest else t(["f_dc_0", "f_dc_1", "f_dc_2"])[:, None, :]
    degree = int(round((sh.shape[1]) ** 0.5)) - 1
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for j, i in enumerate(pick_views(len(views), k)):
        v = views[i]
        viewmat = torch.linalg.inv(torch.tensor(v.cam_to_world, dtype=torch.float32, device=dev))[None]
        K = torch.tensor(v.K, dtype=torch.float32, device=dev)[None]
        with torch.no_grad():
            img, _, _ = rasterization(t(["x", "y", "z"]), torch.nn.functional.normalize(t(["rot_0", "rot_1", "rot_2", "rot_3"]), dim=-1),
                                      torch.exp(t(["scale_0", "scale_1", "scale_2"])), torch.sigmoid(t(["opacity"])[:, 0]),
                                      sh, viewmat, K, v.width, v.height, sh_degree=degree, rasterize_mode="antialiased")
        png = out / f"render_{j}.png"
        cv2.imwrite(str(png), cv2.cvtColor((img[0].clamp(0, 1).cpu().numpy() * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
        shutil.copy2(v.image, out / f"photo_{j}{v.image.suffix}")
        written.append(png)
    print("render_views:", [str(p) for p in written])
    return written


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("work", type=Path)
    ap.add_argument("--views", type=int, default=3)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    render(a.work, a.out or a.work / "renders", a.views)
