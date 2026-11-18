"""Generate tileable PBR textures for the procedural stage (streets, sidewalks, plaster).

All textures tile seamlessly (periodic noise / periodic Voronoi), so the procedural
city can repeat them over hundreds of metres without seams.

  cobble_albedo / cobble_normal / cobble_rough   wet basalt cobblestones (tile ~2.4 m)
  paver_albedo  / paver_normal  / paver_rough    sidewalk slabs (tile 2 m, 4x4 slabs)
  plaster_albedo / plaster_normal                 rough painted plaster, grey (tinted in engine)
"""
import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

N = 1024
rng = np.random.default_rng(7)


def periodic_noise(n, cells, octaves=5, persistence=0.5):
    """Tileable value noise: upsample a periodic random grid with wrap-around cubic interpolation."""
    out = np.zeros((n, n), np.float32)
    amp, total = 1.0, 0.0
    for o in range(octaves):
        c = cells * (2 ** o)
        grid = rng.random((c, c)).astype(np.float32)
        tiled = np.tile(grid, (3, 3))
        up = cv2.resize(tiled, (n * 3, n * 3), interpolation=cv2.INTER_CUBIC)[n:2 * n, n:2 * n]
        out += up * amp
        total += amp
        amp *= persistence
    out /= total
    return (out - out.min()) / (out.max() - out.min() + 1e-6)


def periodic_voronoi(n, count, jitter=0.85, aspect=1.0):
    """Distance-to-nearest / second-nearest seed on a torus. Returns (f1, f2, cell_id)."""
    g = int(np.sqrt(count))
    pts = []
    for i in range(g):
        for j in range(g):
            # rows offset like laid stones
            off = 0.5 if (i % 2) else 0.0
            pts.append(((j + off + (rng.random() - 0.5) * jitter * 0.6) / g, (i + 0.5 + (rng.random() - 0.5) * jitter * 0.5) / g))
    pts = np.array(pts) % 1.0
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32) / n
    f1 = np.full((n, n), 9.0, np.float32)
    f2 = np.full((n, n), 9.0, np.float32)
    cid = np.zeros((n, n), np.int32)
    for k, (px, py) in enumerate(pts):
        dx = np.abs(xs - px)
        dx = np.minimum(dx, 1 - dx)
        dy = np.abs(ys - py)
        dy = np.minimum(dy, 1 - dy) * aspect
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < f1
        f2 = np.where(closer, f1, np.minimum(f2, d))
        cid = np.where(closer, k, cid)
        f1 = np.where(closer, d, f1)
    return f1, f2, cid, len(pts)


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny, nz = -dx * strength, dy * strength, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / l, ny / l, nz / l], -1)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


def save(out, name, arr):
    Image.fromarray(arr).save(out / name, optimize=True)
    print("wrote", name)


def cobbles(out):
    f1, f2, cid, k = periodic_voronoi(N, 15 * 15, aspect=1.25)
    edge = f2 - f1  # 0 at the grout lines
    stone = np.clip(edge * 70, 0, 1)
    dome = np.clip(1 - (f1 * 15) ** 2 * 0.6, 0, 1)
    detail = periodic_noise(N, 32, 4)
    height = stone * (0.55 + 0.45 * dome) + detail * 0.12 * stone

    # Per-stone colour: dark basalt greys with slight blue/brown variation.
    tone = rng.uniform(0.55, 1.0, k)[cid]
    hue = rng.uniform(-1, 1, k)[cid]
    base = np.stack([0.20 + hue * 0.02, np.full_like(hue, 0.21), 0.24 - hue * 0.02], -1) * tone[..., None]
    grime = periodic_noise(N, 8, 5)
    base *= (0.8 + 0.4 * grime)[..., None]
    base *= (0.7 + 0.3 * detail)[..., None]
    grout = np.array([0.07, 0.07, 0.075])
    alb = base * stone[..., None] + grout * (1 - stone[..., None])
    save(out, "cobble_albedo.jpg", (np.clip(alb, 0, 1) * 255).astype(np.uint8))
    save(out, "cobble_normal.png", normal_from_height(height, 9))
    # Wet: stone tops are polished/wet (low roughness), grout holds water (very low), worn spots vary.
    rough = 0.22 + 0.25 * detail * stone + 0.12 * (1 - dome) * stone
    rough = np.where(stone < 0.5, 0.08, rough)
    save(out, "cobble_rough.jpg", (np.clip(rough, 0, 1) * 255).astype(np.uint8))


def pavers(out):
    ys, xs = np.mgrid[0:N, 0:N].astype(np.float32) / N
    tiles = 4
    fx, fy = (xs * tiles) % 1, (ys * tiles) % 1
    gap = 0.018
    edge = np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy))
    slab = np.clip((edge - gap) / 0.01, 0, 1)
    ix, iy = (xs * tiles).astype(int), (ys * tiles).astype(int)
    tone = rng.uniform(0.8, 1.05, (tiles, tiles))[iy, ix]
    detail = periodic_noise(N, 24, 5)
    stains = periodic_noise(N, 6, 4)
    base = np.array([0.42, 0.40, 0.38]) * tone[..., None] * (0.75 + 0.35 * detail)[..., None] * (0.8 + 0.3 * stains)[..., None]
    alb = base * slab[..., None] + np.array([0.12, 0.12, 0.12]) * (1 - slab[..., None])
    height = slab * (0.9 + detail * 0.1) - (1 - np.clip(edge * 30, 0, 1)) * 0.2
    save(out, "paver_albedo.jpg", (np.clip(alb, 0, 1) * 255).astype(np.uint8))
    save(out, "paver_normal.png", normal_from_height(height, 6))
    rough = np.where(slab > 0.5, 0.3 + 0.35 * stains, 0.12)
    save(out, "paver_rough.jpg", (np.clip(rough, 0, 1) * 255).astype(np.uint8))


def plaster(out):
    big = periodic_noise(N, 4, 5, 0.55)
    mid = periodic_noise(N, 24, 4)
    fine = periodic_noise(N, 128, 2)
    # Light grey so engine tint keeps saturation; patches + streaks of weathering.
    streaks = cv2.resize(np.tile(periodic_noise(256, 32, 3)[:, :1], (1, 256)), (N, N))
    lum = 0.86 + 0.1 * (big - 0.5) + 0.05 * (mid - 0.5) - 0.06 * np.clip(streaks - 0.55, 0, 1) * 4
    save(out, "plaster_albedo.jpg", (np.clip(np.stack([lum] * 3, -1), 0, 1) * 255).astype(np.uint8))
    save(out, "plaster_normal.png", normal_from_height(mid * 0.6 + fine * 0.4 + big * 0.3, 3.5))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    cobbles(out)
    pavers(out)
    plaster(out)


if __name__ == "__main__":
    main()
