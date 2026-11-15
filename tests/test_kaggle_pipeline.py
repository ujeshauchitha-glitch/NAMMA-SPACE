"""Linux/Kaggle pipeline pieces that can be tested without a GPU.

GPU stages (CUDA SIFT, gsplat training) cannot run here; these tests cover everything around them:
COLMAP version handling, tool discovery, pycolmap option building, the gsplat PLY exporter against
the downstream readers (checks.py, clean_splat.py, scene_bundle.py), profiles, the compression
fallback ladder and the pure-numpy compressed PLY.
"""
import argparse
import json
import math
import os
import stat
import sys
from pathlib import Path

import numpy as np
import pytest

import checks
import clean_splat
import common
import compress
import compressed_ply
import run_pipeline
import train_gsplat
from common import PipelineError, Report

try:
    import pycolmap
except ImportError:
    pycolmap = None
requires_pycolmap = pytest.mark.skipif(pycolmap is None, reason="pycolmap not installed (pip install pycolmap==4.2.1)")


# ------------------------------------------------------------------ COLMAP versions and tool discovery
@pytest.mark.parametrize("text,expected", [
    ("COLMAP 3.9.1 (Commit 0d4f8b5 on 2024-01-04 with CUDA)", (3, 9, 1)),
    ("COLMAP 4.2.1 -- Structure-from-Motion and Multi-View Stereo", (4, 2, 1)),
    ("COLMAP 3.7 -- Structure-from-Motion", (3, 7, 0)),
    ("usage: something else", None),
])
def test_parse_colmap_version(text, expected):
    assert common.parse_colmap_version(text) == expected


def test_colmap_option_names_follow_the_major_version():
    assert common.colmap_gpu_options((3, 9, 1))["extract_gpu"] == "--SiftExtraction.use_gpu"
    assert common.colmap_gpu_options((3, 13, 0))["match_gpu"] == "--SiftMatching.use_gpu"
    assert common.colmap_gpu_options((4, 2, 1))["extract_gpu"] == "--FeatureExtraction.use_gpu"
    assert common.colmap_gpu_options(None)["match_gpu"] == "--FeatureMatching.use_gpu"  # unknown: assume 4.x


def test_colmap_version_reads_a_fake_binary(tmp_path):
    fake = tmp_path / "colmap"
    fake.write_text("#!/bin/sh\necho 'COLMAP 3.9.1 (Commit abc)'\n")
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    if sys.platform == "win32":
        pytest.skip("shell script stand-in")
    assert common.colmap_version(str(fake)) == (3, 9, 1)


def test_find_tool_env_override(tmp_path, monkeypatch):
    exe = tmp_path / "my-colmap"
    exe.write_text("#!/bin/sh\n")
    exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("NAMMA_COLMAP", str(exe))
    assert common.find_tool("colmap") == str(exe)
    monkeypatch.setenv("NAMMA_COLMAP", str(tmp_path / "missing"))
    with pytest.raises(PipelineError, match="NAMMA_COLMAP"):
        common.find_tool("colmap")
    assert common.find_tool("colmap", required=False) is None
    assert common.tool_env_var("splat-transform") == "NAMMA_SPLAT_TRANSFORM"


def test_no_windows_only_steps_in_the_linux_path():
    """Nothing the pipeline runs on Linux shells out to PowerShell or a .ps1 script."""
    import re
    for f in (Path(run_pipeline.__file__).parent).glob("*.py"):
        src = f.read_text()
        assert not re.search(r"""["'](powershell|pwsh)(\.exe)?["']""", src, re.I), f"{f.name} runs PowerShell"
        assert not re.search(r"""["'][^"'\n]*\.ps1["']\s*[,\]]""", src), f"{f.name} passes a .ps1 script as an argument"


# ------------------------------------------------------------------ pycolmap SfM
@requires_pycolmap
def test_pycolmap_options_sequential_with_loop_closure(tmp_path):
    import sfm_pycolmap as sp
    vocab = tmp_path / "vocab.bin"
    o = sp.build_options(pycolmap, sp.SfmSettings(gpu=False, max_image_size=1280), vocab)
    assert o["pairing"].loop_detection is True
    assert Path(o["pairing"].vocab_tree_path) == vocab
    assert o["pairing"].overlap == 10 and o["pairing"].quadratic_overlap
    assert o["extraction"].max_image_size == 1280 and o["extraction"].use_gpu is False
    assert o["reader"].camera_model == "SIMPLE_RADIAL"
    assert isinstance(o["mapping"], pycolmap.GlobalPipelineOptions)
    assert o["device"] == pycolmap.Device.cpu


