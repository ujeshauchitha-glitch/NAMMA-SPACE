"""Read (and, for tests, write) COLMAP's binary model files without pycolmap.

The gsplat trainer must not import pycolmap: pycolmap and PyTorch each bundle an OpenMP runtime, and
loading both in one process can abort (seen on macOS with pycolmap 4.2.1 + torch 2.15: "OMP: multiple
copies of the OpenMP runtime"). The camera/image/point files keep the classic layout in COLMAP 4.x
(src/colmap/scene/reconstruction_io_binary.cc at 4.2.1; rigs.bin/frames.bin are separate files this
reader does not need): little-endian, camera_t/image_t/point2D_t = uint32, point3D_t = uint64.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# model_id -> (name, number of params); only the ones an undistorted dataset or a phone model uses.
CAMERA_MODELS = {0: ("SIMPLE_PINHOLE", 3), 1: ("PINHOLE", 4), 2: ("SIMPLE_RADIAL", 4), 3: ("RADIAL", 5),
                 4: ("OPENCV", 8)}


@dataclass
class Camera:
    id: int
    model: str
    width: int
    height: int
    params: np.ndarray

    def K(self) -> np.ndarray:
        if self.model == "PINHOLE":
            fx, fy, cx, cy = self.params[:4]
        elif self.model in ("SIMPLE_PINHOLE", "SIMPLE_RADIAL", "RADIAL"):
            fx = fy = self.params[0]
            cx, cy = self.params[1:3]
        else:
            fx, fy, cx, cy = self.params[:4]
        return np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], np.float64)


@dataclass
class Image:
    id: int
    qvec: np.ndarray  # w, x, y, z (cam_from_world rotation)
    tvec: np.ndarray
    camera_id: int
    name: str

    def world_to_cam(self) -> np.ndarray:
        w, x, y, z = self.qvec
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                      [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                      [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])
        M = np.eye(4)
        M[:3, :3], M[:3, 3] = R, self.tvec
        return M


def _read(f, fmt: str):
    size = struct.calcsize("<" + fmt)
    data = f.read(size)
    if len(data) != size:
        raise ValueError("COLMAP model file ended early")
    return struct.unpack("<" + fmt, data)


def read_cameras(path: Path) -> dict[int, Camera]:
    cams = {}
    with open(path, "rb") as f:
        (n,) = _read(f, "Q")
        for _ in range(n):
            cid, model_id, w, h = _read(f, "IiQQ")
            if model_id not in CAMERA_MODELS:
                raise ValueError(f"{path}: camera model id {model_id} not supported")
            name, k = CAMERA_MODELS[model_id]
            cams[cid] = Camera(cid, name, w, h, np.array(_read(f, "d" * k)))
    return cams


def read_images(path: Path) -> dict[int, Image]:
    images = {}
    with open(path, "rb") as f:
        (n,) = _read(f, "Q")
        for _ in range(n):
            iid, qw, qx, qy, qz, tx, ty, tz, cid = _read(f, "IdddddddI")
            name = b""
            while (c := f.read(1)) not in (b"\0", b""):
                name += c
            (npts,) = _read(f, "Q")
            f.seek(npts * 24, 1)  # x, y (double) + point3D id (point3D_t = uint64)
            images[iid] = Image(iid, np.array([qw, qx, qy, qz]), np.array([tx, ty, tz]), cid, name.decode("utf-8"))
    return images


def read_points(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """xyz (N,3) float32 and rgb (N,3) uint8."""
    xyz, rgb = [], []
    with open(path, "rb") as f:
        (n,) = _read(f, "Q")
        for _ in range(n):
            _, x, y, z, r, g, b, _err = _read(f, "QdddBBBd")
            (track,) = _read(f, "Q")
            f.seek(track * 8, 1)  # image id + point2D index (uint32 each)
            xyz.append((x, y, z))
            rgb.append((r, g, b))
    return np.array(xyz, np.float32).reshape(-1, 3), np.array(rgb, np.uint8).reshape(-1, 3)


def write_model(folder: Path, cameras: list[Camera], images: list[Image], xyz: np.ndarray, rgb: np.ndarray) -> None:
    """Minimal writer (no 2D points/tracks) for tests and fixtures."""
    ids = {v[0]: k for k, v in CAMERA_MODELS.items()}
    folder.mkdir(parents=True, exist_ok=True)
    with open(folder / "cameras.bin", "wb") as f:
        f.write(struct.pack("<Q", len(cameras)))
        for c in cameras:
            f.write(struct.pack("<IiQQ", c.id, ids[c.model], c.width, c.height) + struct.pack(f"<{len(c.params)}d", *c.params))
    with open(folder / "images.bin", "wb") as f:
        f.write(struct.pack("<Q", len(images)))
        for im in images:
            f.write(struct.pack("<IdddddddI", im.id, *im.qvec, *im.tvec, im.camera_id) + im.name.encode() + b"\0"
                    + struct.pack("<Q", 0))
    with open(folder / "points3D.bin", "wb") as f:
        f.write(struct.pack("<Q", len(xyz)))
        for i, (p, c) in enumerate(zip(xyz, rgb)):
            f.write(struct.pack("<QdddBBBd", i + 1, *map(float, p), *map(int, c), 0.0) + struct.pack("<Q", 0))
