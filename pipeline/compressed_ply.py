"""Compressed PLY (PlayCanvas / SuperSplat format) written in pure numpy: the last-resort web format.

    python pipeline/compressed_ply.py in.ply out.compressed.ply

compress.py uses splat-transform for SOG and compressed PLY. If splat-transform cannot run at all (its CLI
imports the native WebGPU module at startup, so a missing/incompatible Dawn binary stops even CPU-only
commands), this writer still produces a file the studio's PlayCanvas engine loads natively, about 4x smaller
than the float PLY, with no Node, GPU or network.

Layout, matched to PlayCanvas 2.23 (isCompressedPly, readCompressedPly, SplatCompressedIterator):
  element chunk  (one per 256 splats), 18 floats: min/max x y z, min/max log-scale x y z, min/max r g b
  element vertex, 4 uint32: packed_position (11-10-11 unorm within the chunk box),
                            packed_rotation (2-bit index of the largest component + 3 x 10-bit others),
                            packed_scale (11-10-11 within the chunk's log-scale box),
                            packed_color (8-8-8-8: r g b within the chunk colour box, then opacity)
  element sh (optional), uchar f_rest_0..: (v + 4) * 255 / 8, channel-major like the float PLY
Colours are 0.5 + SH_C0 * f_dc; opacity is sigmoid(opacity). Splats are sorted along a Morton curve
first so each 256-splat chunk is spatially tight (that is what keeps 11 bits per axis precise).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

SH_C0 = 0.28209479177387814
CHUNK = 256
CHUNK_PROPS = ["min_x", "min_y", "min_z", "max_x", "max_y", "max_z",
               "min_scale_x", "min_scale_y", "min_scale_z", "max_scale_x", "max_scale_y", "max_scale_z",
               "min_r", "min_g", "min_b", "max_r", "max_g", "max_b"]
VERTEX_PROPS = ["packed_position", "packed_rotation", "packed_scale", "packed_color"]


def _unorm(v: np.ndarray, bits: int) -> np.ndarray:
    t = (1 << bits) - 1
    return np.clip(np.round(np.clip(v, 0, 1) * t), 0, t).astype(np.uint32)


def _norm01(v: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> np.ndarray:
    span = hi - lo
    return np.where(span > 0, (v - lo) / np.where(span > 0, span, 1), 0.0)


def _pack111011(v: np.ndarray) -> np.ndarray:
    return (_unorm(v[:, 0], 11) << 21) | (_unorm(v[:, 1], 10) << 11) | _unorm(v[:, 2], 11)


def pack_rotation(q_wxyz: np.ndarray) -> np.ndarray:
    """Smallest-three: mode = index (in w,x,y,z order) of the largest |component|, made positive; the other
    three, in w,x,y,z order, stored as unorm10 of (v / sqrt(2) + 0.5)."""
    q = q_wxyz / np.linalg.norm(q_wxyz, axis=1, keepdims=True)
    largest = np.abs(q).argmax(1)
    q = q * np.where(q[np.arange(len(q)), largest] < 0, -1.0, 1.0)[:, None]
    others = np.array([[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]])[largest]
    rest = np.take_along_axis(q, others, axis=1) / np.sqrt(2) + 0.5
    return (largest.astype(np.uint32) << 30) | (_unorm(rest[:, 0], 10) << 20) | (_unorm(rest[:, 1], 10) << 10) | _unorm(rest[:, 2], 10)


def morton_order(xyz: np.ndarray) -> np.ndarray:
    """Indices sorting points along a 3D Morton (Z-order) curve, 10 bits per axis."""
    lo, hi = xyz.min(0), xyz.max(0)
    g = np.clip(((xyz - lo) / np.where(hi > lo, hi - lo, 1) * 1023).astype(np.uint64), 0, 1023)

    def spread(v):
        v = (v | (v << np.uint64(16))) & np.uint64(0x030000FF)
        v = (v | (v << np.uint64(8))) & np.uint64(0x0300F00F)
        v = (v | (v << np.uint64(4))) & np.uint64(0x030C30C3)
        return (v | (v << np.uint64(2))) & np.uint64(0x09249249)

    code = spread(g[:, 0]) | (spread(g[:, 1]) << np.uint64(1)) | (spread(g[:, 2]) << np.uint64(2))
    return np.argsort(code, kind="stable")


def encode(props: list[str], data: np.ndarray, sh_bands: int | None = None) -> bytes:
    """Float 3DGS PLY columns -> compressed PLY bytes. sh_bands: 0..3 (default: as many as the input has)."""
    col = {k: i for i, k in enumerate(props)}
    rest = sorted((p for p in props if p.startswith("f_rest_")), key=lambda p: int(p.split("_")[-1]))
    in_coeffs = len(rest) // 3
    bands = {0: 0, 3: 1, 8: 2, 15: 3}.get(in_coeffs, 0) if sh_bands is None else sh_bands
    out_coeffs = [0, 3, 8, 15][bands]
    d = data[np.isfinite(data).all(1)]
    d = d[morton_order(d[:, [col["x"], col["y"], col["z"]]])]
    n = len(d)
    xyz = d[:, [col["x"], col["y"], col["z"]]]
    log_s = d[:, [col["scale_0"], col["scale_1"], col["scale_2"]]]
    rgb = np.clip(0.5 + SH_C0 * d[:, [col["f_dc_0"], col["f_dc_1"], col["f_dc_2"]]], 0, 1)
    alpha = 1 / (1 + np.exp(-d[:, col["opacity"]]))
    quat = d[:, [col["rot_0"], col["rot_1"], col["rot_2"], col["rot_3"]]]

    n_chunks = (n + CHUNK - 1) // CHUNK
    pad = n_chunks * CHUNK - n
    def chunked(a):
        a = np.concatenate([a, np.repeat(a[-1:], pad, 0)]) if pad else a
        return a.reshape(n_chunks, CHUNK, -1)
    c_xyz, c_s, c_rgb = chunked(xyz), chunked(log_s), chunked(rgb)
    lo_p, hi_p = c_xyz.min(1), c_xyz.max(1)
    lo_s, hi_s = c_s.min(1), c_s.max(1)
    lo_c, hi_c = c_rgb.min(1), c_rgb.max(1)
    chunks = np.concatenate([lo_p, hi_p, lo_s, hi_s, lo_c, hi_c], axis=1).astype("<f4")

    idx = np.arange(n) // CHUNK
    vert = np.empty((n, 4), np.uint32)
    vert[:, 0] = _pack111011(_norm01(xyz, lo_p[idx], hi_p[idx]))
    vert[:, 1] = pack_rotation(quat)
    vert[:, 2] = _pack111011(_norm01(log_s, lo_s[idx], hi_s[idx]))
    c = _norm01(rgb, lo_c[idx], hi_c[idx])
    vert[:, 3] = (_unorm(c[:, 0], 8) << 24) | (_unorm(c[:, 1], 8) << 16) | (_unorm(c[:, 2], 8) << 8) | _unorm(alpha, 8)

    header = ["ply", "format binary_little_endian 1.0", "comment generated by Namma Space pipeline/compressed_ply.py",
              f"element chunk {n_chunks}", *[f"property float {p}" for p in CHUNK_PROPS],
              f"element vertex {n}", *[f"property uint {p}" for p in VERTEX_PROPS]]
    body = chunks.tobytes() + vert.astype("<u4").tobytes()
    if out_coeffs:
        sh = np.zeros((n, 3, out_coeffs), np.float32)
        take = min(out_coeffs, in_coeffs)
        rest_cols = [col[p] for p in rest]
        src = d[:, rest_cols].reshape(n, 3, in_coeffs)  # channel-major: R coeffs, then G, then B
        sh[:, :, :take] = src[:, :, :take]
        header += [f"element sh {n}", *[f"property uchar f_rest_{i}" for i in range(3 * out_coeffs)]]
        body += np.clip(np.round((sh.reshape(n, -1) + 4) * 255 / 8), 0, 255).astype(np.uint8).tobytes()
    return ("\n".join(header) + "\nend_header\n").encode("ascii") + body


def decode(raw: bytes) -> dict:
    """Mirror of PlayCanvas's SplatCompressedIterator, for tests: returns xyz, quat (wxyz), log_scale,
    rgb, alpha and sh (n, 3, coeffs) as floats."""
    end = raw.index(b"end_header\n") + len(b"end_header\n")
    lines = raw[:end].decode("ascii").splitlines()
    counts = {ln.split()[1]: int(ln.split()[2]) for ln in lines if ln.startswith("element")}
    n_chunks, n = counts["chunk"], counts["vertex"]
    chunks = np.frombuffer(raw, "<f4", n_chunks * 18, end).reshape(n_chunks, 18)
    off = end + n_chunks * 18 * 4
    v = np.frombuffer(raw, "<u4", n * 4, off).reshape(n, 4)
    off += n * 16
    ch = chunks[np.arange(n) // CHUNK]
    un = lambda x, bits: (x & ((1 << bits) - 1)) / ((1 << bits) - 1)
    t111 = lambda x: np.stack([un(x >> 21, 11), un(x >> 11, 10), un(x, 11)], 1)
    lerp = lambda a, b, t: a * (1 - t) + b * t
    xyz = lerp(ch[:, 0:3], ch[:, 3:6], t111(v[:, 0]))
    log_s = lerp(ch[:, 6:9], ch[:, 9:12], t111(v[:, 2]))
    col = np.stack([un(v[:, 3] >> 24, 8), un(v[:, 3] >> 16, 8), un(v[:, 3] >> 8, 8), un(v[:, 3], 8)], 1)
    rgb = lerp(ch[:, 12:15], ch[:, 15:18], col[:, :3])
    r = v[:, 1]
    a, b, c = [(un(r >> s, 10) - 0.5) * np.sqrt(2) for s in (20, 10, 0)]
    m = np.sqrt(np.clip(1 - (a * a + b * b + c * c), 0, 1))
    mode = r >> 30
    # PlayCanvas sets Quat(x, y, z, w) per mode; rebuild w,x,y,z
    w = np.select([mode == 0, mode == 1, mode == 2, mode == 3], [m, a, a, a])
    x = np.select([mode == 0, mode == 1, mode == 2, mode == 3], [a, m, b, b])
    y = np.select([mode == 0, mode == 1, mode == 2, mode == 3], [b, b, m, c])
    z = np.select([mode == 0, mode == 1, mode == 2, mode == 3], [c, c, c, m])
    out = {"xyz": xyz, "log_scale": log_s, "rgb": rgb, "alpha": col[:, 3], "quat": np.stack([w, x, y, z], 1)}
    if "sh" in counts:
        k = (len([ln for ln in lines if ln.startswith("property uchar f_rest_")])) // 3
        out["sh"] = np.frombuffer(raw, np.uint8, n * 3 * k, off).reshape(n, 3, k) * (8 / 255) - 4
    return out


def convert(src: Path, dst: Path, sh_bands: int | None = None) -> int:
    from clean_splat import read_ply

    _, props, data = read_ply(src)
    dst.write_bytes(encode(props, data, sh_bands))
    return len(data)


if __name__ == "__main__":
    print(f"{convert(Path(sys.argv[1]), Path(sys.argv[2]))} splats -> {sys.argv[2]}")
