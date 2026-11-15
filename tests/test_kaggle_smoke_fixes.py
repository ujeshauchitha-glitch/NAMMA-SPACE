"""Fixes from the Kaggle T4 smoke test of 2026-11-15 (sample clip, PROFILE=preview, commit a20244e). CPU only.

1. global positioning ending NO_CONVERGENCE -> diverged training: more iterations, incremental fallback,
   normalised training frame, divergence guard with one restart;
2. clean_splat refuses to remove > 90% of the splats;
3. check_splat on 0 splats;
4. report.json: errors from crashes, total_seconds, no Infinity;
5. compression without a WebGPU adapter -> compressed PLY, no 30-min CPU SOG unless asked;
6. the train cache never reuses a diverged or uncleanable splat.
"""
import json
import math
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

import checks
import clean_splat
import compress
import run_pipeline
import sfm_pycolmap as sp
import train_gsplat
from common import PipelineError, Report
from test_kaggle_pipeline import _fake_splats, requires_pycolmap


def _report(tmp_path, **data):
    return Report(tmp_path / "report.json", {"checks": {}, "stages": {}, **data})


# ------------------------------------------------------------------ 1a. global positioning convergence
CERES_NO_CONV = ("I1115 global_mapper.cc:88] Running global positioning ...\n"
                 "Ceres Solver Report: Iterations: 101, Initial cost: 1.2e+04, Final cost: 3.4e+02, "
                 "Termination: NO_CONVERGENCE\n"
                 "Ceres Solver Report: Iterations: 51, Initial cost: 9e+02, Final cost: 8e+02, Termination: CONVERGENCE\n")
CERES_CONV = CERES_NO_CONV.replace("Iterations: 101", "Iterations: 64").replace("NO_CONVERGENCE", "CONVERGENCE", 1)


def test_positioning_result_reads_the_positioning_solve():
    r = sp.positioning_result(CERES_NO_CONV)
    assert r == {"iterations": 101, "termination": "NO_CONVERGENCE", "converged": False}
    assert sp.positioning_result(CERES_CONV)["converged"] is True
    # bundle adjustment reports before the positioning marker are not the positioning solve
    before = "Ceres Solver Report: Iterations: 3, Initial cost: 1, Final cost: 1, Termination: CONVERGENCE\n"
    assert sp.positioning_result(before + CERES_NO_CONV)["termination"] == "NO_CONVERGENCE"
    assert sp.positioning_result("no ceres output") is None


def test_set_positioning_iterations_on_a_stand_in():
    solver = SimpleNamespace(max_num_iterations=100)
    mapping = SimpleNamespace(mapper=SimpleNamespace(global_positioning=SimpleNamespace(solver_options=solver)))
    assert sp.set_positioning_iterations(mapping, 1000) == "mapper.global_positioning.solver_options"
    assert solver.max_num_iterations == 1000
    assert sp.set_positioning_iterations(SimpleNamespace(), 1000) is None  # bindings without the option


@requires_pycolmap
def test_global_options_fix_the_positioning_seed():
    """pycolmap 4.2.1 does not expose the positioner's iteration cap; the random start is what varies."""
    import pycolmap
    o = sp.build_options(pycolmap, sp.SfmSettings(gpu=False, loop_closure=False, seed=7), None)["mapping"]
    assert o.random_seed == o.mapper.random_seed == o.mapper.global_positioning.random_seed == 7
    assert o.mapper.global_positioning.generate_random_positions  # why an unseeded run differs every time


def test_capture_native_output_collects_fd_writes(tmp_path, capfd):
    import os
    log = tmp_path / "log.txt"
    with sp.capture_native_output(log) as got:
        os.write(2, b"Termination: NO_CONVERGENCE\n")
    assert "NO_CONVERGENCE" in got[0] and "NO_CONVERGENCE" in log.read_text()
    assert "NO_CONVERGENCE" in capfd.readouterr().err  # still shown


