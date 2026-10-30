"""T-B — unified Observation contract on the Python side.

`prepare_capture.py` emits one canonical per-frame `observation` block per
frame-manifest record (mirroring `ObservationSchema` in
apps/studio/src/types/scene.ts). Honesty rules under test:

  * a value that was not actually read is OMITTED (or carries an explicit
    unknown marker) — never guessed;
  * no per-frame video timestamp is invented from the sampling rate;
  * no EXIF/orientation/camera metadata is fabricated;
  * the studio bundle's observation identity (projectId/spaceId/sourceFilename)
    survives the seam, while the capture session id is THIS run's captureId.
"""
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "apps" / "studio" / "scripts"))

import prepare_capture  # noqa: E402

SCRIPT = ROOT / "apps" / "studio" / "scripts" / "prepare_capture.py"
SHA256_A = "a" * 64
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"synthetic-jpeg-payload"


def run_prepare(input_path: Path, output: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(input_path), "--output", str(output)],
        capture_output=True,
        text=True,
    )


# ------------------------------------------------------------------ build_observation (unit)
def test_directory_observation_preserves_pre_rename_name_and_omits_unknowns(tmp_path):
    frame = tmp_path / "frame-00001.jpg"
    frame.write_bytes(JPEG_BYTES)

    observation = prepare_capture.build_observation(
        capture_id="capture-x",
        source_kind="image-directory",
        content_hash=SHA256_A,
        frame=frame,
        meta={},
        source_name="original-name.jpg",
    )

    # Pre-rename name survives; format is measured from magic bytes.
    assert observation["sourceFilename"] == "original-name.jpg"
    assert observation["format"] == "jpeg"
    assert observation["bytes"] == len(JPEG_BYTES)
    # Honest session capture: the manifest's own captureId, not an invention.
    assert observation["captureSessionId"] == "capture-x"
    assert observation["modality"] == "photo"
    assert observation["orientation"] == "unknown"
    assert observation["cameraMetadata"] == {"status": "unknown"}
    assert observation["qualityResults"]["status"] == "unknown"
    assert "blur" in observation["qualityResults"]["notMeasured"]
    assert observation["provenance"] == {"emitter": "prepare_capture.py", "stage": "capture-preparation"}
    assert observation["contentHash"] == SHA256_A
    # Never read at this stage → omitted, never guessed.
    for key in ("width", "height", "stagedAt", "projectId", "spaceId", "perFrameTimestampSec"):
        assert key not in observation


def test_video_observation_is_video_frame_without_fabricated_timestamps(tmp_path):
    frame = tmp_path / "frame-00001.jpg"
    frame.write_bytes(JPEG_BYTES)

    observation = prepare_capture.build_observation(
        capture_id="capture-v",
        source_kind="video",
        content_hash=SHA256_A,
        frame=frame,
        meta={},
        source_name="clip.mp4",
    )

    assert observation["modality"] == "video-frame"
    assert observation["sourceFilename"] == "clip.mp4"
    # No per-frame video timestamp machinery exists yet: absent, not invented
    # from the sampling fps.
    assert "perFrameTimestampSec" not in observation


def test_bundle_observation_passes_through_identity_but_owns_the_session_id(tmp_path):
    frame = tmp_path / "frame-00001.jpg"
    frame.write_bytes(JPEG_BYTES)
    meta = {
        "width": 320,
        "height": 240,
        "stagedAt": 1_000,
        "observation": {
            "projectId": "prj-1",
            "spaceId": "spc-1",
            "sourceFilename": "IMG_0001.jpg",
            "modality": "live-frame",
            "perFrameTimestampSec": 1.5,
        },
    }

    observation = prepare_capture.build_observation(
        capture_id="capture-b",
        source_kind="prepared-capture-bundle",
        content_hash=SHA256_A,
        frame=frame,
        meta=meta,
        source_name="images/" + SHA256_A + ".jpg",
    )

    # Frame identity recorded by the studio survives the seam…
    assert observation["projectId"] == "prj-1"
    assert observation["spaceId"] == "spc-1"
    assert observation["sourceFilename"] == "IMG_0001.jpg"
    assert observation["modality"] == "live-frame"
    assert observation["stagedAt"] == 1_000
    assert observation["width"] == 320
    assert observation["height"] == 240
    assert observation["perFrameTimestampSec"] == 1.5
    # …but the session id describes THIS preparation run, always.
    assert observation["captureSessionId"] == "capture-b"
    assert observation["format"] == "jpeg"  # measured from bytes, not trusted from the bundle


def test_unidentifiable_bytes_stay_formatless(tmp_path):
    frame = tmp_path / "frame-00001.jpg"
    frame.write_bytes(b"this is not an image")

    observation = prepare_capture.build_observation(
        capture_id="capture-g",
        source_kind="image-directory",
        content_hash=SHA256_A,
        frame=frame,
        meta={},
        source_name="garbage.jpg",
    )

    # The extension never promotes content: format stays unknown/omitted.
    assert "format" not in observation
    assert observation["bytes"] == len(b"this is not an image")


