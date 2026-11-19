"""Generate one 3D asset locally from a prompt and/or a screen capture (room editor "generate").

  text only:   SD-Turbo text->image (single object, plain background)
  with image:  Real-ESRGAN sharpen -> SD-Turbo img2img guided by the prompt (cleans blurry scan captures)
  then:        BiRefNet cutout -> Stable Fast 3D -> worlds/<world>/output/<id>/N-<id>.glb (+ request sidecars)

Prints JSON progress lines; the last line is {"glb": "/worlds/...glb"}.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

import object_sf3d as o3d  # noqa: F401  (patches the texture baker, sets up sf3d imports)
from object_sf3d import SF3D, esrgan, next_index, now, rembg, resize_foreground

SD = "stabilityai/sd-turbo"


def log(**kw):
    print(json.dumps(kw), flush=True)


def reference(prompt: str, image: Path | None, strength: float, seed: int) -> Image.Image:
    from diffusers import AutoPipelineForImage2Image, AutoPipelineForText2Image

    g = torch.Generator("cuda").manual_seed(seed)
    full = f"{prompt}, single object, whole object in view, centered, plain light grey background, studio product photo, sharp, detailed"
    if image is None:
        pipe = AutoPipelineForText2Image.from_pretrained(SD, torch_dtype=torch.float16, variant="fp16").to("cuda")
        pipe.set_progress_bar_config(disable=True)
        out = pipe(full, num_inference_steps=4, guidance_scale=0.0, width=512, height=512, generator=g).images[0]
    else:
        src = Image.open(image).convert("RGB")
        if max(src.size) < 512:
            src = esrgan(src)
        side = 512
        src = src.resize((side, round(side * src.height / src.width) // 8 * 8) if src.width >= src.height
                         else (round(side * src.width / src.height) // 8 * 8, side), Image.LANCZOS)
        if strength <= 0:
            return src
        pipe = AutoPipelineForImage2Image.from_pretrained(SD, torch_dtype=torch.float16, variant="fp16").to("cuda")
        pipe.set_progress_bar_config(disable=True)
        steps = max(2, int(round(2 / max(strength, 0.25))))  # turbo: steps * strength >= 1
        out = pipe(full, image=src, num_inference_steps=steps, strength=strength, guidance_scale=0.0, generator=g).images[0]
    del pipe
    torch.cuda.empty_cache()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", required=True)
    ap.add_argument("--world", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--prompt", default="")
    ap.add_argument("--image", help="capture PNG (absolute or repo-relative)")
    ap.add_argument("--strength", type=float, default=0.5, help="img2img strength (0 = use the capture as-is)")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()

    root = Path(a.repo_root)
    out_dir = root / "worlds" / a.world / "output" / a.id
    out_dir.mkdir(parents=True, exist_ok=True)
    n = next_index(out_dir, a.id)
    image = Path(a.image) if a.image else None
    if image and not image.is_absolute():
        image = root / image

    t0 = time.time()
    log(stage="reference", detail="SD-Turbo" + (" img2img" if image else " text-to-image"))
    ref = reference(a.prompt or a.id.replace("-", " "), image, a.strength, a.seed)
    log(stage="cutout")
    cut = rembg.remove(ref, session=rembg.new_session("birefnet-general"))
    o3d._ESRGAN = None
    torch.cuda.empty_cache()
    ref_img = resize_foreground(cut, 0.85)
    ref_path = out_dir / f"{n}-{a.id}.png"
    ref_img.save(ref_path)
    (out_dir / f".{n}-{a.id}-image-request.json").write_text(json.dumps({
        "schema_version": 1, "provider": "local", "scope": "image", "model": f"{SD} + rembg birefnet-general",
        "prompt": a.prompt, "input_image": str(image) if image else None, "strength": a.strength if image else None,
        "seed": a.seed, "output": str(ref_path.relative_to(root)), "created_at": now(),
    }, indent=2) + "\n")

    # Stable Fast 3D in a fresh process so SD-Turbo's VRAM is fully released (8 GB card + browser).
    del ref, cut
    torch.cuda.empty_cache()
    env = {**os.environ, "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True"}
    glb = out_dir / f"{n}-{a.id}.glb"
    for res in (1024, 512):
        log(stage="3d", detail=f"Stable Fast 3D (texture {res})")
        r = subprocess.run([sys.executable, __file__, "--sf3d", str(ref_path), "--out", str(glb), "--res", str(res)], env=env)
        if r.returncode == 0 and glb.exists():
            break
    else:
        raise SystemExit("Stable Fast 3D failed (GPU memory?)")
    (out_dir / f".{n}-{a.id}-model-request.json").write_text(json.dumps({
        "schema_version": 1, "provider": "local", "scope": "model", "model": "stabilityai/stable-fast-3d",
        "input_image": str(ref_path.relative_to(root)), "output": str(glb.relative_to(root)),
        "texture_resolution": res, "seconds": round(time.time() - t0, 1), "created_at": now(),
    }, indent=2) + "\n")
    _ = np  # keep numpy import for PIL<->torch helpers used by sf3d
    log(glb=f"/{glb.relative_to(root).as_posix()}", seconds=round(time.time() - t0, 1))


def sf3d_only(ref: str, out: str, res: int):
    model = SF3D.from_pretrained("stabilityai/stable-fast-3d", config_name="config.yaml", weight_name="model.safetensors")
    model.to("cuda").eval()
    with torch.no_grad(), torch.autocast(device_type="cuda", dtype=torch.bfloat16):
        mesh, _ = model.run_image(Image.open(ref), bake_resolution=res, remesh="none", vertex_count=-1)
    mesh.export(out, include_normals=True)


if __name__ == "__main__":
    if "--sf3d" in sys.argv:
        i = sys.argv.index
        sf3d_only(sys.argv[i("--sf3d") + 1], sys.argv[i("--out") + 1], int(sys.argv[i("--res") + 1]))
    else:
        main()
