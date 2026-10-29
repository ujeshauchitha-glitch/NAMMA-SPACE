"""Coverage layers and auto-alignment on synthetic COLMAP text models (no real reconstruction)."""
import math

import numpy as np
import pytest

pytest.importorskip("scipy")
pytest.importorskip("cv2")
import room_coverage as cov  # noqa: E402  (conftest puts pipeline/ on sys.path)


def rot_to_quat(R):
    from scipy.spatial.transform import Rotation

    x, y, z, w = Rotation.from_matrix(R).as_quat()
    return [w, x, y, z]  # COLMAP order


def write_model(folder, tilt, room=(4.0, 2.6, 6.0), n_cams=24, walls_seen=("floor", "x", "z", "ceiling")):
    """A box room, a ring of cameras looking outwards at 1.4 m, everything tilted by `tilt` (radians about x).

    COLMAP convention: y points down, so world "up" is -y before the tilt."""
    rng = np.random.default_rng(0)
    w, h, d = room
    pts = []
    for _ in range(4000):
        u, v = rng.random(2)
        face = rng.integers(6)
        p = {0: [u * w, 0, v * d], 1: [u * w, h, v * d], 2: [0, u * h, v * d],
             3: [w, u * h, v * d], 4: [u * w, v * h, 0], 5: [u * w, v * h, d]}[int(face)]
        name = {0: "floor", 1: "ceiling", 2: "x", 3: "x", 4: "z", 5: "z"}[int(face)]
        if name in walls_seen:
            pts.append(p)
    pts = np.array(pts) - [w / 2, 0, d / 2]
    flip = np.diag([1.0, -1.0, -1.0])  # world y-up -> COLMAP y-down
    c, s = math.cos(tilt), math.sin(tilt)
    T = np.array([[1, 0, 0], [0, c, -s], [0, s, c]]) @ flip
    lines = []
    for i in range(n_cams):
        a = 2 * math.pi * i / n_cams
        centre = np.array([1.0 * math.cos(a), 1.4, 1.5 * math.sin(a)])
        fwd = np.array([math.cos(a), 0, math.sin(a)])
        up = np.array([0, 1.0, 0])
        right = np.cross(fwd, up)
        # camera-to-world columns: x=right, y=down, z=forward (in world), then into COLMAP frame
        Rc2w = T @ np.column_stack([right, -up, fwd])
        Rw2c = Rc2w.T
        t = -Rw2c @ (T @ centre)
        q = rot_to_quat(Rw2c)
        lines.append(f"{i + 1} {' '.join(map(str, q))} {' '.join(map(str, t))} 1 {i:05d}.jpg\n")
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "images.txt").write_text("".join(ln + "\n" for ln in lines))
    tracks = " ".join(f"{k} 0" for k in range(1, 6))  # seen by 5 cameras
    (folder / "points3D.txt").write_text("".join(
        f"{i} {' '.join(map(str, T @ p))} 128 128 128 0.5 {tracks}\n" for i, p in enumerate(pts)))
    return folder


@pytest.mark.parametrize("tilt", [0.0, 0.3, -0.7])
def test_alignment_levels_the_walk_and_spawns_at_a_camera(tmp_path, tilt):
    model = write_model(tmp_path / "m", tilt)
    pts, tracks, centres, axes = cov.load_model(model, tmp_path / "scratch")
    a = cov.viewer_alignment(centres, axes)
    # Rebuild the matrix three.js would use from the Euler angles and check it levels the cameras.
    rx, ry, rz = a["rotation"]
    Rx = np.array([[1, 0, 0], [0, math.cos(rx), -math.sin(rx)], [0, math.sin(rx), math.cos(rx)]])
    Ry = np.array([[math.cos(ry), 0, math.sin(ry)], [0, 1, 0], [-math.sin(ry), 0, math.cos(ry)]])
    Rz = np.array([[math.cos(rz), -math.sin(rz), 0], [math.sin(rz), math.cos(rz), 0], [0, 0, 1]])
    levelled = centres @ (Rx @ Ry @ Rz).T
    assert np.ptp(levelled[:, 1]) < 1e-6                       # every camera at the same height
    assert np.mean([u @ (Rx @ Ry @ Rz).T for u in axes[:, 1]], axis=0)[1] > 0.99  # camera up is +y
    assert min(np.linalg.norm(levelled - a["spawn"], axis=1)) < 1e-3  # spawn is a real camera position
    lo_x, hi_x, lo_z, hi_z = a["bounds"]
    assert lo_x < levelled[:, 0].min() and hi_x > levelled[:, 0].max()
    assert lo_z < levelled[:, 2].min() and hi_z > levelled[:, 2].max()


def test_fully_observed_room_verifies(tmp_path):
    report = cov.analyse(write_model(tmp_path / "m", 0.2), tmp_path / "out")
    assert report["verified"], report["faces_seen"]
    assert (tmp_path / "out" / "coverage_topdown.png").is_file()


def test_unfilmed_ceiling_is_reported_as_a_gap(tmp_path):
    report = cov.analyse(write_model(tmp_path / "m", 0.2, walls_seen=("floor", "x", "z")), tmp_path / "out")
    assert not report["verified"]
    assert report["gaps"] and report["gaps"][0]["face"] == "ceiling"
    assert "ceiling" in (tmp_path / "out" / "RECAPTURE.txt").read_text()
