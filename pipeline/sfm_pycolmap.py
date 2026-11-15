"""Camera poses with pycolmap (COLMAP's Python bindings) instead of the `colmap` executable.

Why this backend for Kaggle / Linux (chosen Nov 2026):
  * `pycolmap-cuda12` 4.2.1 (PyPI, 2026-09-29, manylinux_2_28 x86_64) is a prebuilt CUDA 12 wheel: GPU SIFT
    extraction and matching with a plain `pip install`, no 30-60 min source build of COLMAP. Ubuntu's apt
    `colmap` is CPU-only and years old; COLMAP's own release page ships CUDA builds for Windows only.
  * Same library as the COLMAP CLI (same SIFT, same verification, same model files), so every later stage
    (coverage, cleaning, scene bundle) reads the result unchanged.
  * Mapping defaults to COLMAP's global mapper (GLOMAP, merged into COLMAP 4.0): one rotation-averaging +
    global-positioning solve instead of hundreds of incremental bundle adjustments, typically several times
    faster on a 300-500 frame walk-through. If it registers too few frames the pipeline retries with the
    incremental mapper (slower, the long-standing reference), so speed never costs a run.
  * Matching is sequential (each frame against its neighbours) with loop closure through COLMAP's published
    vocabulary tree, so walking back into a room links up. Exhaustive matching is O(n^2) and only used when
    asked for (--exhaustive) or for unordered photo sets.

Option names were read from the pycolmap 4.2.1 bindings (SequentialPairingOptions, FeatureExtractionOptions,
ImageReaderOptions, GlobalPipelineOptions, IncrementalPipelineOptions).
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import sys
import tempfile
from contextlib import contextmanager
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from common import PipelineError

# COLMAP's SIFT vocabulary tree for loop detection (FAISS format, the default in COLMAP >= 3.11:
# src/colmap/retrieval/resources.h, kDefaultSiftVocabTreeUri, at tag 4.2.1). 72 MB, downloaded once.
VOCAB_TREE_URL = ("https://github.com/colmap/colmap/releases/download/3.11.1/"
                  "vocab_tree_faiss_flickr100K_words256K.bin")
VOCAB_TREE_SHA256 = "96ca8ec8ea60b1f73465aaf2c401fd3b3ca75cdba2d3c50d6a2f6f760f275ddc"


@dataclass(frozen=True)
class SfmSettings:
    gpu: bool = True
    matcher: str = "sequential"         # "sequential" | "exhaustive"
    loop_closure: bool = True           # sequential only
    mapper: str = "global"              # "global" (GLOMAP) | "incremental"
    max_image_size: int = 1920          # SIFT works on images at most this wide/high
    max_num_features: int = 8192
    overlap: int = 10                   # sequential: neighbours matched on each side
    camera_model: str = "SIMPLE_RADIAL"  # OPENCV's extra parameters fail on phone video, see run_pipeline.sfm
    # Global positioning starts from random camera/point positions (generate_random_positions) and, with
    # COLMAP's default random_seed -1, a different start every run: on the Kaggle smoke-test clip 2 of 4
    # identical runs ended NO_CONVERGENCE after 101 Ceres iterations and both trained into a diverged splat
    # (2026-11-15). A fixed seed makes a run reproducible; run_pipeline retries other seeds, then incremental.
    seed: int = 1
    # Ceres iteration cap of the positioner (COLMAP default 100). pycolmap 4.2.1 does not expose it, so it
    # is applied only where a later pycolmap does (see set_positioning_iterations).
    global_positioning_max_iterations: int = 1000


def import_pycolmap():
    try:
        import pycolmap
    except ImportError as e:
        raise PipelineError("pycolmap is not installed. On Linux with an NVIDIA GPU: pip install pycolmap-cuda12==4.2.1 "
                            "(CPU only: pip install pycolmap==4.2.1).") from e
    return pycolmap


def ensure_vocab_tree(cache: Path) -> Path:
    """Download COLMAP's vocabulary tree once and verify its sha256 (a truncated file would crash matching)."""
    path = cache / Path(VOCAB_TREE_URL).name
    if path.is_file() and sha256(path) == VOCAB_TREE_SHA256:
        return path
    cache.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    print(f"sfm: downloading the loop-closure vocabulary tree (72 MB) -> {path}")
    try:
        with urllib.request.urlopen(VOCAB_TREE_URL, timeout=120) as r, open(tmp, "wb") as f:
            shutil.copyfileobj(r, f, 1 << 20)
    except OSError as e:
        tmp.unlink(missing_ok=True)
        raise PipelineError(f"Could not download {VOCAB_TREE_URL} ({e}). Turn on internet access, or run with "
                            "--no-loop-closure.") from e
    if sha256(tmp) != VOCAB_TREE_SHA256:
        tmp.unlink(missing_ok=True)
        raise PipelineError(f"{VOCAB_TREE_URL} downloaded with the wrong checksum; try again.")
    tmp.replace(path)
    return path


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def build_options(pycolmap, s: SfmSettings, vocab_tree: Path | None) -> dict:
    """All pycolmap option objects for one run. Separate from running so it can be unit tested on CPU."""
    reader = pycolmap.ImageReaderOptions()
    reader.camera_model = s.camera_model
    extraction = pycolmap.FeatureExtractionOptions()
    extraction.use_gpu = s.gpu
    extraction.max_image_size = s.max_image_size
    extraction.sift.max_num_features = s.max_num_features
    matching = pycolmap.FeatureMatchingOptions()
    matching.use_gpu = s.gpu
    opts = {"reader": reader, "extraction": extraction, "matching": matching,
            "device": pycolmap.Device.cuda if s.gpu else pycolmap.Device.cpu}
    if s.matcher == "sequential":
        pairing = pycolmap.SequentialPairingOptions()
        pairing.overlap = s.overlap
        pairing.quadratic_overlap = True
        if s.loop_closure:
            if vocab_tree is None:
                raise PipelineError("Loop closure needs the vocabulary tree.")
            pairing.loop_detection = True
            pairing.vocab_tree_path = vocab_tree
            pairing.loop_detection_period = 10        # every 10th frame looks for earlier views of the same spot
            pairing.loop_detection_num_images = 50
        opts["pairing"] = pairing
    elif s.matcher == "exhaustive":
        opts["pairing"] = pycolmap.ExhaustivePairingOptions()
    else:
        raise PipelineError(f"Unknown matcher {s.matcher!r}")
    if s.mapper == "global":
        mapping = pycolmap.GlobalPipelineOptions()
        mapping.mapper.global_positioning.use_gpu = s.gpu
        mapping.mapper.bundle_adjustment.ceres.use_gpu = s.gpu
        set_positioning_iterations(mapping, s.global_positioning_max_iterations)
        for obj in (mapping, mapping.mapper, mapping.mapper.global_positioning):
            if hasattr(obj, "random_seed"):
                obj.random_seed = s.seed
    elif s.mapper == "incremental":
        mapping = pycolmap.IncrementalPipelineOptions()
        mapping.ba_use_gpu = s.gpu
    else:
        raise PipelineError(f"Unknown mapper {s.mapper!r}")
    opts["mapping"] = mapping
    return opts


