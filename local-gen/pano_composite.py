"""Composite the sharp source photo back into the World Labs panorama.

World Labs' pano is a generated 360 view; the original photo (or its HD plate)
is sharper and has the real skyline. This finds where the photo sits in the pano
(yaw / pitch / horizontal FOV, by NCC on edge maps over a coarse-to-fine grid)
and paints it in with a feathered border, giving an HD backdrop for the arena walls.

Equirect convention matches ArenaWalls' shader / three.js:
  u = atan2(d.z, d.x) / 2pi + 0.5,  v = asin(d.y) / pi + 0.5,  row = (1 - v) * H
"""
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def next_index(directory: Path) -> int:
    idx = [int(m.group(1)) for p in directory.iterdir() if (m := re.match(r"^\.?(\d+)-", p.name))]
    return max(idx, default=-1) + 1


def cam_basis(yaw, pitch):
    """Camera looking along yaw (0 = -Z) and pitch (up +)."""
    f = np.array([-np.sin(yaw) * np.cos(pitch), np.sin(pitch), -np.cos(yaw) * np.cos(pitch)])
    r = np.array([np.cos(yaw), 0.0, -np.sin(yaw)])
    u = np.cross(r, f)
    return f, r, u


def dirs_to_pano(d, W, H):
    u = np.arctan2(d[..., 2], d[..., 0]) / (2 * np.pi) + 0.5
    v = np.arcsin(np.clip(d[..., 1], -1, 1)) / np.pi + 0.5
    return (u * W) % W, (1 - v) * H


def render_persp(pano, yaw, pitch, fov_h, w, h):
    H, W = pano.shape[:2]
    f, r, up = cam_basis(yaw, pitch)
    tx = np.tan(fov_h / 2)
    ty = tx * h / w
    xs = (np.arange(w) + 0.5) / w * 2 - 1
    ys = 1 - (np.arange(h) + 0.5) / h * 2
    X, Y = np.meshgrid(xs * tx, ys * ty)
    d = f[None, None] + X[..., None] * r[None, None] + Y[..., None] * up[None, None]
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    px, py = dirs_to_pano(d, W, H)
    return cv2.remap(pano, px.astype(np.float32), py.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


def edges(img):
    g = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY).astype(np.float32)
    g = cv2.GaussianBlur(g, (0, 0), 1.0)
    m = cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1))
    return (m - m.mean()) / (m.std() + 1e-6)


def score(pano_small, photo_e, yaw, pitch, fov, w, h):
    view = edges(render_persp(pano_small, yaw, pitch, fov, w, h))
    return float((view * photo_e).mean())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", required=True)
    ap.add_argument("--pano", required=True, help="HD pano to paint into (relative to repo root)")
    ap.add_argument("--match-pano", help="pano used for matching (defaults to --pano)")
    ap.add_argument("--photo", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--slug", default="pano-hd-composite")
    ap.add_argument("--feather", type=float, default=0.08, help="border feather as a fraction of the photo")
    a = ap.parse_args()

    root = Path(a.repo_root)
    pano = np.array(Image.open(root / a.pano).convert("RGB"))
    match = np.array(Image.open(root / (a.match_pano or a.pano)).convert("RGB"))
    photo = np.array(Image.open(root / a.photo).convert("RGB"))

    # Coarse-to-fine search on small images.
    w = 192
    h = round(w * photo.shape[0] / photo.shape[1])
    small = cv2.resize(match, (1024, 512), interpolation=cv2.INTER_AREA)
    pe = edges(cv2.resize(photo, (w, h), interpolation=cv2.INTER_AREA))
    best = (-1e9, 0.0, 0.0, np.radians(70))
    for fov in np.radians(np.arange(40, 101, 6)):
        for yaw in np.radians(np.arange(-180, 180, 6)):
            for pitch in np.radians(np.arange(-15, 16, 5)):
                s = score(small, pe, yaw, pitch, fov, w, h)
                if s > best[0]:
                    best = (s, yaw, pitch, fov)
    for step in (2.0, 0.6, 0.2):
        s0, y0, p0, f0 = best
        st = np.radians(step)
        for df in (-st, 0, st):
            for dy in (-st, 0, st):
                for dp in (-st, 0, st):
                    s = score(small, pe, y0 + dy, p0 + dp, f0 + df * 2, w, h)
                    if s > best[0]:
                        best = (s, y0 + dy, p0 + dp, f0 + df * 2)
    s, yaw, pitch, fov = best
    print(json.dumps({"ncc": round(s, 3), "yaw_deg": round(np.degrees(yaw), 2),
                      "pitch_deg": round(np.degrees(pitch), 2), "fov_deg": round(np.degrees(fov), 2)}), flush=True)

    # Paint the photo into the HD pano: for every pano pixel inside the photo frustum.
    H, W = pano.shape[:2]
    f, r, up = cam_basis(yaw, pitch)
    tx = np.tan(fov / 2)
    ty = tx * photo.shape[0] / photo.shape[1]
    out = pano.astype(np.float32)
    rows = np.arange(H)
    lat = (0.5 - (rows + 0.5) / H) * np.pi
    chunk = 256
    for c0 in range(0, H, chunk):
        la = lat[c0:c0 + chunk][:, None]
        lon = ((np.arange(W) + 0.5) / W - 0.5) * 2 * np.pi
        d = np.stack([np.cos(la) * np.cos(lon), np.sin(la) * np.ones_like(lon), np.cos(la) * np.sin(lon)], -1)
        z = d @ f
        x = (d @ r) / np.maximum(z, 1e-6) / tx
        y = (d @ up) / np.maximum(z, 1e-6) / ty
        inside = (z > 0) & (np.abs(x) < 1) & (np.abs(y) < 1)
        if not inside.any():
            continue
        px = ((x + 1) / 2 * photo.shape[1]).astype(np.float32)
        py = ((1 - y) / 2 * photo.shape[0]).astype(np.float32)
        sample = cv2.remap(photo, px, py, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT).astype(np.float32)
        edge = np.minimum(1 - np.abs(x), 1 - np.abs(y))
        alpha = np.clip(edge / a.feather, 0, 1) * inside
        alpha = alpha * alpha * (3 - 2 * alpha)
        out[c0:c0 + chunk] = out[c0:c0 + chunk] * (1 - alpha[..., None]) + sample * alpha[..., None]

    out_dir = root / a.out_dir
    n = next_index(out_dir)
    path = out_dir / f"{n}-{a.slug}.jpg"
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(path, quality=92)
    (out_dir / f".{n}-{a.slug}-request.json").write_text(json.dumps({
        "schema_version": 1, "provider": "local", "role": "pano-composite",
        "pano": a.pano, "match_pano": a.match_pano or a.pano, "photo": a.photo,
        "fit": {"yaw_deg": float(np.degrees(yaw)), "pitch_deg": float(np.degrees(pitch)),
                "fov_deg": float(np.degrees(fov)), "ncc": s},
        "output": str(path.relative_to(root)), "created_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2) + "\n")
    print(json.dumps({"output": str(path.relative_to(root)), "size": [W, H]}))


if __name__ == "__main__":
    main()