@requires_pycolmap
def test_pycolmap_options_gpu_exhaustive_incremental():
    import sfm_pycolmap as sp
    o = sp.build_options(pycolmap, sp.SfmSettings(gpu=True, matcher="exhaustive", mapper="incremental"), None)
    assert isinstance(o["pairing"], pycolmap.ExhaustivePairingOptions)
    assert isinstance(o["mapping"], pycolmap.IncrementalPipelineOptions) and o["mapping"].ba_use_gpu
    assert o["extraction"].use_gpu and o["matching"].use_gpu and o["device"] == pycolmap.Device.cuda
    g = sp.build_options(pycolmap, sp.SfmSettings(gpu=True, loop_closure=False), None)["mapping"]
    assert g.mapper.global_positioning.use_gpu and g.mapper.bundle_adjustment.ceres.use_gpu


@requires_pycolmap
def test_loop_closure_needs_the_vocab_tree():
    import sfm_pycolmap as sp
    with pytest.raises(PipelineError, match="vocabulary tree"):
        sp.build_options(pycolmap, sp.SfmSettings(gpu=False), None)


def test_vocab_tree_pin_matches_colmap_4_2_1():
    import sfm_pycolmap as sp
    assert sp.VOCAB_TREE_URL.endswith("/3.11.1/vocab_tree_faiss_flickr100K_words256K.bin")
    assert len(sp.VOCAB_TREE_SHA256) == 64


def _render_synthetic_views(folder: Path, n: int = 24) -> None:
    """Photos of a random textured box room from a camera walking a circle: enough for SfM on the CPU."""
    import cv2
    rng = np.random.default_rng(3)
    pts = np.concatenate([np.c_[rng.uniform(-4, 4, 4000), rng.uniform(-1, 2, 4000), np.full(4000, z)] for z in (-5, 5)]
                         + [np.c_[np.full(4000, x), rng.uniform(-1, 2, 4000), rng.uniform(-5, 5, 4000)] for x in (-4, 4)])
    cols = rng.integers(0, 255, (len(pts), 3))
    folder.mkdir(parents=True)
    f, w, h = 500.0, 640, 480
    for i in range(n):
        a = 2 * math.pi * i / n * 0.5
        c = np.array([math.cos(a) * 1.0, 0.5, math.sin(a) * 1.0])
        yaw = a + math.pi / 2
        fwd = np.array([math.cos(yaw), 0, math.sin(yaw)])
        right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right)
        up = np.cross(right, fwd)
        R = np.stack([right, -up, fwd])
        p = (pts - c) @ R.T
        vis = p[:, 2] > 0.2
        uv = p[vis, :2] / p[vis, 2:] * f + [w / 2, h / 2]
        img = np.full((h, w, 3), 90, np.uint8)
        order = np.argsort(-p[vis, 2])
        for (u, v), col in zip(uv[order].astype(int), cols[vis][order]):
            if 0 <= u < w and 0 <= v < h:
                cv2.circle(img, (int(u), int(v)), 3, tuple(int(x) for x in col), -1)
        cv2.imwrite(str(folder / f"{i:05d}.jpg"), img)


@requires_pycolmap
def test_pycolmap_backend_end_to_end_on_cpu(tmp_path):
    """The real pycolmap stage (extract, match, global map, stats, text export, undistort) on synthetic views,
    without loop closure (that would download 72 MB)."""
    import sfm_pycolmap as sp
    _render_synthetic_views(tmp_path / "frames")
    work = tmp_path
    report = Report(work / "report.json", {"checks": {}, "stages": {}})
    old = checks.MIN_SPARSE_POINTS
    checks.MIN_SPARSE_POINTS = 100
    try:
        dataset = run_pipeline.sfm(work, "sequential", False, report, work / "log.txt", mapper="global",
                                   backend="pycolmap", loop_closure=False, max_image_size=640)
    finally:
        checks.MIN_SPARSE_POINTS = old
    assert report.data["sfm"]["registered_images"] >= 20
    assert report.data["sfm"]["mapper"] in ("global", "incremental")
    assert (dataset / "sparse" / "cameras.bin").exists() and len(list((dataset / "images").iterdir())) >= 20
    stats = sp.model_stats(dataset / "sparse")
    assert stats["points3d"] > 100
    txt = sp.to_text(dataset / "sparse", tmp_path / "txt")
    assert (txt / "images.txt").exists() and (txt / "points3D.txt").exists()
    # the trainer's loader reads the same dataset
    views, pts, rgb = train_gsplat.load_dataset(dataset, max_width=320)
    assert len(views) == stats["registered_images"] and views[0].width <= 320
    assert pts.shape[1] == 3 and rgb.max() <= 1


