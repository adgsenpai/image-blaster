"""Clean up a scanned interior splat for gameplay.

Keeps the full-resolution splat but removes:
  - everything deeper than `--zmin` (poorly reconstructed rooms beyond an arch/door),
  - splats inside `--remove` boxes (props that get replaced by crisp 3D models).

Coordinates are viewer room space: flip Y/Z, metric scale, ground offset, the photo
camera at the origin looking down -z (same frame as room_find.py / the game config).

  --remove "x0,x1,y0,y1,z0,z1" (repeatable)
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from clip_splats import positions, read_spz, write_spz


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--world-dir", required=True)
    ap.add_argument("--zmin", type=float, default=-1e9)
    ap.add_argument("--remove", action="append", default=[])
    ap.add_argument("--out-name", default="clean")
    ap.add_argument("--remove-grey", action="append", default=[], help="box like --remove, drops only low-saturation splats")
    ap.add_argument("--keep-front", help="yawdeg,umin: drop splats with room-axis depth u < umin")
    a = ap.parse_args()

    wdir = Path(a.world_dir)
    sem = json.loads((wdir / "output/world/0-world.json").read_text())["assets"]["splats"]["semantics_metadata"]
    src = wdir / "output/world/0-world-full_res.spz"
    header, arrays = read_spz(src)
    P = positions(arrays, header["frac"]) * sem["metric_scale_factor"]
    P[:, 1] *= -1
    P[:, 2] *= -1
    P[:, 1] += sem["ground_plane_offset"]

    keep = P[:, 2] >= a.zmin
    if a.keep_front:
        yaw, umin = (float(t) for t in a.keep_front.split(","))
        yr = np.radians(yaw)
        keep &= P[:, 0] * np.sin(yr) - P[:, 2] * np.cos(yr) >= umin
    boxes = []
    for spec in a.remove:
        x0, x1, y0, y1, z0, z1 = map(float, spec.split(","))
        boxes.append([x0, x1, y0, y1, z0, z1])
        inside = (P[:, 0] >= x0) & (P[:, 0] <= x1) & (P[:, 1] >= y0) & (P[:, 1] <= y1) & (P[:, 2] >= z0) & (P[:, 2] <= z1)
        keep &= ~inside

    if a.remove_grey:
        from scan_stats import colors
        rgb, _ = colors(arrays)
        grey = (rgb.max(1) - rgb.min(1) < 0.14) & (rgb.mean(1) > 0.3)
        for spec in a.remove_grey:
            x0, x1, y0, y1, z0, z1 = map(float, spec.split(","))
            boxes.append(["grey", x0, x1, y0, y1, z0, z1])
            keep &= ~(grey & (P[:, 0] >= x0) & (P[:, 0] <= x1) & (P[:, 1] >= y0) & (P[:, 1] <= y1) & (P[:, 2] >= z0) & (P[:, 2] <= z1))

    out_dir = wdir / "output/stage"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"0-world-{a.out_name}.spz"
    kept = write_spz(out, header, arrays, keep)
    (out_dir / f".0-world-{a.out_name}-request.json").write_text(json.dumps({
        "schema_version": 1, "provider": "local", "role": "room-clip", "input": str(src),
        "zmin": a.zmin, "keep_front": a.keep_front, "remove": boxes, "splats_in": header["n"], "splats_kept": kept,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2) + "\n")
    print(json.dumps({"kept": kept, "removed": header["n"] - kept, "output": str(out), "mb": round(out.stat().st_size / 1e6, 1)}))


if __name__ == "__main__":
    main()
