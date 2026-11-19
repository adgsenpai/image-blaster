"""Locate glowing props (vending machines) in a World Labs interior splat by colour.

Prints, in viewer room space (flip Y/Z, metric scale, ground offset; camera at origin
looking down -z), the alpha-weighted centroid and extent of strongly red and strongly
cyan/blue splats, plus the depth profile of the far wall.
"""
import json
import sys

import numpy as np

sys.path.insert(0, sys.path[0])
from clip_splats import positions, read_spz  # noqa: E402
from scan_stats import colors  # noqa: E402

wdir = sys.argv[1]
sem = json.load(open(f"{wdir}/output/world/0-world.json"))["assets"]["splats"]["semantics_metadata"]
h, arr = read_spz(__import__("pathlib").Path(f"{wdir}/output/world/0-world-full_res.spz"))
P = positions(arr, h["frac"]) * sem["metric_scale_factor"]
P[:, 1] *= -1
P[:, 2] *= -1
P[:, 1] += sem["ground_plane_offset"]
rgb, a = colors(arr)
r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
lum = rgb.max(1)
near = (P[:, 2] < -2) & (P[:, 2] > -16) & (np.abs(P[:, 0]) < 7) & (P[:, 1] > 0.2) & (P[:, 1] < 2.6)


def report(name, m):
    m = m & near & (a > 0.5)
    if m.sum() < 30:
        print(name, "not found")
        return
    q = P[m]
    lo, hi = np.percentile(q, 10, 0), np.percentile(q, 90, 0)
    print(f"{name}: n={m.sum()} centroid {np.median(q, 0).round(2)} p10 {lo.round(2)} p90 {hi.round(2)}")


report("red glow ", (r > 0.75) & (g < 0.45) & (b < 0.4) & (lum > 0.75))
report("cyan glow", (b > 0.75) & (r < 0.45) & (lum > 0.75))
report("warm glow (bottles)", (r > 0.85) & (g > 0.55) & (b < 0.35))
for z0 in np.arange(-2, -16, -1.0):
    sl = (P[:, 2] < z0) & (P[:, 2] >= z0 - 1) & (P[:, 1] > 0.3) & (P[:, 1] < 2.5) & (a > 0.3)
    if sl.sum():
        print(f"z {z0:+.0f}: splats {sl.sum():7d}  x p5..p95 {np.percentile(P[sl,0],5):+.1f}..{np.percentile(P[sl,0],95):+.1f}")

# Densest 0.5 m cells of glowing amber (bottle windows) and saturated red (machine body).
for name, m in (("amber", (r > 0.8) & (g > 0.5) & (b < 0.35) & (lum > 0.8)), ("red body", (r > 0.55) & (g < 0.25) & (b < 0.25))):
    m = m & near & (a > 0.5) & (P[:, 1] > 0.5) & (P[:, 1] < 2.2)
    q = P[m]
    H, xe, ze = np.histogram2d(q[:, 0], q[:, 2], bins=[np.arange(-5, 7, 0.5), np.arange(-16, -2, 0.5)])
    idx = np.dstack(np.unravel_index(np.argsort(H.ravel())[::-1][:5], H.shape))[0]
    print(name, "top cells:", [(round(xe[i] + 0.25, 2), round(ze[j] + 0.25, 2), int(H[i, j])) for i, j in idx])