@requires_pycolmap
def test_colmap_bin_reads_what_pycolmap_reads(tmp_path):
    """The trainer's pycolmap-free reader agrees with pycolmap on a model pycolmap wrote."""
    import colmap_bin
    rng = np.random.default_rng(1)
    rec = pycolmap.Reconstruction()
    cam = pycolmap.Camera(model="PINHOLE", width=640, height=480, params=[500, 510, 320, 240], camera_id=1)
    rec.add_camera(cam)
    xyz = rng.normal(0, 1, (50, 3))
    for i, p in enumerate(xyz):
        rec.add_point3D(p, pycolmap.Track(), np.array([i, 2 * i, 255 - i], np.uint8))
    sparse = tmp_path / "m"
    sparse.mkdir()
    rec.write(sparse)
    cams = colmap_bin.read_cameras(sparse / "cameras.bin")
    assert cams[1].model == "PINHOLE" and (cams[1].width, cams[1].height) == (640, 480)
    assert np.allclose(cams[1].K(), cam.calibration_matrix())
    pts, rgb = colmap_bin.read_points(sparse / "points3D.bin")
    ref = pycolmap.Reconstruction(sparse)
    order = sorted(ref.points3D)
    assert np.allclose(pts, [ref.points3D[i].xyz for i in order], atol=1e-6)
    assert (rgb == [ref.points3D[i].color for i in order]).all()


@requires_pycolmap
def test_colmap_bin_poses_match_pycolmap_on_a_real_sfm_model(tmp_path):
    """Poses and names read by colmap_bin equal pycolmap's on a model from the pycolmap backend."""
    import colmap_bin
    import sfm_pycolmap as sp
    _render_synthetic_views(tmp_path / "frames", n=16)
    o = sp.build_options(pycolmap, sp.SfmSettings(gpu=False, loop_closure=False, max_image_size=640), None)
    sp.extract_and_match(pycolmap, tmp_path / "db.db", tmp_path / "frames", o, "sequential")
    models, _ = sp.map_poses(pycolmap, tmp_path / "db.db", tmp_path / "frames", tmp_path / "sparse", o, "global")
    ref = pycolmap.Reconstruction(models[0])
    ours = colmap_bin.read_images(models[0] / "images.bin")
    assert len(ours) == ref.num_reg_images() > 5
    for iid, im in ours.items():
        r = ref.images[iid]
        assert im.name == r.name
        assert np.allclose(im.world_to_cam()[:3, :], r.cam_from_world().matrix(), atol=1e-6)


def test_colmap_bin_round_trip(tmp_path):
    import colmap_bin
    cams = [colmap_bin.Camera(1, "SIMPLE_PINHOLE", 100, 80, np.array([90.0, 50, 40]))]
    imgs = [colmap_bin.Image(7, np.array([1.0, 0, 0, 0]), np.array([1.0, 2, 3]), 1, "a b.jpg")]
    colmap_bin.write_model(tmp_path, cams, imgs, np.zeros((3, 3)), np.full((3, 3), 9, np.uint8))
    assert colmap_bin.read_cameras(tmp_path / "cameras.bin")[1].K()[0, 0] == 90
    im = colmap_bin.read_images(tmp_path / "images.bin")[7]
    assert im.name == "a b.jpg" and np.allclose(im.world_to_cam()[:3, 3], [1, 2, 3])
    assert colmap_bin.read_points(tmp_path / "points3D.bin")[0].shape == (3, 3)