def _fake_sfm(monkeypatch, tmp_path, converged_seeds):
    """sfm_with_pycolmap with every pycolmap call stubbed: records which (mapper, seed) ran. Global mapping
    converges only for the seeds in `converged_seeds`."""
    frames = tmp_path / "frames"
    frames.mkdir()
    for i in range(30):
        (frames / f"{i:05d}.jpg").write_bytes(b"x")
    ran = []
    monkeypatch.setattr(sp, "import_pycolmap", lambda: SimpleNamespace(has_cuda=False))
    monkeypatch.setattr(sp, "versions", lambda: {})
    monkeypatch.setattr(sp, "extract_and_match", lambda pc, db, *a: Path(db).write_bytes(b"db"))
    monkeypatch.setattr(sp, "build_options", lambda pc, settings, vocab: {"seed": settings.seed})

    def map_poses(pc, db, images, sparse, opts, m, log=None):
        ran.append((m, opts["seed"] if m == "global" else None))
        model = sparse / "0"
        model.mkdir(parents=True, exist_ok=True)
        ok = opts["seed"] in converged_seeds
        pos = {"iterations": 64 if ok else 101, "termination": "CONVERGENCE" if ok else "NO_CONVERGENCE", "converged": ok}
        return [model], (pos if m == "global" else None)

    def pick_model(models, total, report, log):
        report.data["sfm"] = {"registration_ratio": 1.0, "registered_images": total}
        return models[0]

    monkeypatch.setattr(sp, "map_poses", map_poses)
    monkeypatch.setattr(run_pipeline, "pick_model", pick_model)
    monkeypatch.setattr(sp, "undistort", lambda best, images, dataset: (dataset / "sparse").mkdir(parents=True))
    return ran


def _sfm(tmp_path, r):
    run_pipeline.sfm_with_pycolmap(tmp_path, "sequential", False, r, tmp_path / "log", "global", False, 640)


def test_unconverged_global_positioning_retries_another_seed(tmp_path, monkeypatch):
    ran = _fake_sfm(monkeypatch, tmp_path, converged_seeds={2})
    r = _report(tmp_path)
    _sfm(tmp_path, r)
    assert ran == [("global", 1), ("global", 2)]
    assert r.data["sfm"]["mapper"] == "global" and r.data["sfm"]["global_seed"] == 2
    assert [a["converged"] for a in r.data["sfm_global_attempts"]] == [False, True]


def test_unconverged_global_positioning_falls_back_to_incremental(tmp_path, monkeypatch):
    ran = _fake_sfm(monkeypatch, tmp_path, converged_seeds=set())
    r = _report(tmp_path)
    _sfm(tmp_path, r)
    assert ran == [("global", 1), ("global", 2), ("incremental", None)] and r.data["sfm"]["mapper"] == "incremental"


def test_converged_global_positioning_is_kept(tmp_path, monkeypatch):
    ran = _fake_sfm(monkeypatch, tmp_path, converged_seeds={1})
    r = _report(tmp_path)
    _sfm(tmp_path, r)
    assert ran == [("global", 1)] and r.data["sfm"]["mapper"] == "global"


def test_cached_unconverged_poses_are_mapped_again(tmp_path, monkeypatch):
    ran = _fake_sfm(monkeypatch, tmp_path, converged_seeds={1})
    (tmp_path / "dataset" / "sparse").mkdir(parents=True)
    r = _report(tmp_path, sfm={"mapper": "global"},
                sfm_global_positioning={"iterations": 101, "termination": "NO_CONVERGENCE", "converged": False})
    _sfm(tmp_path, r)
    assert ran == [("global", 1)]


# ------------------------------------------------------------------ 1b. training: normalisation and divergence guard
def _view(t):
    c2w = np.eye(4)
    c2w[:3, 3] = t
    return train_gsplat.View("v", Path("v.jpg"), None, np.eye(3), c2w, 8, 8)


def test_normalisation_round_trips_to_the_colmap_frame():
    views = [_view([10, 0, 0]), _view([30, 0, 0]), _view([20, 5, 0])]
    norm = train_gsplat.Normalisation.from_views(views)
    c = np.array([norm.cam_to_world(v.cam_to_world)[:3, 3] for v in views])
    assert np.linalg.norm(c, axis=1).max() == pytest.approx(1 / 1.1, rel=1e-6)  # radius 1 incl. gsplat's 1.1
    assert train_gsplat.scene_scale([_view(t) for t in c]) == pytest.approx(1.0, rel=1e-6)
    pts = np.random.default_rng(0).normal(20, 3, (50, 3))
    logs = np.random.default_rng(1).normal(-4, 1, (50, 3))
    back_pts, back_logs = norm.export(norm.points(pts), logs + math.log(norm.scale))
    assert np.allclose(back_pts, pts, atol=1e-4) and np.allclose(back_logs, logs, atol=1e-5)


