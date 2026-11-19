"""Generate seamless PBR-ish colour textures locally on the GPU for built room parts.

SD-Turbo (Hugging Face, fp16) with circular conv padding -> tileable 512 px, then
Real-ESRGAN x4 with wrap padding (stays seamless) -> downsampled to 1024 px JPEG.

  python tex_gen.py --out app/public/game/textures [--only plaster,wood]
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from upscale_esrgan import MODELS, upscale

MODEL_ID = "stabilityai/sd-turbo"
TEXTURES = {
    "plaster": "seamless texture, weathered terracotta red painted plaster wall, chipped paint, cracks, grime, flat lighting, top-down photo, high detail",
    "wood": "seamless texture, old dark brown wooden planks, vertical boards, worn varnish, scratches, nails, flat lighting, top-down photo, high detail",
    "door": "seamless texture, aged dark oak wood grain, rich brown, scuffed, flat lighting, top-down photo, high detail",
    "sandbag": "seamless texture, coarse beige burlap hessian fabric weave, dusty, flat lighting, macro photo, high detail",
    "crate": "seamless texture, light pine wood crate boards, horizontal planks, rough sawn, stencil marks, flat lighting, top-down photo",
    "rust": "seamless texture, olive green painted steel with heavy rust patches and scratches, flat lighting, top-down photo, high detail",
}


def make_seamless(pipe):
    for module in (pipe.unet, pipe.vae):
        for m in module.modules():
            if isinstance(m, torch.nn.Conv2d):
                m.padding_mode = "circular"


@torch.inference_mode()
def upscale_wrapped(model, img: np.ndarray, pad=32) -> np.ndarray:
    big = np.pad(img, ((pad, pad), (pad, pad), (0, 0)), mode="wrap")
    up = upscale(model, big)
    s = model.scale
    return up[pad * s: -pad * s, pad * s: -pad * s]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--size", type=int, default=1024)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    names = [n for n in TEXTURES if not a.only or n in a.only.split(",")]

    from diffusers import AutoPipelineForText2Image
    pipe = AutoPipelineForText2Image.from_pretrained(MODEL_ID, torch_dtype=torch.float16, variant="fp16").to("cuda")
    pipe.set_progress_bar_config(disable=True)
    make_seamless(pipe)
    images = {}
    for i, name in enumerate(names):
        g = torch.Generator("cuda").manual_seed(a.seed + i)
        images[name] = np.array(pipe(TEXTURES[name], num_inference_steps=4, guidance_scale=0.0, width=512, height=512, generator=g).images[0])
        print("generated", name, flush=True)
    del pipe
    torch.cuda.empty_cache()

    from spandrel import ModelLoader
    model = ModelLoader().load_from_file(MODELS / "RealESRGAN_x4plus.pth").model.cuda().half().eval()
    for name, img in images.items():
        up = upscale_wrapped(model, img)
        Image.fromarray(up).resize((a.size, a.size), Image.LANCZOS).save(out / f"{name}.jpg", quality=88)
        (out / f".{name}-request.json").write_text(json.dumps({
            "provider": "local", "model": MODEL_ID, "upscaler": "RealESRGAN_x4plus", "prompt": TEXTURES[name],
            "seed": a.seed + names.index(name), "seamless": True, "size": a.size,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }, indent=2) + "\n")
        print("wrote", out / f"{name}.jpg", flush=True)


if __name__ == "__main__":
    main()
