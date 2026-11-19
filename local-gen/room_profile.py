"""Profile a World Labs interior collider in viewer space (flip Y/Z, metric scale, ground offset).

Prints the floor extent and, for horizontal bands ahead of the camera, the nearest wall
depth (-z) per x slice: used to place shop hotspots against the scanned walls.
"""
import json
import sys

import numpy as np
import trimesh

wdir = sys.argv[1]
sem = json.load(open(f"{wdir}/output/world/0-world.json"))["assets"]["splats"]["semantics_metadata"]
s, g = sem["metric_scale_factor"], sem["ground_plane_offset"]
m = trimesh.load(f"{wdir}/output/world/0-world.glb", force="mesh")
v = np.asarray(m.vertices) * s
v[:, 1] *= -1
v[:, 2] *= -1
v[:, 1] += g
print("bounds x %.1f..%.1f y %.1f..%.1f z %.1f..%.1f" % (v[:, 0].min(), v[:, 0].max(), v[:, 1].min(), v[:, 1].max(), v[:, 2].min(), v[:, 2].max()))
floor = v[np.abs(v[:, 1]) < 0.15]
print("floor x %.1f..%.1f z %.1f..%.1f" % tuple(np.percentile(floor[:, 0], [3, 97]).tolist() + np.percentile(floor[:, 2], [3, 97]).tolist()))
# Walls/objects at chest height ahead of the camera: nearest -z per x slice.
band = v[(v[:, 1] > 0.8) & (v[:, 1] < 1.6) & (v[:, 2] < -0.5)]
for x0 in np.arange(-4, 4.01, 0.5):
    sl = band[(band[:, 0] >= x0) & (band[:, 0] < x0 + 0.5)]
    if len(sl):
        print(f"x {x0:+.1f}: nearest z {sl[:, 2].max():+.2f}  (p50 {np.median(sl[:, 2]):+.2f})")