def _feed(monitor, losses, start=0):
    for i, v in enumerate(losses):
        monitor.add(start + i, v)


def test_loss_monitor_flags_the_kaggle_divergence():
    """Diverged runs: ~0.17-0.32 at step 501, 0.608 at 1001, ~0.6 after. Healthy: falling to 0.017."""
    m = train_gsplat.LossMonitor()
    _feed(m, np.linspace(0.5, 0.2, 500))
    _feed(m, np.linspace(0.2, 0.6, 500), 500)
    _feed(m, np.full(500, 0.6), 1000)
    assert m.diverged() and m.healthy() is False
    h = train_gsplat.LossMonitor()
    _feed(h, np.geomspace(0.5, 0.017, 7000))
    assert not h.diverged() and h.healthy() is True
    s = h.summary()
    assert s["final_loss"] == pytest.approx(0.017, rel=0.05) and s["healthy"] is True and s["loss_history"]
    assert train_gsplat.LossMonitor().healthy() is None  # too few steps to judge
    nan = train_gsplat.LossMonitor()
    _feed(nan, [float("nan")] * 100)
    assert nan.diverged()


def test_guard_runs_only_for_long_enough_runs():
    assert train_gsplat.TrainConfig(steps=7000).guard_step() == 1500
    assert train_gsplat.TrainConfig(steps=60).guard_step() is None


def _diverged():
    m = train_gsplat.LossMonitor()
    _feed(m, [0.2] * 100 + [0.6] * 100)
    return train_gsplat.TrainingDiverged("loss diverged by step 1500", m)


def test_restart_once_with_lower_learning_rates():
    healthy = train_gsplat.LossMonitor()
    _feed(healthy, [0.02] * 100)
    seen, log = [], []

    def attempt(cfg):
        seen.append(cfg.lr_scale)
        if len(seen) == 1:
            raise _diverged()
        return "params", healthy

    params, monitor, used = train_gsplat.run_with_restart(attempt, train_gsplat.TrainConfig(steps=7000), log)
    assert seen == [1.0, train_gsplat.RESTART_LR_SCALE] and used.lr_scale == train_gsplat.RESTART_LR_SCALE
    assert [a["diverged"] is None for a in log] == [False, True]


def test_second_divergence_fails_clearly():
    def attempt(cfg):
        raise _diverged()

    with pytest.raises(train_gsplat.TrainingDiverged, match="diverged twice"):
        train_gsplat.run_with_restart(attempt, train_gsplat.TrainConfig(steps=7000), [])


def test_pipeline_reports_a_diverged_training_run(tmp_path, monkeypatch):
    export = tmp_path / "splat_gsplat"
    export.mkdir()
    (export / "train_stats.json").write_text(json.dumps({"diverged": "training diverged twice", "final_loss": 0.6,
                                                         "min_loss": 0.17, "healthy": False}))

    def fail(*a, **k):
        raise PipelineError("gsplat training failed with exit code 3.")

    monkeypatch.setattr(run_pipeline, "run", fail)
    with pytest.raises(PipelineError, match="diverged and was stopped.*0.6"):
        run_pipeline.train_gsplat(tmp_path, export, 7000, tmp_path / "log")


# ------------------------------------------------------------------ 2. clean_splat never removes > 90%
def test_clean_refuses_to_remove_almost_everything(tmp_path):
    s = _fake_splats(1000)
    s["opacity_logits"] = np.full(1000, -12.0)  # sigmoid ~ 6e-6: every splat "faint", as after the divergence
    s["opacity_logits"][:20] = 3.0
    src = tmp_path / "splat.ply"
    train_gsplat.write_ply(src, **s)
    with pytest.raises(clean_splat.CleanRefused, match="980 of 1,000") as e:
        clean_splat.clean(src, tmp_path / "out.ply")
    assert not (tmp_path / "out.ply").exists() and e.value.stats["faint_removed"] == 980
    assert e.value.stats["huge_frac"] is None  # inf is not JSON


