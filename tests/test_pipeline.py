"""Tests for the reconstruction pipeline's validation, checks and gating logic.

These test the CODE on synthetic inputs. None of them reconstruct a real room; a passing run here says
nothing about reconstruction quality (see docs/STATUS.md).

    py -3.12 -m pytest tests -q
"""
import json
import struct
import subprocess

import pytest

import checks
import preflight
import run_pipeline
from common import AWAITING_INSPECTION, FAILED, INSPECTED_OK, PipelineError, Report
from conftest import TINY_MODEL, requires_colmap, requires_ffmpeg


def new_report(tmp_path) -> Report:
    return Report(tmp_path / "report.json", {"checks": {}, "stages": {}})


# ------------------------------------------------------------------ splat output checks
def test_good_splat_passes(synthetic_ply, tmp_path):
    r = new_report(tmp_path)
    assert checks.check_splat(r, synthetic_ply)
    assert r.data["splat"]["count"] > checks.MIN_SPLATS
    assert not r.blocking_failures()


def test_missing_file_fails(tmp_path):
    assert not checks.check_splat(new_report(tmp_path), tmp_path / "absent.ply")


def test_empty_file_fails(tmp_path):
    p = tmp_path / "empty.ply"
    p.write_bytes(b"")
    assert not checks.check_splat(new_report(tmp_path), p)


def test_not_a_ply_fails(tmp_path):
    p = tmp_path / "x.ply"
    p.write_bytes(b"hello world")
    assert not checks.check_splat(new_report(tmp_path), p)


def test_truncated_splat_fails(ply_bytes, tmp_path):
    p = tmp_path / "trunc.ply"
    p.write_bytes(ply_bytes[: len(ply_bytes) // 2])
    r = new_report(tmp_path)
    assert not checks.check_splat(r, p)
    assert "splat_size_matches_header" in r.blocking_failures()


def test_missing_attribute_fails(ply_bytes, tmp_path):
    p = tmp_path / "noprop.ply"
    p.write_bytes(ply_bytes.replace(b"property float rot_3\n", b"property float junk_3\n"))
    r = new_report(tmp_path)
    assert not checks.check_splat(r, p)
    assert "splat_attributes" in r.blocking_failures()


def test_nan_position_fails(ply_bytes, header_end, tmp_path):
    raw = bytearray(ply_bytes)
    struct.pack_into("<f", raw, header_end, float("nan"))
    p = tmp_path / "nan.ply"
    p.write_bytes(bytes(raw))
    r = new_report(tmp_path)
    assert not checks.check_splat(r, p)
    assert "splat_finite" in r.blocking_failures()


def test_too_few_splats_fails(ply_bytes, header_end, tmp_path):
    # Rewrite the header to claim fewer splats and cut the data to match: parses fine but is too small.
    n_keep = 1000
    stride = 17 * 4
    header = ply_bytes[:header_end].replace(b"element vertex 105991", f"element vertex {n_keep}".encode())
    p = tmp_path / "small.ply"
    p.write_bytes(header + ply_bytes[header_end : header_end + n_keep * stride])
    r = new_report(tmp_path)
    assert not checks.check_splat(r, p)
    assert "splat_count" in r.blocking_failures()


# ------------------------------------------------------------------ SfM checks
def stats(reg, pts=5000, err=0.8):
    return {"registered_images": reg, "points3d": pts, "mean_reprojection_error_px": err, "mean_track_length": 4.0}


@pytest.mark.parametrize("registered,ok,warns", [
    (95, True, []),
    (70, True, ["sfm_registration_good"]),   # between 60% and 90%: passes with a warning
    (50, False, []),
])
def test_sfm_registration_thresholds(tmp_path, registered, ok, warns):
    r = new_report(tmp_path)
    assert checks.check_sfm(r, stats(registered), total_frames=100, extra_models=0) is ok
    recorded_warns = [k for k, v in r.data["checks"].items() if not v["ok"] and v["level"] == "warn"]
    assert recorded_warns == warns


def test_sfm_too_few_points_fails(tmp_path):
    r = new_report(tmp_path)
    assert not checks.check_sfm(r, stats(95, pts=100), total_frames=100, extra_models=0)


def test_sfm_unparseable_stats_fails_closed(tmp_path):
    r = new_report(tmp_path)
    bad = {"registered_images": None, "points3d": None, "mean_reprojection_error_px": None, "mean_track_length": None}
    assert not checks.check_sfm(r, bad, total_frames=100, extra_models=0)


def test_sfm_split_model_warns_but_passes(tmp_path):
    r = new_report(tmp_path)
    assert checks.check_sfm(r, stats(95), total_frames=100, extra_models=1)
    assert r.data["checks"]["sfm_single_model"]["level"] == "warn"


@requires_colmap
def test_model_analyzer_output_is_parsed(tmp_path):
    """Runs the real COLMAP binary on a hand-written 2-image model (SYNTHETIC) to prove the parser matches its format."""
    s = checks.colmap_model_stats(TINY_MODEL, tmp_path / "log.txt")
    assert s["registered_images"] == 2
    assert s["points3d"] == 2
    assert s["mean_reprojection_error_px"] == pytest.approx(0.35)
    assert s["mean_track_length"] == pytest.approx(2.0)


# ------------------------------------------------------------------ input validation
def make_video(path, size, seconds, fps=30):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                    f"testsrc=size={size}:rate={fps}:duration={seconds}", str(path)], check=True)


def messages(issues, level):
    return " | ".join(i.message for i in issues if i.level == level)