# ------------------------------------------------------------------ frame-manifest (e2e)
def test_directory_ingest_frame_records_carry_observations(tmp_path):
    source = tmp_path / "input"
    source.mkdir()
    (source / "first.jpg").write_bytes(JPEG_BYTES)
    output = tmp_path / "out"

    result = run_prepare(source, output)
    assert result.returncode == 0, result.stderr

    manifest = json.loads((output / "frame-manifest.json").read_text())
    frame = manifest["frames"][0]
    observation = frame["observation"]
    # Pre-rename name, measured format, honest session id.
    assert observation["sourceFilename"] == "first.jpg"
    assert observation["format"] == "jpeg"
    assert observation["captureSessionId"] == manifest["captureId"]
    assert observation["modality"] == "photo"
    assert "perFrameTimestampSec" not in observation
    # The pre-existing top-level record shape is untouched (additive only).
    assert frame["id"] == "frame-00001"
    assert frame["path"] == "frames/frame-00001.jpg"
    assert frame["sha256"] == prepare_capture.sha256_file(output / "frames" / "frame-00001.jpg")


def test_bundle_ingest_preserves_studio_observation_identity(tmp_path):
    payload = JPEG_BYTES
    digest = hashlib.sha256(payload).hexdigest()
    entry = {
        "id": "img-1",
        "viewGroupId": None,
        "sha256": digest,
        "bytes": len(payload),
        "width": 320,
        "height": 240,
        "source": "operator",
        "stagedAt": 1_000,
        "file": f"images/{digest}.jpg",
        "observation": {
            "projectId": "prj-9",
            "spaceId": "spc-9",
            "sourceFilename": "IMG_0009.jpg",
            "modality": "photo",
            "stagedAt": 1_000,
        },
    }
    manifest = {
        "schemaVersion": 1,
        "bundleKind": "prepared-capture",
        "displayName": "Observation fixture",
        "createdAt": "2026-10-30T00:00:00.000Z",
        "provenance": {"source": "operator", "pipeline": "test", "notes": []},
        "counts": {"images": 1, "rooms": 0, "viewGroups": 0},
        "rooms": [],
        "viewGroups": [],
        "images": [entry],
    }
    bundle = tmp_path / "bundle.zip"
    with zipfile.ZipFile(bundle, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr(entry["file"], payload)
    output = tmp_path / "out"

    result = run_prepare(bundle, output)
    assert result.returncode == 0, result.stderr

    frame = json.loads((output / "frame-manifest.json").read_text())["frames"][0]
    observation = frame["observation"]
    assert observation["projectId"] == "prj-9"
    assert observation["spaceId"] == "spc-9"
    assert observation["sourceFilename"] == "IMG_0009.jpg"
    assert observation["width"] == 320 and observation["height"] == 240
    assert observation["stagedAt"] == 1_000
    assert observation["contentHash"] == digest
    assert observation["orientation"] == "unknown"
    assert observation["cameraMetadata"] == {"status": "unknown"}
    assert "pose" not in observation and not any("pose" in key.lower() for key in observation)
    assert observation["captureSessionId"].startswith("capture-")


def test_legacy_bundle_without_observations_still_prepares(tmp_path):
    """Additive convergence: bundles exported before T-B ingest unchanged."""
    payload = JPEG_BYTES
    digest = hashlib.sha256(payload).hexdigest()
    manifest = {
        "schemaVersion": 1,
        "bundleKind": "prepared-capture",
        "displayName": "Legacy fixture",
        "createdAt": "2026-10-30T00:00:00.000Z",
        "provenance": {"source": "operator", "pipeline": "test", "notes": []},
        "counts": {"images": 1, "rooms": 0, "viewGroups": 0},
        "rooms": [],
        "viewGroups": [],
        "images": [{
            "id": "img-1", "viewGroupId": None, "sha256": digest, "bytes": len(payload),
            "width": 320, "height": 240, "source": "operator", "stagedAt": 1_000,
            "file": f"images/{digest}.jpg",
        }],
    }
    bundle = tmp_path / "legacy.zip"
    with zipfile.ZipFile(bundle, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr(f"images/{digest}.jpg", payload)
    output = tmp_path / "out"

    result = run_prepare(bundle, output)
    assert result.returncode == 0, result.stderr

    frame = json.loads((output / "frame-manifest.json").read_text())["frames"][0]
    observation = frame["observation"]
    # Unknown identity stays omitted; the honest fallbacks still apply.
    assert "projectId" not in observation and "spaceId" not in observation
    assert observation["sourceFilename"] == f"images/{digest}.jpg"
    assert observation["modality"] == "photo"


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not on PATH")
def test_video_ingest_emits_video_frame_observations(tmp_path):
    source = tmp_path / "clip.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
         "testsrc=size=640x480:rate=30:duration=2", str(source)],
        check=True,
    )
    output = tmp_path / "out"

    result = run_prepare(source, output)
    assert result.returncode == 0, result.stderr

    manifest = json.loads((output / "frame-manifest.json").read_text())
    assert manifest["frames"]
    for frame in manifest["frames"]:
        observation = frame["observation"]
        assert observation["modality"] == "video-frame"
        assert observation["sourceFilename"] == "clip.mp4"
        assert observation["captureSessionId"] == manifest["captureId"]
        assert observation["format"] == "jpeg"  # frames are re-encoded JPEGs, sniffed
        # The sampling fps must never leak in as a fabricated per-frame timestamp.
        assert "perFrameTimestampSec" not in observation