def test_clean_still_trims_a_normal_splat(tmp_path):
    src = tmp_path / "splat.ply"
    train_gsplat.write_ply(src, **_fake_splats(1000))
    stats = clean_splat.clean(src, tmp_path / "out.ply")
    assert stats["splats_out"] > 0.1 * stats["splats_in"] and (tmp_path / "out.ply").exists()


# ------------------------------------------------------------------ 3. check_splat on 0 splats
def test_check_splat_with_no_splats(tmp_path):
    ply = tmp_path / "empty.ply"
    ply.write_bytes(("\n".join(["ply", "format binary_little_endian 1.0", "element vertex 0",
                                *[f"property float {p}" for p in train_gsplat.ply_properties(0)], "end_header"])
                     + "\n").encode())
    r = _report(tmp_path)
    assert checks.check_splat(r, ply) is False
    assert r.data["checks"]["splat_count"]["ok"] is False and r.data["splat"]["count"] == 0


# ------------------------------------------------------------------ 4. report.json
def test_report_json_has_no_infinity(tmp_path):
    r = _report(tmp_path, clean_splat={"huge_frac": float("inf"), "x": [float("nan"), 1.5]})
    r.save()
    text = r.path.read_text()
    assert "Infinity" not in text and "NaN" not in text
    data = json.loads(text)
    assert data["clean_splat"] == {"huge_frac": None, "x": [None, 1.5]}


def test_a_crash_records_error_and_total_seconds(tmp_path, monkeypatch):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"x")
    monkeypatch.setattr(run_pipeline, "environment_info", lambda trainer: {})

    def crash(*a, **k):
        raise ValueError("percentile of an empty array")

    monkeypatch.setattr(run_pipeline.preflight, "doctor", crash)
    monkeypatch.setattr(sys, "argv", ["run_pipeline.py", str(video), "--out", str(tmp_path / "w"), "--sfm", "pycolmap"])
    assert run_pipeline.main() == 1
    rep = json.loads((tmp_path / "w" / "report.json").read_text())
    assert rep["status"] == "failed" and rep["error"] == "ValueError: percentile of an empty array"
    assert isinstance(rep["total_seconds"], float)


# ------------------------------------------------------------------ 5. compression without a WebGPU adapter
def _no_adapter(monkeypatch, calls):
    real = compress.convert

    def convert(src, out, extra, log, gpu=None):
        calls.append((out.name, gpu))
        if out.suffix == ".sog":
            raise PipelineError("splat-transform -> scene.sog failed with exit code 1.\nNo WebGPU adapter found")
        return real(src, out, extra, log, gpu)

    monkeypatch.setattr(compress, "convert", convert)


def test_no_adapter_skips_cpu_sog_and_writes_compressed_ply(tmp_path, monkeypatch):
    ply = tmp_path / "splat.ply"
    train_gsplat.write_ply(ply, **_fake_splats(3000))
    calls = []
    _no_adapter(monkeypatch, calls)
    r = _report(tmp_path, splat={"count": 3000})
    out = compress.compress(ply, tmp_path, r, tmp_path / "log.txt", max_mb=50)
    assert calls == [("scene.sog", None), ("scene.compressed.ply", "python")]
    assert out.name == "scene.compressed.ply" and r.data["web_splat"]["encoder"] == "python"
    assert r.data["web_splat"]["seconds"] >= 0 and [a["ok"] for a in r.data["compress_attempts"]] == [False, True]


def test_sog_on_cpu_is_opt_in(tmp_path, monkeypatch):
    ply = tmp_path / "splat.ply"
    train_gsplat.write_ply(ply, **_fake_splats(3000))
    calls = []
    _no_adapter(monkeypatch, calls)
    compress.compress(ply, tmp_path, _report(tmp_path), tmp_path / "log.txt", max_mb=50, sog_on_cpu=True)
    assert calls == [("scene.sog", None), ("scene.sog", "cpu"), ("scene.compressed.ply", "python")]


def test_python_fallback_decimates_without_splat_transform(tmp_path, monkeypatch):
    ply = tmp_path / "splat.ply"
    train_gsplat.write_ply(ply, **_fake_splats(20_000))
    monkeypatch.setattr(compress, "cli_path", lambda: tmp_path / "missing" / "cli.mjs")
    r = _report(tmp_path, splat={"count": 20_000})
    budget = 0.05  # MB: below even the no-SH size, so splats must be dropped
    out = compress.compress(ply, tmp_path, r, tmp_path / "log.txt", max_mb=budget)
    assert r.data["web_splat"]["decimated_to"] < 20_000 and out.stat().st_size / 1e6 <= budget


