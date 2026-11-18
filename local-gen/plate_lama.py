"""Local clean-plate generation with LaMa (big-lama TorchScript).

Masks rectangular regions (given as fractions of the source image) and inpaints
them on the GPU. Writes indexed outputs beside the source image:

  source/N-<slug>-plate.png
  source/.N-<slug>-plate-request.json
  source/.N-<slug>-plate-mask.png
"""
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

MODEL = Path.home() / ".cache/image-blaster-local/models/big-lama.pt"


def next_index(directory: Path) -> int:
    idx = [int(m.group(1)) for p in directory.iterdir() if (m := re.match(r"^\.?(\d+)-", p.name))]
    return max(idx, default=-1) + 1


def build_mask(size, boxes, dilate):
    w, h = size
    mask = np.zeros((h, w), np.uint8)
    for b in boxes:
        x0, y0, x1, y1 = b["box"]
        mask[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)] = 255
    if dilate:
        mask = cv2.dilate(mask, np.ones((dilate, dilate), np.uint8))
    return mask


def inpaint(img: np.ndarray, mask: np.ndarray) -> np.ndarray:
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = torch.jit.load(str(MODEL), map_location=device).eval()
    h, w = mask.shape
    ph, pw = (8 - h % 8) % 8, (8 - w % 8) % 8
    im = np.pad(img, ((0, ph), (0, pw), (0, 0)), mode="symmetric")
    mk = np.pad(mask, ((0, ph), (0, pw)), mode="symmetric")
    im_t = torch.from_numpy(im).permute(2, 0, 1)[None].float().div(255).to(device)
    mk_t = (torch.from_numpy(mk)[None, None].float().div(255) > 0).float().to(device)
    with torch.inference_mode():
        out = model(im_t, mk_t)[0].permute(1, 2, 0).cpu().numpy()
    return np.clip(out * 255, 0, 255).astype(np.uint8)[:h, :w]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", required=True)
    ap.add_argument("--world", required=True)
    ap.add_argument("--input", required=True, help="path relative to repo root")
    ap.add_argument("--regions", required=True, help="JSON file: [{label, box:[x0,y0,x1,y1] fractions}]")
    ap.add_argument("--slug", required=True, help="output family slug, e.g. <world>-plate")
    ap.add_argument("--dilate", type=int, default=15)
    a = ap.parse_args()

    root = Path(a.repo_root)
    src = root / a.input
    out_dir = src.parent
    regions = json.loads(Path(a.regions).read_text())

    img = Image.open(src).convert("RGB")
    mask = build_mask(img.size, regions, a.dilate)
    result = inpaint(np.array(img), mask)

    n = next_index(out_dir)
    out = out_dir / f"{n}-{a.slug}.png"
    Image.fromarray(result).save(out)
    Image.fromarray(mask).save(out_dir / f".{n}-{a.slug}-mask.png")
    req = {
        "schema_version": 1,
        "provider": "local",
        "model": "big-lama (LaMa inpainting, TorchScript)",
        "role": "plate",
        "world": a.world,
        "input_images": [a.input],
        "removed": [r["label"] for r in regions],
        "regions": regions,
        "dilate_px": a.dilate,
        "output": str(out.relative_to(root)),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (out_dir / f".{n}-{a.slug}-request.json").write_text(json.dumps(req, indent=2) + "\n")
    print(json.dumps({"output": req["output"], "index": n}, indent=2))


if __name__ == "__main__":
    main()
