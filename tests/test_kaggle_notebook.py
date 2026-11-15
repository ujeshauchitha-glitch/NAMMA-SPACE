"""notebooks/kaggle_reconstruct.ipynb: structure, pins and that every cell is valid Python.

The notebook itself only runs on Kaggle (GPU); these checks catch what would otherwise surface there.
"""
import ast
import importlib.util
import json
import re
from pathlib import Path

import compress
import render_views
import run_pipeline
import sfm_pycolmap

ROOT = Path(__file__).resolve().parent.parent
NB = ROOT / "notebooks" / "kaggle_reconstruct.ipynb"


def load_builder():
    spec = importlib.util.spec_from_file_location("build_kaggle_notebook", ROOT / "notebooks" / "build_kaggle_notebook.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def cells():
    return json.loads(NB.read_text())["cells"]


def test_notebook_is_generated_from_the_builder():
    assert json.loads(NB.read_text()) == load_builder().build()


def test_cell_order_install_clone_run_timings_renders_zip():
    c = cells()
    assert [x["cell_type"] for x in c] == ["markdown"] + ["code"] * 7
    src = ["".join(x["source"]) for x in c]
    order = ["# ---- configuration", "# ---- install", "# ---- clone", "# ---- run the pipeline", "# ---- stage timings",
             "# ---- three rendered views", "# ---- zip the scene bundle"]
    assert [s.splitlines()[0][:len(o)] for s, o in zip(src[1:], order)] == order


def test_first_cell_documents_five_human_steps_and_sources():
    intro = "".join(cells()[0]["source"])
    steps = re.findall(r"^(\d)\. \*\*", intro, re.M)
    assert steps == ["1", "2", "3", "4", "5"]
    assert "T4" in intro and "P100" in intro and "Internet" in intro and "/kaggle/input" in intro
    for url in ("pypi.org/project/pycolmap-cuda12", "pypi.org/project/gsplat", "splat-transform", "nodejs.org"):
        assert url in intro


def test_every_code_cell_and_the_embedded_check_script_parse():
    for c in cells():
        if c["cell_type"] == "code":
            src = "".join(c["source"])
            ast.parse(src)
            for inner in re.findall(r"'''(.*?)'''", src, re.S):
                ast.parse(inner)


def test_pins_agree_with_the_pipeline():
    pins = load_builder().PINS
    assert pins["splat-transform"] == compress.SPLAT_TRANSFORM_VERSION
    assert pins["pycolmap-cuda12"] == "4.2.1" and pins["gsplat"] == "1.5.3"
    assert sfm_pycolmap.VOCAB_TREE_SHA256 and "pycolmap-cuda12==4.2.1" in Path(sfm_pycolmap.__file__).read_text()


def test_defaults_smoke_test_sample_and_branch():
    config = "".join(cells()[1]["source"])
    assert 'INPUT_VIDEO = ""' in config and 'BRANCH = "round2/poi-nav"' in config
    clone = "".join(cells()[3]["source"])
    assert "tests/sample_data/capture_short.mp4" in clone
    assert (ROOT / "tests" / "sample_data" / "capture_short.mp4").is_file()


def test_run_cell_only_uses_flags_the_pipeline_has():
    run = "".join(cells()[4]["source"])
    flags = set(re.findall(r'"(--[a-z-]+)"', run))
    src = Path(run_pipeline.__file__).read_text()
    assert flags and all(f'"{f}"' in src for f in flags), flags
    assert "--profile" in flags and "--sfm" in flags and "--trainer" in flags


def test_render_views_helpers(tmp_path):
    assert render_views.pick_views(100, 3) == [0, 50, 99]
    assert render_views.pick_views(2, 3) == [0, 1]
    assert render_views.pick_views(10, 1) == [5]
    (tmp_path / "splat_gsplat").mkdir()
    raw = tmp_path / "splat_gsplat" / "splat.ply"
    raw.write_bytes(b"ply")
    (tmp_path / "report.json").write_text(json.dumps({"train_output": {"ply": str(raw)}}))
    assert render_views.find_splat(tmp_path) == raw
    clean = raw.with_name("splat_clean.ply")
    clean.write_bytes(b"ply")
    assert render_views.find_splat(tmp_path) == clean
