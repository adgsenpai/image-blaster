"""Build a sky mask for an equirect panorama (1 = sky, 0 = buildings / ground).

Per column, the sky is the region connected to the top of the image that stays
dark and unsaturated; the first sustained run of bright or saturated pixels
(lit facades, windows, lamps) marks the skyline. The cut is smoothed across
columns, eroded slightly so no rooftop edges leak in, then feathered.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", required=True)
    ap.add_argument("--pano", required=True)
    ap.add_argument("--out", required=True, help="output png, relative to repo root")
    ap.add_argument("--width", type=int, default=2048)
    ap.add_argument("--max-sat", type=float, default=0.42)
    ap.add_argument("--max-val", type=float, default=0.5)
    ap.add_argument("--min-elev", type=float, default=2.0, help="never treat below this elevation (deg) as sky")
    a = ap.parse_args()
    root = Path(a.repo_root)
    img = Image.open(root / a.pano).convert("RGB")
    W, H = a.width, a.width // 2
    rgb = np.asarray(img.resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    sat, val = hsv[..., 1], hsv[..., 2]
    # Local contrast: buildings have edges, sky is smooth.
    gray = cv2.GaussianBlur(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), (0, 0), 1.2)
    edge = cv2.magnitude(cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1))
    edge = cv2.GaussianBlur(edge, (0, 0), 3)
    band = slice(int(H * 0.05), int(H * 0.3))
    print(json.dumps({"upper_band_p50_p90": {
        "sat": [round(float(np.percentile(sat[band], q)), 3) for q in (50, 90)],
        "val": [round(float(np.percentile(val[band], q)), 3) for q in (50, 90)],
        "edge": [round(float(np.percentile(edge[band], q)), 3) for q in (50, 90)],
    }}))
    edge_max = float(np.percentile(edge[band], 90)) * 1.5
    chroma = rgb.max(-1) - rgb.min(-1)  # stable in the dark, unlike HSV saturation
    # Thin vertical structures (poles, trunks) are dark like the night sky but keep a
    # horizontal gradient over many rows; average |d/dx| vertically to find them.
    gx = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
    vstruct = cv2.blur(gx, (1, 25))
    pole = vstruct > float(np.percentile(vstruct[band], 85)) * 2.5
    skyish = (chroma < a.max_sat * 0.3) & (val < a.max_val) & (edge < edge_max) & ~pole
    skyish = cv2.morphologyEx(skyish.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0

    horizon_row = int(H * (0.5 - np.radians(a.min_elev) / np.pi))
    cut = np.zeros(W, np.float32)
    run = 6  # consecutive non-sky rows that end the sky
    start = int(H * 0.1)  # ~72 deg up: always sky, skips the distorted zenith rows
    for x in range(W):
        col = skyish[start:horizon_row, x]
        bad = np.convolve((~col).astype(np.int32), np.ones(run, np.int32), "valid") >= run
        idx = np.argmax(bad) if bad.any() else horizon_row - start
        cut[x] = start + idx
    # Smooth the skyline (wrap-around), prefer the higher (safer) envelope.
    k = 16
    ext = np.concatenate([cut[-k:], cut, cut[:k]])
    mins = np.array([ext[i:i + 2 * k + 1].min() for i in range(W)])
    cut = cv2.GaussianBlur(mins.reshape(1, -1), (0, 0), 4).ravel() - 4

    rows = np.arange(H)[:, None]
    mask = np.clip((cut[None, :] - rows) / 10.0, 0, 1)
    mask[:start] = 1.0  # ~10 px feather above the skyline
    out = root / a.out
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray((mask * 255).astype(np.uint8)).save(out)
    elev = 90 - (cut + 0.5) / H * 180
    (out.parent / f".{out.stem}-request.json").write_text(json.dumps({
        "schema_version": 1, "provider": "local", "role": "sky-mask", "pano": a.pano, "output": a.out,
        "skyline_elev_deg": {"min": round(float(elev.min()), 1), "median": round(float(np.median(elev)), 1), "max": round(float(elev.max()), 1)},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2) + "\n")
    print(json.dumps({"output": a.out, "skyline_elev_deg_median": round(float(np.median(elev)), 1),
                      "skyline_elev_deg_range": [round(float(elev.min()), 1), round(float(elev.max()), 1)],
                      "sky_fraction_upper": round(float(mask[: H // 2].mean()), 3)}))


if __name__ == "__main__":
    main()
