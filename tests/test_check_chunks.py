"""T25 — deterministic chunk-attribution / build-budget check for the studio bundle.

Tests the pure functions of apps/studio/scripts/check_chunks.py against synthetic
`dist` trees. No real build is produced here; the real numbers come from
`npm run build` + `npm run benchmark:build` and are recorded in VALIDATION.md.

    uv run --with pytest python -m pytest tests -q
"""
import gzip
import importlib.util
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHECK_PATH = REPO / "apps" / "studio" / "scripts" / "check_chunks.py"


def _load_check():
    spec = importlib.util.spec_from_file_location("studio_check_chunks", CHECK_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cc = _load_check()


def make_dist(tmp_path, chunks: dict[str, bytes], entry: str | None = None) -> Path:
    """Write a synthetic dist: chunks under assets/, plus index.html if entry given."""
    (tmp_path / "assets").mkdir(parents=True, exist_ok=True)
    for name, data in chunks.items():
        (tmp_path / "assets" / name).write_bytes(data)
    if entry:
        (tmp_path / "index.html").write_text(
            f'<script type="module" src="/assets/{entry}"></script>', encoding="utf-8"
        )
    return tmp_path


# ------------------------------------------------------------------ entry discovery
def test_entry_is_read_from_index_html_not_from_name(tmp_path):
    # The idb lazy chunk is also named index-*.js; only index.html disambiguates.
    dist = make_dist(tmp_path, {
        "index-app.js": b"console.log('entry')",
        "index-idblazy.js": b"export{a as deleteDB}",
    }, entry="index-app.js")
    assert cc.find_entry_chunk(dist) == "index-app.js"


def test_missing_index_html_is_an_error(tmp_path):
    dist = make_dist(tmp_path, {"index-app.js": b"x"})
    assert cc.find_entry_chunk(dist) is None


# ------------------------------------------------------------------ library attribution
def test_lib_markers_attribute_to_the_right_chunk(tmp_path):
    dist = make_dist(tmp_path, {
        "index-app.js": b"const{zipSync:a}=await import('x');",
        "vendor-fflate.js": b"function zipSync(){}export{zipSync,deflateSync,strToU8};",
        "vendor-idb.js": b"export{k as openDB,K as deleteDB};",
    }, entry="index-app.js")
    found = cc.attribute_libraries(dist, "index-app.js")
    assert found["fflate"] == ["vendor-fflate.js"]
    assert found["idb"] == ["vendor-idb.js"]
    assert found["three"] == []  # marker absent everywhere


def test_import_site_reference_does_not_count_as_possession(tmp_path):
    # The entry references `openDB` at the dynamic-import site; the lib code
    # (deleteDB marker) only lives in the idb chunk. Possession = lib marker.
    dist = make_dist(tmp_path, {
        "index-app.js": b"const{openDB:a}=await import('idb');",
        "vendor-idb.js": b"export{k as openDB,K as deleteDB,y as unwrap};",
    }, entry="index-app.js")
    found = cc.attribute_libraries(dist, "index-app.js")
    assert found["idb"] == ["vendor-idb.js"]


def test_lib_in_entry_chunk_is_reported_as_entry_resident(tmp_path):
    dist = make_dist(tmp_path, {
        "index-app.js": b"function zipSync(){}function deflateSync(){}export{zipSync,deflateSync};",
    }, entry="index-app.js")
    found = cc.attribute_libraries(dist, "index-app.js")
    assert found["fflate"] == ["index-app.js"]


# ------------------------------------------------------------------ three (AND markers, post-T22)
def test_three_requires_all_markers_not_just_one(tmp_path):
    # T22 imports three as a real lazy chunk. three is attributed only when a
    # chunk holds EVERY marker in LIBRARY_MARKERS_REQUIRE_ALL ("REVISION" AND
    # "SRGBColorSpace") — a single coincidental hit must not count.
    dist = make_dist(tmp_path, {
        "index-app.js": b"const T=await import('three');console.log(T);",
        "three.module-fake.js": b"const REVISION='186';const SRGBColorSpace='srgb';export{REVISION,SRGBColorSpace};",
    }, entry="index-app.js")
    found = cc.attribute_libraries(dist, "index-app.js")
    assert found["three"] == ["three.module-fake.js"]


def test_three_single_marker_hit_is_not_possession(tmp_path):
    dist = make_dist(tmp_path, {
        "index-app.js": b"const REVISION='app-version-string';",
        "vendor-other.js": b"export const SRGBColorSpace='unrelated';",
    }, entry="index-app.js")
    found = cc.attribute_libraries(dist, "index-app.js")
    assert found["three"] == []


def test_old_threejs_org_marker_is_gone():
    # The pre-T22 marker `threejs.org` does not survive minification (verified
    # count 0 in every chunk of the real build) — it must not come back.
    assert "threejs.org" not in cc.LIBRARY_MARKERS["three"]
    assert set(cc.LIBRARY_MARKERS_REQUIRE_ALL["three"]) <= set(cc.LIBRARY_MARKERS["three"])


# ------------------------------------------------------------------ verdicts
def _report_for(found, entry="index-app.js"):
    return cc.evaluate(found, entry_chunk=entry, entry_gzip=100_000, budget=cc.ENTRY_GZIP_BUDGET_BYTES)


def test_separate_lazy_chunks_pass():
    found = {
        "fflate": ["vendor-fflate.js"], "qrcode-generator": ["vendor-qr.js"],
        "idb": ["vendor-idb.js"], "playcanvas": ["vendor-pc.js"],
        "three": [], "gsap": [],
    }
    report = _report_for(found)
    assert report["entryWithinBudget"] is True
    assert report["failures"] == []


def test_two_libs_sharing_one_chunk_fails():
    found = {
        "fflate": ["vendor-shared.js"], "qrcode-generator": ["vendor-shared.js"],
        "idb": ["vendor-idb.js"], "playcanvas": ["vendor-pc.js"], "three": [], "gsap": [],
    }
    report = _report_for(found)
    assert any("share" in failure for failure in report["failures"])


def test_lazy_lib_in_entry_chunk_fails():
    found = {
        "fflate": ["index-app.js"], "qrcode-generator": ["vendor-qr.js"],
        "idb": ["vendor-idb.js"], "playcanvas": ["vendor-pc.js"], "three": [], "gsap": [],
    }
    report = _report_for(found)
    assert any("entry" in failure for failure in report["failures"])


def test_entry_over_budget_fails_with_honest_delta():
    over = cc.ENTRY_GZIP_BUDGET_BYTES + 1234
    found = {"fflate": ["a.js"], "qrcode-generator": ["b.js"], "idb": ["c.js"],
             "playcanvas": ["d.js"], "three": [], "gsap": []}
    report = cc.evaluate(found, entry_chunk="index-app.js", entry_gzip=over, budget=cc.ENTRY_GZIP_BUDGET_BYTES)
    assert report["entryWithinBudget"] is False
    assert report["entryOverBudgetByBytes"] == 1234
    assert any("budget" in failure for failure in report["failures"])


def test_declared_not_imported_libs_are_exceptions_not_failures():
    found = {"fflate": ["a.js"], "qrcode-generator": ["b.js"], "idb": ["c.js"],
             "playcanvas": ["d.js"], "three": [], "gsap": []}
    report = _report_for(found)
    assert report["failures"] == []
    assert set(report["exceptions"]) == {"three", "gsap"}


# ------------------------------------------------------------------ gzip helper
def test_gzip_size_matches_stdlib(tmp_path):
    p = tmp_path / "x.js"
    payload = b"abc" * 1000
    p.write_bytes(payload)
    assert cc.gzip_size(p) == len(gzip.compress(payload, compresslevel=9))


# ------------------------------------------------------------------ report budget block (benchmark expectations)
def test_budget_block_shape_is_stable():
    block = cc.budget_expectations(
        entry_gzip=130_112,
        attribution={"fflate": ["vendor-fflate.js"], "qrcode-generator": ["vendor-qr.js"],
                     "idb": ["vendor-idb.js"], "playcanvas": ["vendor-pc.js"],
                     "three": [], "gsap": []},
    )
    assert block["entryGzipBudgetBytes"] == cc.ENTRY_GZIP_BUDGET_BYTES
    assert block["entryGzipBytes"] == 130_112
    assert block["entryBudgetMet"] is True
    assert "expectedLazyChunkLibraries" in block
    assert block["notImportedExceptions"] == ["gsap", "three"]
    # must survive a JSON round-trip for embedding in build-report.json
    assert json.loads(json.dumps(block)) == block
