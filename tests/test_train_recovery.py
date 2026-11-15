"""Training recovery: the rolling divergence guard with checkpoint rollback, the out-of-memory fallback,
the splat size caps, the preview's splat cap for long walks, and the pipeline's handling of all of it.

The driver logic is tested with stand-in attempts (no torch). The real training loop runs in a child
process (tests/_gsplat_recovery_driver.py) with a stand-in rasteriser that runs out of memory or goes bad
on cue, because torch must not share a process with pycolmap."""
import importlib.util
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

import run_pipeline
import train_gsplat as tg
from common import PipelineError

requires_torch = pytest.mark.skipif(importlib.util.find_spec("torch") is None, reason="torch not installed")
DRIVER = Path(__file__).with_name("_gsplat_recovery_driver.py")

# The hostel walk's smoothed loss every 500 steps (Kaggle, 862 views): it climbed once the cap was reached.
HOSTEL = {500: 0.160, 1000: 0.090, 1500: 0.093, 2000: 0.096, 2500: 0.125, 3000: 0.168, 3500: 0.179,
          4000: 0.188, 4500: 0.196}


def _monitor(values):
    m = tg.LossMonitor()
    for i, v in enumerate(values):
        m.add(i, v)
    return m


def test_rolling_guard_catches_the_hostel_climb_at_step_3000():
    """Interpolate the hostel curve per step; the first guard step at which it reads diverged is 3000
    (0.168 > 1.5 x 0.090). The old single check at 1500 never fired."""
    steps = sorted(HOSTEL)
    curve = np.interp(np.arange(1, 4501), steps, [HOSTEL[s] for s in steps])
    guards = tg.TrainConfig(steps=7000).guard_steps()
    m, fired = tg.LossMonitor(), None
    for i, v in enumerate(curve):
        m.add(i, v)
        if i + 1 in guards and m.diverged():
            fired = i + 1
            break
    assert fired == 3000


def test_rollback_keeps_the_running_minimum():
    m = _monitor([0.1] * 200 + [0.3] * 100)
    assert m.diverged()
    m.rollback(200)
    assert m.smoothed is None and not m.diverged() and m.min == pytest.approx(0.1)
    assert all(step <= 200 for step, _ in m.history)


def _ckpt(step, loss=0.09):
    return tg.Checkpoint(step, loss, {"means": "cpu tensors"})


def test_divergence_rolls_back_to_the_best_checkpoint_at_a_lower_learning_rate():
    seen, log = [], []

    def attempt(cfg, resume, monitor, best):
        seen.append((cfg.lr_scale, resume.step if resume else None))
        if len(seen) == 1:
            best["ckpt"] = _ckpt(1500)
            raise tg.TrainingDiverged("loss diverged by step 3000", _monitor([0.09] * 100 + [0.2] * 100), 3000)
        return "params", _monitor([0.08] * 100)

    params, monitor, used = tg.run_with_recovery(attempt, tg.TrainConfig(steps=7000), log)
    assert seen == [(1.0, None), (tg.RESTART_LR_SCALE, 1500)]
    assert used.lr_scale == tg.RESTART_LR_SCALE and params == "params"
    assert log[0] == {"event": "diverged", "at_step": 3000, "message": "loss diverged by step 3000",
                      "lr_scale": 1.0, "rollback_to": 1500}
    assert log[1]["event"] == "finished" and log[1]["from_step"] == 1500


def test_divergence_before_any_checkpoint_restarts_from_the_beginning():
    seen = []

    def attempt(cfg, resume, monitor, best):
        seen.append(resume)
        if len(seen) == 1:
            raise tg.TrainingDiverged("loss diverged by step 1500", _monitor([0.2] * 100 + [0.6] * 100), 1500)
        return "params", _monitor([0.02] * 100)

    tg.run_with_recovery(attempt, tg.TrainConfig(steps=7000), [])
    assert seen == [None, None]


class OutOfMemoryError(RuntimeError):
    """Stands in for torch.OutOfMemoryError (matched by name)."""


def test_out_of_memory_frees_and_resumes_once_smaller():
    seen, log, freed = [], [], []

    def attempt(cfg, resume, monitor, best):
        seen.append((cfg.max_splats, cfg.max_width, resume.step if resume else None, monitor))
        if len(seen) == 1:
            best["ckpt"] = _ckpt(4000)
            raise OutOfMemoryError("CUDA out of memory. Tried to allocate 2.20 GiB")
        return "params", _monitor([0.08] * 100)

    _, _, used = tg.run_with_recovery(attempt, tg.TrainConfig(steps=7000, max_width=1280, max_splats=500_000), log,
                                      free=lambda: freed.append(1) or 12.3)
    assert freed == [1]
    assert seen[1][:3] == (300_000, 640, 4000) and seen[1][3] is None  # fresh loss monitor at the new resolution
    assert (used.max_splats, used.max_width) == (300_000, 640)
    oom = log[0]
    assert oom["event"] == "oom" and oom["failed_peak_gpu_gb"] == 12.3 and oom["resume_from"] == 4000
    assert (oom["max_splats"], oom["new_max_splats"], oom["max_width"], oom["new_max_width"]) == \
        (500_000, 300_000, 1280, 640)


