"""Measure the scanned world near its clip seams so procedural geometry can match it.

Prints alpha-weighted mean colours (linear-ish sRGB 0..1) of:
  - road splats near each seam (|y| < 0.2, inside the road band)
  - left / right facade splats near each seam (0.6 < y < 3.5, at the facade lines)
and per-house facade colour runs along each side (k-means-free: 2 m bins).
"""
import argparse
import json
from pathlib import Path

import numpy as np

from clip_splats import positions, read_spz

C0 = 0.28209479177387814


def colors(arrays):
    dc = (arrays["color"].astype(np.float32) / 255.0 - 0.5) / 0.15
    rgb = np.clip(0.5 + C0 * dc, 0, 1)
    alpha = arrays["alpha"][:, 0].astype(np.float32) / 255.0
    return rgb, alpha


def mean(rgb, a, m):
    if m.sum() < 20:
        return None
    w = a[m][:, None]
    c = (rgb[m] * w).sum(0) / w.sum()
    return [round(float(x), 3) for x in c]


def hexc(c):
    return "#" + "".join(f"{int(round(x * 255)):02x}" for x in c) if c else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", required=True)
    ap.add_argument("--world", required=True)
    ap.add_argument("--index", type=int, default=1)
    a = ap.parse_args()
    root = Path(a.repo_root)
    wdir = root / "worlds" / a.world
    sem = json.loads((wdir / f"output/world/{a.index}-world.json").read_text())["assets"]["splats"]["semantics_metadata"]
    game = json.loads((wdir / "game.json").read_text())
    arena, st = game["arena"], game["stage"]
    header, arrays = read_spz(wdir / f"output/world/{a.index}-world-full_res.spz")
    P = positions(arrays, header["frac"]) * sem["metric_scale_factor"]
    P[:, 1] *= -1
    P[:, 2] *= -1
    P[:, 1] += sem["ground_plane_offset"]
    f = np.array(arena["forward"], np.float32)
    f[1] = 0
    f /= np.linalg.norm(f)
    r = np.array([-f[2], 0, f[0]], np.float32)
    rel = P - np.array(arena["origin"], np.float32)
    u, v, y = rel @ f, rel @ r, P[:, 1]
    rgb, alpha = colors(arrays)
    s = st["street"]
    out = {}
    for name, (u0, u1) in {"near_seam": (-1, 4), "mid": (6, 14), "far_seam": (18, 24.5)}.items():
        band = (u > u0) & (u < u1)
        road = band & (np.abs(y) < 0.2) & (v > s["roadLeft"] + 0.3) & (v < s["roadRight"] - 0.3)
        walkL = band & (np.abs(y - s["curb"]) < 0.2) & (v > s["left"] + 0.2) & (v < s["roadLeft"] - 0.2)
        facL = band & (y > 0.6) & (y < 3.5) & (np.abs(v - s["left"]) < 0.6)
        facR = band & (y > 0.6) & (y < 3.5) & (np.abs(v - s["right"]) < 0.6)
        roofL = band & (np.abs(v - s["left"]) < 1.2) & (y > 2.5)
        roofR = band & (np.abs(v - s["right"]) < 1.2) & (y > 2.5)
        out[name] = {
            "road": hexc(mean(rgb, alpha, road)), "sidewalk": hexc(mean(rgb, alpha, walkL)),
            "facade_left": hexc(mean(rgb, alpha, facL)), "facade_right": hexc(mean(rgb, alpha, facR)),
            "roof_left_p95": round(float(np.percentile(y[roofL], 95)), 2) if roofL.sum() > 50 else None,
            "roof_right_p95": round(float(np.percentile(y[roofR], 95)), 2) if roofR.sum() > 50 else None,
        }
    # Facade colour runs along each side (2 m bins over the clean zone).
    for side, line in (("left", s["left"]), ("right", s["right"])):
        runs = []
        for b0 in np.arange(-1, 24, 2.0):
            m = (u > b0) & (u < b0 + 2) & (y > 0.8) & (y < 3.2) & (np.abs(v - line) < 0.6)
            runs.append(hexc(mean(rgb, alpha, m)))
        out[f"runs_{side}"] = runs
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
