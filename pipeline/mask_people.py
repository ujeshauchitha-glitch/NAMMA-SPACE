"""Mask moving people out of training frames.

Detects people with a YOLO segmentation model and writes a Brush dataset whose masks/
folder marks them (dilated) as ignored, so walkers stop leaving ghost splats.

Brush semantics matter here: an image with an alpha channel makes the splat *match* that
transparency (it would punch holes where people stood); a masks/ folder makes training
*ignore* those pixels. We want the second.

    python pipeline/mask_people.py <dataset_dir> <out_dir>
        dataset_dir has images/ and sparse/. out_dir gets images/ and sparse/ (copied) and
        masks/<stem>.png (255 = train on it, 0 = ignore).
"""
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np

DILATE_PX = 25
CONF = 0.25
WEIGHTS = Path(__file__).resolve().parents[1] / "tools" / "yolov8m-seg.pt"  # downloaded on first use


def main(dataset: Path, out: Path) -> dict:
    from ultralytics import YOLO

    for sub in ("images", "sparse"):
        if not (out / sub).exists():
            shutil.copytree(dataset / sub, out / sub)
    (out / "masks").mkdir(parents=True, exist_ok=True)
    model = YOLO(str(WEIGHTS))
    files = sorted(p for p in (out / "images").iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (DILATE_PX, DILATE_PX))
    covered = []
    for i, f in enumerate(files):
        img = cv2.imread(str(f))
        h, w = img.shape[:2]
        res = model.predict(img, classes=[0], conf=CONF, imgsz=1280, device="cpu", verbose=False)[0]
        mask = np.zeros((h, w), np.uint8)
        if res.masks is not None:
            for m in res.masks.data.cpu().numpy():
                mask |= cv2.resize(m, (w, h), interpolation=cv2.INTER_NEAREST).astype(np.uint8)
            mask = cv2.dilate(mask, kernel)
        covered.append(float((mask > 0).mean()))
        cv2.imwrite(str(out / "masks" / (f.stem + ".png")), np.where(mask > 0, 0, 255).astype(np.uint8))
        if i % 20 == 0:
            print(f"mask_people: {i + 1}/{len(files)} ({covered[-1]:.1%} masked)", flush=True)
    stats = {"frames": len(files), "frames_with_people": sum(c > 0 for c in covered),
             "mean_masked": round(float(np.mean(covered)), 4)}
    print(f"mask_people: people in {stats['frames_with_people']}/{len(files)} frames, "
          f"{stats['mean_masked']:.2%} of pixels masked on average")
    return stats


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