# ------------------------------------------------------------------ gsplat exporter vs downstream readers
def _fake_splats(n: int, sh_degree: int = 3, seed: int = 0):
    rng = np.random.default_rng(seed)
    k = (sh_degree + 1) ** 2
    return dict(means=rng.normal(0, 2, (n, 3)), log_scales=rng.normal(-4, 0.5, (n, 3)),
                quats=rng.normal(0, 1, (n, 4)), opacity_logits=rng.normal(0, 2, n),
                sh0=rng.normal(0, 1, (n, 1, 3)), shN=rng.normal(0, 0.2, (n, k - 1, 3)))


def test_ply_layout_is_the_standard_3dgs_one():
    props = train_gsplat.ply_properties(3)
    assert len(props) == 62 and props[:3] == ["x", "y", "z"] and props[-4:] == ["rot_0", "rot_1", "rot_2", "rot_3"]
    assert checks.REQUIRED_PLY_PROPS <= set(props)
    assert len(train_gsplat.ply_properties(0)) == 17


def test_gsplat_ply_passes_checks_and_clean_splat(tmp_path):
    ply = tmp_path / "splat.ply"
    n = train_gsplat.write_ply(ply, **_fake_splats(60_000))
    assert n == 60_000
    r = Report(tmp_path / "report.json", {"checks": {}, "stages": {}})
    assert checks.check_splat(r, ply), r.data["checks"]
    header, props, data = clean_splat.read_ply(ply)
    assert props == train_gsplat.ply_properties(3) and data.shape == (60_000, 62)
    out = clean_splat.clean(ply, tmp_path / "clean.ply")
    assert out and (tmp_path / "clean.ply").stat().st_size > 0


def test_f_rest_is_channel_major(tmp_path):
    s = _fake_splats(2, 1)
    s["shN"] = np.arange(2 * 3 * 3, dtype=np.float32).reshape(2, 3, 3)  # [n, coeff, channel]
    train_gsplat.write_ply(tmp_path / "a.ply", **s)
    _, props, data = clean_splat.read_ply(tmp_path / "a.ply")
    rest = data[0, [props.index(f"f_rest_{i}") for i in range(9)]]
    # R of coeffs 0,1,2, then G, then B
    assert rest.tolist() == [0, 3, 6, 1, 4, 7, 2, 5, 8]


def test_non_finite_splats_are_dropped(tmp_path):
    s = _fake_splats(10)
    s["means"][3] = np.nan
    assert train_gsplat.write_ply(tmp_path / "a.ply", **s) == 9


def test_trainer_helpers():
    assert train_gsplat.downscale_factor(1920, 1920) == 1
    assert train_gsplat.downscale_factor(3840, 1920) == 2
    assert train_gsplat.downscale_factor(1921, 1280) == 2
    assert train_gsplat.anisotropy(np.log([[1.0, 1.0, 20.0]]))[0] == pytest.approx(20)
    d = train_gsplat.knn_mean_distance(np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], np.float32))
    assert d.shape == (4,) and (d > 0).all()
    sched = train_gsplat.TrainConfig(steps=7000).scaled_schedule()
    assert sched["refine_stop_iter"] < 7000 and sched["refine_every"] >= 1
    assert train_gsplat.TrainConfig().max_splats == 1_500_000


def test_gsplat_bundle_accepts_compressed_ply(tmp_path):
    """scene_bundle labels the asset by suffix: a .compressed.ply becomes kind 'ply', which the studio loads."""
    pytest.importorskip("scipy")
    import scene_bundle
    from test_coverage import write_model
    model = write_model(tmp_path / "m", 0.3, n_cams=96)
    splat = tmp_path / "scene.compressed.ply"
    splat.write_bytes(compressed_ply.encode(train_gsplat.ply_properties(3), _np_rows(_fake_splats(600))))
    scene_bundle.build(model, splat, tmp_path / "bundle", "Test")
    manifest = json.loads((tmp_path / "bundle" / "manifest.json").read_text())
    assert manifest["visualAssets"][0]["kind"] == "ply"
    assert manifest["visualAssets"][0]["uri"] == "visual/scene.compressed.ply"


# ------------------------------------------------------------------ profiles and report
def _args(**kw):
    base = dict(profile=None, fps=None, width=None, steps=None, max_splats=None)
    base.update(kw)
    return argparse.Namespace(**base)