# Where pycolmap 4.x keeps the global positioner's Ceres solver options (the first path that exists wins).
POSITIONING_SOLVER_PATHS = ("mapper.global_positioning.solver_options", "global_positioning.solver_options",
                            "mapper.global_positioner.solver_options")


def set_positioning_iterations(mapping, iterations: int) -> str | None:
    """Raise the global positioner's Ceres max_num_iterations where the bindings expose it; returns the
    option path used, or None (pycolmap 4.2.1: GlobalPositionerOptions has no solver options)."""
    for path in POSITIONING_SOLVER_PATHS:
        obj = mapping
        try:
            for part in path.split("."):
                obj = getattr(obj, part)
        except AttributeError:
            continue
        if hasattr(obj, "max_num_iterations"):
            obj.max_num_iterations = int(iterations)
            return path
    return None


_CERES = re.compile(r"Iterations:\s*(\d+).*?Termination:\s*([A-Z_]+)", re.S)


def positioning_result(log_text: str) -> dict | None:
    """Iterations and termination of the global positioning solve, parsed from COLMAP's log.

    Ceres prints one BriefReport per solve ("Iterations: N, ... Termination: CONVERGENCE"). Global
    positioning is the first Ceres solve of the global pipeline (rotation averaging has its own solver);
    if the log names the positioning step, the first report after that line is used."""
    start = 0
    m = re.search(r"global.?position", log_text, re.I)
    if m:
        start = m.start()
    hit = _CERES.search(log_text, start) or (_CERES.search(log_text) if start else None)
    if not hit:
        return None
    return {"iterations": int(hit.group(1)), "termination": hit.group(2),
            "converged": hit.group(2) in ("CONVERGENCE", "USER_SUCCESS")}