def test_scene_validator_accepts_our_compressed_ply_and_rejects_a_raw_one(tmp_path):
    """The studio fixture scene with its splat swapped for compressed_ply.py output (kind 'ply', as
    scene_bundle labels a .compressed.ply), and again with the raw float PLY."""
    import hashlib
    import shutil
    import subprocess
    import compressed_ply
    studio = Path(__file__).resolve().parent.parent / "apps" / "studio"
    ply = tmp_path / "splat.ply"
    train_gsplat.write_ply(ply, **_fake_splats(600))

    def validate(asset: Path) -> subprocess.CompletedProcess:
        scene = tmp_path / f"scene_{asset.stem}"
        shutil.copytree(studio / "public" / "scenes" / "fixture", scene)
        (scene / "visual").mkdir(exist_ok=True)
        shutil.copy2(asset, scene / "visual" / asset.name)
        m = json.loads((scene / "manifest.json").read_text())
        m["visualAssets"] = [{"kind": "ply", "uri": f"visual/{asset.name}",
                              "sha256": hashlib.sha256(asset.read_bytes()).hexdigest()}]
        (scene / "manifest.json").write_text(json.dumps(m))
        return subprocess.run([sys.executable, str(studio / "scripts" / "validate_scene.py"), str(scene)],
                              capture_output=True, text=True)

    web = tmp_path / "scene.compressed.ply"
    compressed_ply.convert(ply, web)
    ok = validate(web)
    assert ok.returncode == 0, ok.stdout + ok.stderr
    raw = validate(ply)
    assert raw.returncode == 1 and "uncompressed PLY" in raw.stdout + raw.stderr


# ------------------------------------------------------------------ 6. train cache
def _cached(tmp_path, healthy=True, clean_ok=True):
    export = tmp_path / "splat_gsplat"
    export.mkdir(exist_ok=True)
    ply = export / "splat.ply"
    ply.write_bytes(b"ply data")
    (export / "train_stats.json").write_text(json.dumps({"healthy": healthy, "final_loss": 0.017 if healthy else 0.6,
                                                         "min_loss": 0.016}))
    want = {"fp": 1}
    r = _report(tmp_path, train_output={"ply": str(ply), "bytes": ply.stat().st_size, "fingerprint": want},
                clean_splat={"ok": clean_ok, "src": str(ply)})
    return r, want, ply


def test_cache_reuses_only_a_healthy_cleaned_splat(tmp_path):
    r, want, ply = _cached(tmp_path)
    assert run_pipeline.reusable_splat(r, want, "gsplat") == (ply, "")
    r, want, _ = _cached(tmp_path, healthy=False)
    got, why = run_pipeline.reusable_splat(r, want, "gsplat")
    assert got is None and "not healthy" in why and "0.6" in why
    r, want, _ = _cached(tmp_path, clean_ok=False)
    assert run_pipeline.reusable_splat(r, want, "gsplat")[0] is None
    r, want, _ = _cached(tmp_path)
    assert run_pipeline.reusable_splat(r, {"fp": 2}, "gsplat")[0] is None


def test_force_train_and_diverged_cache_retrain(tmp_path, monkeypatch):
    trained = []
    monkeypatch.setattr(run_pipeline, "train_fingerprint", lambda *a: {"fp": 1})
    monkeypatch.setattr(run_pipeline, "check_dataset", lambda *a: None)

    def fake_train(dataset, export, *a):
        trained.append(1)
        (export / "splat.ply").write_bytes(b"new splat")

    monkeypatch.setattr(run_pipeline, "train_gsplat", fake_train)
    r, _, ply = _cached(tmp_path)
    assert run_pipeline.train(tmp_path, tmp_path, 7000, "gsplat", r, tmp_path / "log") == ply and not trained
    run_pipeline.train(tmp_path, tmp_path, 7000, "gsplat", r, tmp_path / "log", force=True)
    assert trained == [1] and "clean_splat" not in r.data
    r, _, _ = _cached(tmp_path, healthy=False)
    run_pipeline.train(tmp_path, tmp_path, 7000, "gsplat", r, tmp_path / "log")
    assert trained == [1, 1]