def test_profiles():
    p = run_pipeline.resolve_params(_args(profile="preview"))
    assert p["width"] <= 1280 and p["steps"] == 7000
    f = run_pipeline.resolve_params(_args(profile="final"))
    assert f["width"] == 1920 and f["steps"] == 30000 and f["max_splats"] == 1_500_000
    assert run_pipeline.resolve_params(_args(profile="preview", steps=5000))["steps"] == 5000
    assert run_pipeline.resolve_params(_args()) == run_pipeline.DEFAULTS


def test_default_trainer_by_platform():
    assert run_pipeline.DEFAULT_TRAINER == ("brush" if sys.platform == "win32" else "gsplat")
    assert {"brush", "gsplat", "nerfstudio"} <= set(run_pipeline.TRAINERS)


def test_environment_info_without_gpu():
    info = run_pipeline.environment_info("gsplat")
    assert info["trainer"] == "gsplat" and "python" in info and "versions" in info


# ------------------------------------------------------------------ compression ladder
def test_compress_falls_back_to_python_compressed_ply(tmp_path, monkeypatch):
    """No splat-transform at all (e.g. the WebGPU module cannot load): the run still gets a web splat."""
    ply = tmp_path / "splat.ply"
    train_gsplat.write_ply(ply, **_fake_splats(3000))
    monkeypatch.setattr(compress, "cli_path", lambda: tmp_path / "missing" / "cli.mjs")
    r = Report(tmp_path / "report.json", {"checks": {}, "stages": {}, "splat": {"count": 3000}})
    out = compress.compress(ply, tmp_path, r, tmp_path / "log.txt", max_mb=50)
    assert out.name == "scene.compressed.ply"
    assert r.data["web_splat"]["format"] == "compressed.ply" and r.data["web_splat"]["encoder"] == "python"
    assert out.stat().st_size < ply.stat().st_size / 3


def test_compress_python_fallback_drops_sh_to_fit(tmp_path, monkeypatch):
    ply = tmp_path / "splat.ply"
    train_gsplat.write_ply(ply, **_fake_splats(20_000))
    monkeypatch.setattr(compress, "cli_path", lambda: tmp_path / "missing" / "cli.mjs")
    r = Report(tmp_path / "report.json", {"checks": {}, "stages": {}})
    full = compressed_ply.encode(*_props_rows(ply))
    budget = len(full) / 1e6 * 0.5  # half the full-SH size forces fewer bands
    compress.compress(ply, tmp_path, r, tmp_path / "log.txt", max_mb=budget)
    assert r.data["web_splat"]["sh"] in ("-H 1", "-H 0", "-H 2")


def test_installed_version_reads_package_json(tmp_path, monkeypatch):
    pkg = tmp_path / "node_modules" / "@playcanvas" / "splat-transform"
    (pkg / "bin").mkdir(parents=True)
    (pkg / "package.json").write_text(json.dumps({"version": "3.11.2"}))
    monkeypatch.setenv("NAMMA_SPLAT_TRANSFORM_CLI", str(pkg / "bin" / "cli.mjs"))
    assert compress.installed_version() == "3.11.2"


@pytest.mark.skipif(not os.environ.get("NAMMA_SPLAT_TRANSFORM_CLI"), reason="set NAMMA_SPLAT_TRANSFORM_CLI to run splat-transform")
def test_splat_transform_cpu_sog_and_compressed_ply(tmp_path):
    """Real splat-transform, forced to the CPU encoder: what a headless Linux box has to do."""
    ply = tmp_path / "splat.ply"
    train_gsplat.write_ply(ply, **_fake_splats(5000))
    mb = compress.convert(ply, tmp_path / "scene.sog", [], tmp_path / "log.txt", "cpu")
    assert 0 < mb
    compress.convert(ply, tmp_path / "scene.compressed.ply", [], tmp_path / "log.txt", None)


# ------------------------------------------------------------------ compressed PLY round trip
def _np_rows(s: dict) -> np.ndarray:
    n = len(s["means"])
    sh = np.asarray(s["shN"]).transpose(0, 2, 1).reshape(n, -1)
    return np.concatenate([s["means"], np.zeros((n, 3)), np.asarray(s["sh0"]).reshape(n, 3), sh,
                           np.asarray(s["opacity_logits"]).reshape(n, 1), s["log_scales"], s["quats"]], 1).astype(np.float32)


