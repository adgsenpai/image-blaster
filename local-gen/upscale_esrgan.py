"""Local tiled Real-ESRGAN upscale (via spandrel) for source images / plates.

Writes indexed outputs beside the input:
  N-<slug>.png
  .N-<slug>-request.json
"""
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from spandrel import ModelLoader

MODELS = Path.home() / ".cache/image-blaster-local/models"


def next_index(directory: Path) -> int:
    idx = [int(m.group(1)) for p in directory.iterdir() if (m := re.match(r"^\.?(\d+)-", p.name))]
    return max(idx, default=-1) + 1


@torch.inference_mode()
def upscale(model, img: np.ndarray, tile=384, overlap=32) -> np.ndarray:
    s = model.scale
    h, w, _ = img.shape
    x = torch.from_numpy(img).permute(2, 0, 1)[None].float().div(255).cuda().half()
    out = torch.zeros(1, 3, h * s, w * s, device="cuda", dtype=torch.half)
    weight = torch.zeros_like(out[:, :1])
    step = tile - overlap
    for y0 in range(0, h, step):
        for x0 in range(0, w, step):
            y1, x1 = min(y0 + tile, h), min(x0 + tile, w)
            ya, xa = max(0, y1 - tile), max(0, x1 - tile)
            t = model(x[:, :, ya:y1, xa:x1])
            out[:, :, ya * s:y1 * s, xa * s:x1 * s] += t
            weight[:, :, ya * s:y1 * s, xa * s:x1 * s] += 1
    out = (out / weight).clamp(0, 1)
    return (out[0].permute(1, 2, 0).float().cpu().numpy() * 255).round().astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", required=True)
    ap.add_argument("--input", required=True, help="relative to repo root")
    ap.add_argument("--slug", required=True)
    ap.add_argument("--model", default="RealESRGAN_x4plus.pth")
    ap.add_argument("--target-width", type=int, default=3344, help="downsample the x4 result to this width")
    a = ap.parse_args()

    root = Path(a.repo_root)
    src = root / a.input
    model = ModelLoader().load_from_file(MODELS / a.model).model.cuda().half().eval()
    img = np.array(Image.open(src).convert("RGB"))
    up = Image.fromarray(upscale(model, img))
    if a.target_width and up.width > a.target_width:
        up = up.resize((a.target_width, round(up.height * a.target_width / up.width)), Image.LANCZOS)

    n = next_index(src.parent)
    out = src.parent / f"{n}-{a.slug}.png"
    up.save(out)
    (src.parent / f".{n}-{a.slug}-request.json").write_text(json.dumps({
        "schema_version": 1, "provider": "local", "role": "upscale",
        "model": f"Real-ESRGAN ({a.model}) via spandrel, tiled fp16",
        "input_images": [a.input], "input_size": [img.shape[1], img.shape[0]],
        "output_size": list(up.size), "output": str(out.relative_to(root)),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }, indent=2) + "\n")
    print(json.dumps({"output": str(out.relative_to(root)), "size": up.size}))


if __name__ == "__main__":
    main()