@requires_ffmpeg
def test_low_res_short_video_rejected(tmp_path):
    v = tmp_path / "low.mp4"
    make_video(v, "320x240", 5)
    _, issues = preflight.validate_video(v, tmp_path, 3.0)
    errs = messages(issues, "error")
    assert "too low" in errs and "at least" in errs


@requires_ffmpeg
def test_spec_video_accepted(tmp_path):
    """A 1080p ffmpeg test pattern: only checks that valid specs are accepted, it is not a room."""
    v = tmp_path / "ok.mp4"
    make_video(v, "1920x1080", 40)
    info, issues = preflight.validate_video(v, tmp_path, 3.0)
    assert not [i for i in issues if i.level == "error"]
    assert info["width"] == 1920 and info["height"] == 1080 and 39 < info["duration"] < 41


@requires_ffmpeg
def test_clip_too_short_for_frame_budget_is_rejected_unless_fps_is_raised(tmp_path):
    """25 s passes the 20 s floor but yields ~63 usable frames at 3 fps (< 80): rejected, and accepted at 4 fps."""
    v = tmp_path / "clip25.mp4"
    make_video(v, "1920x1080", 25)
    info, issues = preflight.validate_video(v, tmp_path, 3.0)
    assert "usable frames" in messages(issues, "error") and info["expected_usable_frames"] < 80
    info4, issues4 = preflight.validate_video(v, tmp_path, 4.0)
    assert not [i for i in issues4 if i.level == "error"] and info4["expected_usable_frames"] >= 80


def test_minimum_duration_for_default_fps_is_31_seconds():
    from common import min_duration_s
    assert min_duration_s(3.0) == 31


@requires_ffmpeg
def test_non_video_rejected(tmp_path):
    v = tmp_path / "fake.mp4"
    v.write_text("hello")
    with pytest.raises(PipelineError):
        preflight.validate_video(v, tmp_path, 3.0)


def test_missing_video_rejected(tmp_path):
    with pytest.raises(PipelineError):
        preflight.validate_video(tmp_path / "nope.mp4", tmp_path, 3.0)


def test_too_few_photos_rejected(tmp_path):
    import cv2
    import numpy as np

    d = tmp_path / "photos"
    d.mkdir()
    for i in range(5):
        cv2.imwrite(str(d / f"{i}.jpg"), np.zeros((720, 1280, 3), np.uint8))
    info, issues = preflight.validate_photos(d, tmp_path)
    assert info["count"] == 5
    assert "need at least" in messages(issues, "error")


def test_doctor_returns_rows():
    rows = preflight.doctor("brush", gpu=False)
    assert {"ffmpeg", "colmap", "brush_app"} <= {name for name, _, _ in rows}
    assert all(isinstance(ok, bool) for _, ok, _ in rows)


# ------------------------------------------------------------------ frames
def test_blurriest_frames_are_dropped(tmp_path):
    import cv2
    import numpy as np

    rng = np.random.default_rng(0)
    for i in range(20):
        img = rng.integers(0, 255, (240, 320, 3), dtype=np.uint8)
        if i >= 10:
            img = cv2.GaussianBlur(img, (15, 15), 6)  # frames 10-19 are blurry
        cv2.imwrite(str(tmp_path / f"{i:05d}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 98])
    kept = run_pipeline.drop_blurry(tmp_path, drop=0.15)
    assert kept == 17
    remaining = {int(p.stem) for p in tmp_path.glob("*.jpg")}
    assert remaining >= set(range(10))  # no sharp frame was removed


# ------------------------------------------------------------------ report and approval gate
def write_report(work, status):
    work.mkdir(exist_ok=True)
    (work / "report.json").write_text(json.dumps({"status": status, "checks": {}, "stages": {}}))


def test_approve_refuses_failed_run(tmp_path):
    write_report(tmp_path, FAILED)
    assert run_pipeline.cmd_approve(tmp_path, "looked fine") == 1
    assert json.loads((tmp_path / "report.json").read_text())["status"] == FAILED


def test_approve_accepts_awaiting_run_and_records_note(tmp_path):
    write_report(tmp_path, AWAITING_INSPECTION)
    assert run_pipeline.cmd_approve(tmp_path, "walked all rooms") == 0
    data = json.loads((tmp_path / "report.json").read_text())
    assert data["status"] == INSPECTED_OK
    assert data["inspection"]["note"] == "walked all rooms"


def test_blocking_failures_ignore_warnings(tmp_path):
    r = new_report(tmp_path)
    r.check("a", False, "bad", "error")
    r.check("b", False, "meh", "warn")
    r.check("c", True, "fine")
    assert r.blocking_failures() == ["a"]


# ------------------------------------------------------------------ fragment vs split (seen on the first real run)
def test_tiny_fragment_next_to_a_full_model_is_not_a_split():
    """First real run: 139/139 frames registered plus a 4-image scrap model. Must not warn 'the room split'."""
    significant, scraps = checks.split_extra_models([4], total_frames=139)
    assert significant == 0 and scraps == [4]


def test_a_real_second_piece_still_counts_as_a_split():
    significant, scraps = checks.split_extra_models([40, 3], total_frames=139)
    assert significant == 1 and scraps == [3]


def test_split_threshold_scales_with_clip_size():
    # 10% of 300 frames = 30: a 25-image extra model is a scrap there, but a real piece in a 139-frame run
    assert checks.split_extra_models([25], total_frames=300) == (0, [25])
    assert checks.split_extra_models([25], total_frames=139) == (1, [])
