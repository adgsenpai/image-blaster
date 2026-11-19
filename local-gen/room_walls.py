"""Measure the real room surfaces of a World Labs interior splat (viewer room space).

Prints floor/ceiling heights, the side-wall x positions, and for each 0.5 m x-slice the
front-most wall depth (z, looking down -z) at several heights. Use it to place props flush.
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, sys.path[0])
from clip_splats import positions, read_spz  # noqa: E402
from scan_stats import colors  # noqa: E402

wdir = sys.argv[1]
sem = json.load(open(f"{wdir}/output/world/0-world.json"))["assets"]["splats"]["semantics_metadata"]
h, arr = read_spz(Path(f"{wdir}/output/world/0-world-full_res.spz"))
P = positions(arr, h["frac"]) * sem["metric_scale_factor"]
P[:, 1] *= -1
P[:, 2] *= -1
P[:, 1] += sem["ground_plane_offset"]
_, a = colors(arr)
S = P[a > 0.5]

core = (np.abs(S[:, 0]) < 2) & (S[:, 2] < -1) & (S[:, 2] > -9)
ys = S[core, 1]
hist, edges = np.histogram(ys, bins=np.arange(-1, 6, 0.05))
print(f"floor ~ {edges[np.argmax(hist[: len(hist) // 2])]:.2f}   ceiling ~ {edges[len(hist) // 2 + np.argmax(hist[len(hist) // 2:])]:.2f}")

band = (S[:, 1] > 0.5) & (S[:, 1] < 2.0)
for z0 in (-1.0, -3.0, -5.0, -7.0, -9.0, 1.0, 3.0):
    sl = band & (S[:, 2] < z0 + 0.5) & (S[:, 2] > z0 - 0.5)
    xs = S[sl, 0]
    if len(xs) > 50:
        print(f"z {z0:+.0f}: side walls x ≈ {np.percentile(xs, 2):+.2f} .. {np.percentile(xs, 98):+.2f}")

print("front-most wall z per x slice (looking -z), heights 0.3 / 1.2 / 2.5 m:")
for x0 in np.arange(-4, 4.5, 0.5):
    row = []
    for y0 in (0.3, 1.2, 2.5):
        sl = (np.abs(S[:, 0] - x0) < 0.25) & (np.abs(S[:, 1] - y0) < 0.15) & (S[:, 2] < -1.5)
        zs = S[sl, 2]
        if len(zs) < 20:
            row.append("   --  ")
            continue
        # The far wall = the deepest dense layer; report the 5th percentile of depth (nearest dense backing).
        hz, ez = np.histogram(zs, bins=np.arange(-16, -1.5, 0.1))
        dense = np.where(hz >= max(8, hz.max() * 0.25))[0]
        row.append(f"{ez[dense[-1]] if len(dense) else np.median(zs):+6.2f} ")
    print(f"x {x0:+.1f}: " + " ".join(row))

print("back side (behind camera, z>0) wall z per x at 1.2 m:")
for x0 in np.arange(-4, 4.5, 1.0):
    sl = (np.abs(S[:, 0] - x0) < 0.25) & (np.abs(S[:, 1] - 1.2) < 0.15) & (S[:, 2] > 0)
    if sl.sum() > 20:
        print(f"x {x0:+.1f}: z ≈ {np.percentile(S[sl, 2], 50):+.2f}  (n={sl.sum()})")

# Top-down ASCII density map (y 0.6..2.0), x across, z down the page from +3 to -14.
m = (S[:, 1] > 0.6) & (S[:, 1] < 2.0)
H, _, _ = np.histogram2d(S[m, 2], S[m, 0], bins=[np.arange(-14, 3.01, 0.25), np.arange(-6, 7.01, 0.25)])
H = H[::-1]
ramp = " .:-=+*#%@"
print("     x: -6" + " " * 20 + "0" + " " * 22 + "+6")
for i, row in enumerate(H):
    z = 3 - i * 0.25
    print(f"z{z:+6.2f} " + "".join(ramp[min(9, int(np.log1p(v) * 1.6))] for v in row) + ("  <cam" if abs(z) < 0.13 else ""))
