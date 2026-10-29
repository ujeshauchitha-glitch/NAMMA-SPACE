"""T25 — heuristic source rules for the studio quality gate.

These test the HEURISTIC lint functions in apps/studio/scripts/quality_gate.py on
synthetic inputs plus one integration pass over the real `src/`. A pass here says
the gate rules detect the banned patterns; it is not a substitute for review.

    uv run --with pytest python -m pytest tests -q
"""
import importlib.util
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
GATE_PATH = REPO / "apps" / "studio" / "scripts" / "quality_gate.py"


def _load_gate():
    spec = importlib.util.spec_from_file_location("studio_quality_gate", GATE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gate = _load_gate()


def write_tree(tmp_path, files: dict[str, str]) -> Path:
    for rel, content in files.items():
        target = tmp_path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    return tmp_path


# ------------------------------------------------------------------ R1 legacy tokens
def test_legacy_token_hex_is_flagged(tmp_path):
    src = write_tree(tmp_path, {"styles/tokens.css": ":root { --bg: #0d100f; }"})
    assert gate.scan_legacy_tokens(src)


def test_legacy_font_names_are_flagged(tmp_path):
    src = write_tree(tmp_path, {"App.tsx": "const font = 'Manrope';\nconst mono = 'DM Mono';\n"})
    assert gate.scan_legacy_tokens(src)


def test_clean_tokens_pass(tmp_path):
    src = write_tree(tmp_path, {"styles/tokens.css": ":root { --surface-0: #101418; }"})
    assert gate.scan_legacy_tokens(src) == []


# ------------------------------------------------------------------ R2 %-style coverage strings
def test_percent_complete_string_is_flagged(tmp_path):
    src = write_tree(tmp_path, {"Coverage.tsx": "return <p>{`Coverage: 92 % complete`}</p>;"})
    assert gate.scan_percent_coverage_strings(src)


def test_percent_complete_without_space_is_flagged(tmp_path):
    src = write_tree(tmp_path, {"Coverage.tsx": "label('47% complete');"})
    assert gate.scan_percent_coverage_strings(src)


def test_percent_inside_comment_is_not_flagged(tmp_path):
    # Docs that describe the ban must not trip the ban.
    src = write_tree(tmp_path, {"Coverage.tsx": "// Forbidden: radial % rings, \"92 % complete\" scores.\nexport const X = 1;\n"})
    assert gate.scan_percent_coverage_strings(src) == []


def test_plain_css_percentages_are_not_flagged(tmp_path):
    src = write_tree(tmp_path, {"Button.module.css": ".x { width: 100%; height: 50%; }"})
    assert gate.scan_percent_coverage_strings(src) == []


def test_progress_ratio_without_percent_word_is_not_flagged(tmp_path):
    src = write_tree(tmp_path, {"CoverageIndicator.tsx": "const summary = `${occupied}/${groups.length}`;"})
    assert gate.scan_percent_coverage_strings(src) == []


# ------------------------------------------------------------------ R3 un-revoked object URLs
def test_create_object_url_without_revoke_is_flagged(tmp_path):
    src = write_tree(tmp_path, {"leaky.ts": "const u = URL.createObjectURL(blob);\nexport default u;\n"})
    hits = gate.scan_unrevoked_object_urls(src)
    assert hits and "leaky.ts" in hits[0]


def test_create_object_url_with_revoke_passes(tmp_path):
    src = write_tree(tmp_path, {"ok.ts": "const u = URL.createObjectURL(blob);\nURL.revokeObjectURL(u);\n"})
    assert gate.scan_unrevoked_object_urls(src) == []


def test_registry_helper_passes(tmp_path):
    src = write_tree(tmp_path, {
        "lib/objectUrls.ts": (
            "export function createObjectUrl(b: Blob) { return URL.createObjectURL(b); }\n"
            "export function revokeObjectUrl(u: string) { URL.revokeObjectURL(u); }\n"
        )
    })
    assert gate.scan_unrevoked_object_urls(src) == []


# ------------------------------------------------------------------ R4 SIMULATED chip derivation
def test_simulated_chip_without_scenekind_derivation_is_flagged(tmp_path):
    src = write_tree(tmp_path, {"Hud.tsx": "export const Hud = () => <span>◇ SIMULATED</span>;\n"})
    assert gate.scan_simulated_derivation(src)


def test_simulated_chip_with_scenekind_derivation_passes(tmp_path):
    src = write_tree(tmp_path, {
        "Workspace.tsx": (
            "const isSimulated = bundle?.manifest.sceneKind === 'synthetic-demo';\n"
            "export const Hud = () => isSimulated ? <span>◇ SIMULATED</span> : null;\n"
        )
    })
    assert gate.scan_simulated_derivation(src) == []


def test_no_simulated_literal_means_no_requirement(tmp_path):
    src = write_tree(tmp_path, {"Viewer.tsx": "export const V = () => <main />;\n"})
    assert gate.scan_simulated_derivation(src) == []


# ------------------------------------------------------------------ spec-suite inventory
def test_expected_suite_inventory_reports_missing(tmp_path):
    tests = tmp_path / "tests"
    tests.mkdir()
    for name in ("tokens.test.ts", "qr.test.ts"):
        (tests / name).write_text("", encoding="utf-8")
    missing = gate.missing_expected_suites(tests)
    assert "coverage" in missing
    assert "tokens" not in missing


# ------------------------------------------------------------------ integration: real src must be clean
def test_real_src_is_clean_unrevoked_object_urls():
    """Guards src/ against regression of the object-URL leak R3 originally
    caught (LiveScanWorkspace minted registry URLs nothing revoked; fixed by
    the owning session 2026-10-29). No xfail — this is a genuine green guard."""
    assert gate.scan_unrevoked_object_urls(REPO / "apps" / "studio" / "src") == []


@pytest.mark.parametrize("scanner", [gate.scan_legacy_tokens, gate.scan_percent_coverage_strings,
                                     gate.scan_simulated_derivation])
def test_real_src_is_clean(scanner):
    assert scanner(REPO / "apps" / "studio" / "src") == []
