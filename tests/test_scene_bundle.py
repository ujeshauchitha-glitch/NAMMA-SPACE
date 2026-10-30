"""Scene bundle for the studio viewer: estimated scale and navigation grid on a synthetic room."""
import json

import numpy as np
import pytest

pytest.importorskip("scipy")
pytest.importorskip("cv2")
import scene_bundle  # noqa: E402  (conftest puts pipeline/ on sys.path)
from test_coverage import write_model  # noqa: E402


def test_bundle_scale_walls_and_start(tmp_path):
    # 4 x 2.6 x 6 m box, cameras at 1.4 m: the guess (1.45 m camera height) is within 4% of the truth.
    model = write_model(tmp_path / "m", 0.3, n_cams=96)  # dense enough for MIN_VIEW_FRAMES per direction
    splat = tmp_path / "scene.sog"
    splat.write_bytes(b"not a real splat")
    stats = scene_bundle.build(model, splat, tmp_path / "bundle", "Synthetic")
    assert stats["room_height_m"] == pytest.approx(2.6 * 1.45 / 1.4, rel=0.05)

    manifest = json.loads((tmp_path / "bundle" / "manifest.json").read_text())
    grid = json.loads((tmp_path / "bundle" / manifest["navigationUri"]).read_text())
    assert manifest["scaleStatus"] == "estimated" and manifest["units"] == "metre"
    assert (tmp_path / "bundle" / manifest["visualAssets"][0]["uri"]).is_file()

    blocked = np.zeros(grid["width"] * grid["height"], bool)
    blocked[grid["blocked"]] = True
    blocked[grid["unknown"]] = True
    assert not set(grid["blocked"]) & set(grid["unknown"])        # the viewer rejects overlapping lists
    occ = blocked.reshape(grid["height"], grid["width"])          # [z, x]
    s = grid["start"]
    assert not occ[s["z"], s["x"]]                                # the visitor starts on free floor
    assert occ[:, 0].all() and occ[:, -1].all()                   # walls along both x edges block walking
    # The camera ring (radius 1-1.5 m) is walkable all the way round; the far corners, never filmed, are not.
    assert (~occ).sum() * grid["cellSize"] ** 2 > 2.0
    assert occ[0, 0] and occ[-1, -1]
    start_y = manifest["startPosition"][1]
    assert start_y == pytest.approx(scene_bundle.ASSUMED_CAMERA_HEIGHT_M)
    # Every walkable cell near the camera ring knows which way the phone faced; occupied cells carry none.
    views = np.array(grid["views"]).reshape(grid["height"], grid["width"])
    assert grid["viewSectors"] == scene_bundle.VIEW_SECTORS
    assert views[s["z"], s["x"]] > 0 and not views[occ].any()
    assert views.max() < 1 << grid["viewSectors"]
