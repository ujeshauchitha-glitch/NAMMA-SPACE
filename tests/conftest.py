import shutil
import struct
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

SYNTHETIC_PLY = ROOT / "viewer" / "public" / "fixtures" / "SYNTHETIC" / "synthetic_room.ply"
TINY_MODEL = ROOT / "tests" / "fixtures" / "tiny_colmap_model"


@pytest.fixture
def synthetic_ply() -> Path:
    """SYNTHETIC splat (not a reconstruction): only for testing file-format checks."""
    return SYNTHETIC_PLY


@pytest.fixture
def ply_bytes() -> bytes:
    return SYNTHETIC_PLY.read_bytes()


@pytest.fixture
def header_end(ply_bytes) -> int:
    marker = b"end_header\n"
    return ply_bytes.index(marker) + len(marker)


requires_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not on PATH")


def has_colmap() -> bool:
    from common import find_tool
    return bool(find_tool("colmap", required=False))


requires_colmap = pytest.mark.skipif(not has_colmap(), reason="COLMAP not installed (run scripts/setup_tools)")