@contextmanager
def capture_native_output(log: Path | None = None):
    """Collect what C++ code (glog, Ceres) writes to fds 1 and 2 while still showing it afterwards.
    Yields a list that holds the captured text once the block exits."""
    out: list[str] = []
    sys.stdout.flush()
    sys.stderr.flush()
    saved = os.dup(1), os.dup(2)
    with tempfile.TemporaryFile(mode="w+b") as tmp:
        os.dup2(tmp.fileno(), 1)
        os.dup2(tmp.fileno(), 2)
        try:
            yield out
        finally:
            sys.stdout.flush()
            sys.stderr.flush()
            os.dup2(saved[0], 1)
            os.dup2(saved[1], 2)
            os.close(saved[0])
            os.close(saved[1])
            tmp.seek(0)
            text = tmp.read().decode("utf-8", "replace")
            out.append(text)
            sys.stderr.write(text)
            sys.stderr.flush()
            if log:
                with open(log, "a", encoding="utf-8") as fh:
                    fh.write(text)


def extract_and_match(pycolmap, database: Path, images: Path, opts: dict, matcher: str) -> None:
    pycolmap.extract_features(database, images, camera_mode=pycolmap.CameraMode.SINGLE,
                              reader_options=opts["reader"], extraction_options=opts["extraction"],
                              device=opts["device"])
    if matcher == "sequential":
        pycolmap.match_sequential(database, matching_options=opts["matching"], pairing_options=opts["pairing"],
                                  device=opts["device"])
    else:
        pycolmap.match_exhaustive(database, matching_options=opts["matching"], pairing_options=opts["pairing"],
                                  device=opts["device"])


def map_poses(pycolmap, database: Path, images: Path, sparse: Path, opts: dict, mapper: str,
              log: Path | None = None) -> tuple[list[Path], dict | None]:
    """Run the mapper; returns the model folders written under `sparse` (0/, 1/, ...) and, for the global
    mapper, how its positioning solve ended (see positioning_result; None if the log had no Ceres report)."""
    shutil.rmtree(sparse, ignore_errors=True)
    sparse.mkdir(parents=True)
    fn = pycolmap.global_mapping if mapper == "global" else pycolmap.incremental_mapping
    with capture_native_output(log) as captured:
        models = fn(database, images, sparse, opts["mapping"])
    positioning = positioning_result(captured[0]) if mapper == "global" else None
    # Both write each model to sparse/<i>/ themselves in recent versions; make sure they exist either way.
    for i, rec in models.items():
        d = sparse / str(i)
        if not (d / "images.bin").exists():
            d.mkdir(parents=True, exist_ok=True)
            rec.write(d)
    return sorted(p for p in sparse.iterdir() if p.is_dir() and (p / "images.bin").exists()), positioning


def model_stats(model_dir: Path) -> dict:
    """The numbers `colmap model_analyzer` prints, read with pycolmap (no executable needed)."""
    pycolmap = import_pycolmap()
    rec = pycolmap.Reconstruction(model_dir)
    return {
        "registered_images": int(rec.num_reg_images()),
        "points3d": int(rec.num_points3D()),
        "mean_reprojection_error_px": round(float(rec.compute_mean_reprojection_error()), 4),
        "mean_track_length": round(float(rec.compute_mean_track_length()), 3),
    }


def to_text(model_dir: Path, out: Path) -> Path:
    """Write cameras/images/points3D .txt (what room_coverage and scene_bundle parse)."""
    pycolmap = import_pycolmap()
    out.mkdir(parents=True, exist_ok=True)
    pycolmap.Reconstruction(model_dir).write_text(out)
    return out


def undistort(model_dir: Path, images: Path, dataset: Path) -> None:
    """Undistorted images + pinhole model in dataset/{images,sparse} (what Brush and gsplat read)."""
    pycolmap = import_pycolmap()
    shutil.rmtree(dataset, ignore_errors=True)
    pycolmap.undistort_images(dataset, model_dir, images, output_type="COLMAP")


def versions() -> dict:
    pycolmap = import_pycolmap()
    return {"pycolmap": pycolmap.__version__, "pycolmap_cuda": bool(getattr(pycolmap, "has_cuda", False))}