def test_a_second_out_of_memory_error_is_raised():
    def attempt(cfg, resume, monitor, best):
        raise OutOfMemoryError("CUDA out of memory")

    log = []
    with pytest.raises(OutOfMemoryError):
        tg.run_with_recovery(attempt, tg.TrainConfig(steps=7000), log)
    assert [a["event"] for a in log] == ["oom"]


def test_other_errors_are_not_retried():
    calls = []

    def attempt(cfg, resume, monitor, best):
        calls.append(1)
        raise ValueError("bad dataset")

    with pytest.raises(ValueError):
        tg.run_with_recovery(attempt, tg.TrainConfig(steps=7000), [])
    assert calls == [1]


def test_preview_cap_for_long_walks():
    p = dict(run_pipeline.PROFILES["preview"])
    assert run_pipeline.preview_train_params("preview", p, 862, False) == \
        {"views": 862, "max_splats": 500_000, "was": 750_000}
    assert run_pipeline.preview_train_params("preview", p, 97, False) is None
    assert run_pipeline.preview_train_params("preview", p, 862, True) is None  # --max-splats given
    assert run_pipeline.preview_train_params("final", dict(run_pipeline.PROFILES["final"]), 862, False) is None


def test_training_child_gets_expandable_segments_and_the_masks_requirement(tmp_path, monkeypatch):
    seen = {}

    def fake_run(cmd, log=None, stage="", env=None):
        seen.update(cmd=cmd, env=env)
        return ""

    monkeypatch.setattr(run_pipeline, "run", fake_run)
    run_pipeline.train_gsplat(tmp_path, tmp_path, 7000, tmp_path / "log", 1280, 500_000, require_masks=True)
    assert seen["env"]["PYTORCH_ALLOC_CONF"] == "expandable_segments:True"
    assert seen["env"]["PYTORCH_CUDA_ALLOC_CONF"] == "expandable_segments:True"
    assert "--require-masks" in seen["cmd"] and seen["cmd"][seen["cmd"].index("--max-splats") + 1] == "500000"


def test_common_run_passes_the_extra_environment(tmp_path):
    import common
    out = common.run([sys.executable, "-c", "import os; print(os.environ['NAMMA_TEST_ENV'])"],
                     env={"NAMMA_TEST_ENV": "expandable"})
    assert out.strip() == "expandable"


def test_pipeline_reports_a_second_out_of_memory_error(tmp_path, monkeypatch):
    (tmp_path / "train_stats.json").write_text(json.dumps({"error": "OutOfMemoryError: CUDA out of memory",
                                                           "oom": True, "healthy": False, "attempts": [{"event": "oom"}]}))

    def fail(*a, **k):
        raise PipelineError("gsplat training failed with exit code 1.")

    monkeypatch.setattr(run_pipeline, "run", fail)
    with pytest.raises(PipelineError, match="out of GPU memory again after its fallback"):
        run_pipeline.train_gsplat(tmp_path, tmp_path, 7000, tmp_path / "log")


def _drive(scenario, tmp_path):
    out = tmp_path / "result.json"
    proc = subprocess.run([sys.executable, str(DRIVER), scenario, str(tmp_path), str(out)],
                          capture_output=True, text=True, timeout=300)
    assert proc.returncode == 0, proc.stdout[-2000:] + proc.stderr[-2000:]
    return json.loads(out.read_text()), proc.stdout


@requires_torch
def test_screen_cap_leaves_out_only_splats_too_big_in_this_view(tmp_path):
    r, _ = _drive("screen", tmp_path)
    # sigma 0.1 at depth 0.1: 150 px > 16 px, left out; a small splat at 2: kept; behind the camera: kept
    # (the rasteriser culls it).
    assert r["keep"] == [False, True, True]


@requires_torch
def test_real_loop_rolls_back_after_a_bad_stretch_and_clamps_scales(tmp_path):
    r, out = _drive("diverge", tmp_path)
    s = r["stats"]
    assert s["rollbacks"] == 1 and s["healthy"] is True and s["lr_scale"] == pytest.approx(tg.RESTART_LR_SCALE)
    assert s["attempts"][0]["event"] == "diverged" and s["attempts"][0]["rollback_to"] == 40
    assert s["attempts"][1] == {**s["attempts"][1], "event": "finished", "from_step": 40}
    assert "rolling back to step 40" in out
    # init_scale 50 would start every splat far above the cap; the exported sigmas are all within it
    assert r["max_log_scale_normalised"] <= math.log(tg.MAX_SCALE) + 1e-4


@requires_torch
def test_real_loop_out_of_memory_resumes_smaller_and_records_it(tmp_path):
    r, out = _drive("oom", tmp_path)
    s = r["stats"]
    assert r["widths"] == [32, 64] and s["resolution"] == [32, 24]
    assert s["oom_fallback"]["resume_from"] == 40 and s["oom_fallback"]["new_max_splats"] == 180
    assert s["splats"] == 180  # 200 resumed splats pruned to the smaller cap, most opaque kept
    assert "out of GPU memory; resuming from step 40" in out


@requires_torch
def test_real_loop_second_out_of_memory_fails_with_the_attempts(tmp_path):
    r, _ = _drive("oom_twice", tmp_path)
    assert r["oom"] is True and [a["event"] for a in r["attempts"]] == ["oom"]