def _props_rows(ply: Path):
    _, props, data = clean_splat.read_ply(ply)
    return props, data


def test_compressed_ply_round_trip_matches_playcanvas_decoding():
    s = _fake_splats(5000, seed=7)
    props = train_gsplat.ply_properties(3)
    rows = _np_rows(s)
    raw = compressed_ply.encode(props, rows)
    dec = compressed_ply.decode(raw)
    assert raw.startswith(b"ply\n") and b"element chunk 20\n" in raw and b"element sh 5000\n" in raw
    # decode() returns splats in Morton order: match them back by position
    order = compressed_ply.morton_order(rows[:, :3])
    src = rows[order]
    extent = src[:, :3].max(0) - src[:, :3].min(0)
    assert np.abs(dec["xyz"] - src[:, :3]).max() < (extent / 2047).max() * 2  # well inside one 11-bit step of the whole room
    q = src[:, -4:] / np.linalg.norm(src[:, -4:], axis=1, keepdims=True)
    assert np.abs(np.abs((dec["quat"] * q).sum(1)) - 1).max() < 2e-3  # same rotation (q and -q are equal)
    assert np.abs(dec["log_scale"] - src[:, -7:-4]).max() < 0.02
    assert np.abs(dec["alpha"] - 1 / (1 + np.exp(-src[:, props.index("opacity")]))).max() <= 0.5 / 255 + 1e-6
    rgb = np.clip(0.5 + compressed_ply.SH_C0 * src[:, 6:9], 0, 1)
    assert np.abs(dec["rgb"] - rgb).max() < 0.01
    sh = src[:, 9:54].reshape(-1, 3, 15)
    assert np.abs(dec["sh"] - np.clip(sh, -4, 4)).max() <= 4 / 255 + 1e-6


def test_compressed_ply_header_is_what_playcanvas_detects():
    raw = compressed_ply.encode(train_gsplat.ply_properties(1), _np_rows(_fake_splats(300, 1)))
    header = raw[:raw.index(b"end_header")].decode().splitlines()
    chunk = [ln.split()[-1] for ln in header if ln.startswith("property float")]
    vert = [ln.split()[-1] for ln in header if ln.startswith("property uint")]
    sh = [ln for ln in header if ln.startswith("property uchar")]
    assert chunk == compressed_ply.CHUNK_PROPS and vert == compressed_ply.VERTEX_PROPS and len(sh) == 9
    no_sh = compressed_ply.encode(train_gsplat.ply_properties(3), _np_rows(_fake_splats(300)), sh_bands=0)
    assert b"element sh" not in no_sh


def test_rotation_packing_all_modes():
    qs = np.array([[0.9, 0.1, 0.2, 0.1], [0.1, -0.9, 0.2, 0.1], [0.1, 0.2, 0.9, -0.1], [-0.1, 0.2, 0.1, -0.9]])
    packed = compressed_ply.pack_rotation(qs)
    assert (packed >> 30).tolist() == [0, 1, 2, 3]


# ------------------------------------------------------------------ blur filter keeps turns connected
def test_blur_filter_never_drops_two_neighbouring_frames():
    # a fast turn: frames 20-29 are all blurry; the old filter removed the whole run and split SfM
    scores = [100.0] * 60
    for i in range(20, 30):
        scores[i] = 5.0 + i * 0.01
    dropped = run_pipeline.blur_drop_indices(scores, 0.15)
    assert len(dropped) == 5  # every other frame of the run, not 9 frames in a row
    assert all(i + 1 not in dropped for i in dropped)
    assert dropped <= set(range(20, 30))


def test_blur_filter_drops_the_target_fraction_when_blur_is_spread_out():
    rng = np.random.default_rng(0)
    scores = rng.uniform(80, 100, 100)
    scores[rng.choice(100, 20, replace=False)] = rng.uniform(5, 20, 20)  # 20 scattered blurry frames
    dropped = run_pipeline.blur_drop_indices(scores.tolist(), 0.15)
    assert 10 <= len(dropped) <= 15 and all(i + 1 not in dropped for i in dropped)
    assert all(scores[i] < 20 for i in dropped) and int(np.argmin(scores)) in dropped


def test_blur_filter_keeps_uniformly_sharp_video():
    assert run_pipeline.blur_drop_indices([100.0 + i % 3 for i in range(50)], 0.15) == set()
