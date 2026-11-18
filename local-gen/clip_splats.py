"""Cut a World Labs .spz down to the cleanly reconstructed region.

Single-image worlds smear away from the camera. Instead of hiding that at
render time, this removes every splat outside a street-aligned box (in the
viewer's world frame: flip Y/Z, metric scale, ground offset), so no blurry
splat can ever appear in the procedural stage around it.

SPZ v2 layout after the 16-byte header (all arrays of N):
  positions int24 x3 (fixed point), alpha u8, color u8 x3, scale u8 x3, rotation u8 x3, [SH]
"""
import argparse
import gzip
import json
import struct
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


def read_spz(path: Path):
    d = gzip.decompress(path.read_bytes())
    magic, ver, n, sh, frac, flags, reserved = struct.unpack("<IIIBBBB", d[:16])
    assert magic == 0x5053474E, "not an SPZ file"
    assert ver == 2, f"only SPZ v2 supported, got v{ver}"
    sh_dim = {0: 0, 1: 3, 2: 8, 3: 15}[sh] * 3
    sizes = {"pos": 9, "alpha": 1, "color": 3, "scale": 3, "rot": 3, "sh": sh_dim}
    arrays, off = {}, 16
    for k, w in sizes.items():
        arrays[k] = np.frombuffer(d, np.uint8, count=n * w, offset=off).reshape(n, w) if w else None
        off += n * w
    header = dict(version=ver, n=n, sh=sh, frac=frac, flags=flags, reserved=reserved)
    return header, arrays


def positions(arrays, frac):
    b = arrays["pos"].reshape(-1, 3, 3).astype(np.int32)
    v = b[..., 0] | (b[..., 1] << 8) | (b[..., 2] << 16)
    v = np.where(v & 0x800000, v - 0x1000000, v)
    return v.astype(np.float32) / (1 << frac)


def write_spz(path: Path, header, arrays, keep):
    n = int(keep.sum())
    head = struct.pack("<IIIBBBB", 0x5053474E, header["version"], n, header["sh"], header["frac"], header["flags"], header["reserved"])
    parts = [head] + [arrays[k][keep].tobytes() for k in ("pos", "alpha", "color", "scale", "rot", "sh") if arrays[k] is not None]
    path.write_bytes(gzip.compress(b"".join(parts), compresslevel=6))
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", required=True)
    ap.add_argument("--world", required=True)
    ap.add_argument("--index", type=int, default=1, help="world generation index")
    ap.add_argument("--game", help="game.json with arena + stage.clip (defaults to the world's game.json)")
    ap.add_argument("--analyze", action="store_true", help="only print coordinate checks")
    ap.add_argument("--out-name", default="clipped")
    a = ap.parse_args()

    root = Path(a.repo_root)
    wdir = root / "worlds" / a.world
    world_json = json.loads((wdir / f"output/world/{a.index}-world.json").read_text())
    sem = world_json["assets"]["splats"]["semantics_metadata"]
    s, g = sem["metric_scale_factor"], sem["ground_plane_offset"]
    game = json.loads(Path(a.game or wdir / "game.json").read_text())
    arena, clip = game["arena"], game["stage"]["clip"]

    src = wdir / f"output/world/{a.index}-world-full_res.spz"
    header, arrays = read_spz(src)
    P = positions(arrays, header["frac"])
    # Viewer transform: group rotated PI about X (flipY), scaled, lifted by ground offset.
    w = P * s
    w[:, 1] *= -1
    w[:, 2] *= -1
    w[:, 1] += g
    f = np.array(arena["forward"], np.float32)
    f[1] = 0
    f /= np.linalg.norm(f)
    r = np.array([-f[2], 0, f[0]], np.float32)
    o = np.array(arena["origin"], np.float32)
    rel = w - o
    u, v, y = rel @ f, rel @ r, w[:, 1]

    floor = (np.abs(y) < 0.25) & (u > 0) & (u < 20)
    print(json.dumps({
        "splats": header["n"],
        "floor_splats_u0_20": int(floor.sum()),
        "floor_v_p5_p95": [round(float(np.percentile(v[floor], 5)), 2), round(float(np.percentile(v[floor], 95)), 2)] if floor.any() else None,
        "u_p5_p95": [round(float(np.percentile(u, 5)), 1), round(float(np.percentile(u, 95)), 1)],
    }))
    if a.analyze:
        return

    keep = (u >= clip["uMin"]) & (u <= clip["uMax"]) & (v >= clip["vMin"]) & (v <= clip["vMax"]) & (y <= clip["yMax"]) & (y >= -3)
    out_dir = wdir / "output/stage"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{a.index}-world-{a.out_name}.spz"
    kept = write_spz(out, header, arrays, keep)
    (out_dir / f".{a.index}-world-{a.out_name}-request.json").write_text(json.dumps({
        "schema_version": 1, "provider": "local", "role": "splat-clip",
        "input": str(src.relative_to(root)), "clip": clip, "arena_origin": arena["origin"], "arena_forward": arena["forward"],
        "splats_in": header["n"], "splats_kept": kept, "output": str(out.relative_to(root)),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2) + "\n")
    print(json.dumps({"kept": kept, "removed": header["n"] - kept, "output": str(out.relative_to(root)), "mb": round(out.stat().st_size / 1e6, 1)}))


if __name__ == "__main__":
    main()
