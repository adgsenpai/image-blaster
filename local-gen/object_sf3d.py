"""Local single-object 3D generation: crop -> BiRefNet cutout -> Stable Fast 3D.

Writes indexed outputs into worlds/<world>/output/<object-id>/ using the same
convention as generate-single-asset.mjs:

  N-<id>.png                      reference cutout (RGBA)
  N-<id>.glb                      textured mesh
  .N-<id>-image-request.json
  .N-<id>-model-request.json

Needs HF_TOKEN with access to stabilityai/stable-fast-3d.
"""
import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SF3D_DIR = Path.home() / ".cache/image-blaster-local/sf3d"
sys.path.insert(0, str(SF3D_DIR))

import rembg  # noqa: E402
import torch  # noqa: E402
from PIL import Image  # noqa: E402
from sf3d.system import SF3D  # noqa: E402
from sf3d.utils import resize_foreground  # noqa: E402


def _patch_cpu_texture_baker():
    """texture_baker built without nvcc only registers CPU kernels; SF3D passes
    CUDA tensors. Run bake ops on CPU and hand results back on the caller's device."""
    from texture_baker.baker import TextureBaker

    def rasterize(self, uv, face_indices, bake_resolution):
        out = torch.ops.texture_baker_cpp.rasterize(
            uv.detach().float().cpu(), face_indices.to(torch.int32).cpu(), bake_resolution
        )
        return out.to(uv.device)

    def interpolate(self, attr, rast, face_indices):
        out = torch.ops.texture_baker_cpp.interpolate(
            attr.detach().float().cpu(), face_indices.to(torch.int32).cpu(), rast.float().cpu()
        )
        return out.to(attr.device)

    TextureBaker.rasterize = rasterize
    TextureBaker.interpolate = interpolate


_patch_cpu_texture_baker()


def pending_reference(directory: Path, slug: str):
    """Latest reference PNG that has no mesh yet (from an interrupted run)."""
    pat = re.compile(rf"^(\d+)-{re.escape(slug)}\.png$")
    refs = sorted(((int(m.group(1)), p) for p in directory.iterdir() if (m := pat.match(p.name))), reverse=True)
    if refs and not (directory / f"{refs[0][0]}-{slug}.glb").exists():
        return refs[0]
    return None


def next_index(directory: Path, slug: str) -> int:
    pat = re.compile(rf"^\.?(\d+)-{re.escape(slug)}[.-]")
    idx = [int(m.group(1)) for p in directory.iterdir() if (m := pat.match(p.name))]
    return max(idx, default=-1) + 1


def now():
    return datetime.now(timezone.utc).isoformat()


_ESRGAN = None


def esrgan(c: Image.Image) -> Image.Image:
    """Real-ESRGAN x4 on a crop so small props get real edge/texture detail."""
    global _ESRGAN
    import numpy as np
    from spandrel import ModelLoader
    from upscale_esrgan import MODELS, upscale

    if _ESRGAN is None:
        _ESRGAN = ModelLoader().load_from_file(MODELS / "RealESRGAN_x4plus.pth").model.cuda().half().eval()
    return Image.fromarray(upscale(_ESRGAN, np.array(c.convert("RGB"))))


def crop(img: Image.Image, box, pad=0.12, min_side=1024, sharpen=True):
    w, h = img.size
    x0, y0, x1, y1 = box[0] * w, box[1] * h, box[2] * w, box[3] * h
    bw, bh = x1 - x0, y1 - y0
    x0, y0 = max(0, x0 - bw * pad), max(0, y0 - bh * pad)
    x1, y1 = min(w, x1 + bw * pad), min(h, y1 + bh * pad)
    c = img.crop((int(x0), int(y0), int(x1), int(y1)))
    if sharpen and max(c.size) < min_side:
        c = esrgan(c)
        if max(c.size) < min_side and max(c.size) * 4 <= 4096:
            c = esrgan(c)
    scale = min_side / max(c.size)
    if scale < 1:
        c = c.resize((round(c.width * scale), round(c.height * scale)), Image.LANCZOS)
        scale = 1
    if scale > 1:
        c = c.resize((round(c.width * scale), round(c.height * scale)), Image.LANCZOS)
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", required=True)
    ap.add_argument("--world", required=True)
    ap.add_argument("--image", required=True, help="scene image, relative to repo root")
    ap.add_argument("--jobs", required=True, help="JSON file: [{id, box:[x0,y0,x1,y1] fractions}]")
    ap.add_argument("--only", nargs="*", help="limit to these object ids")
    ap.add_argument("--texture-resolution", type=int, default=1024)
    ap.add_argument("--foreground-ratio", type=float, default=0.85)
    a = ap.parse_args()

    root = Path(a.repo_root)
    scene = Image.open(root / a.image).convert("RGB")
    jobs = json.loads(Path(a.jobs).read_text())
    if a.only:
        jobs = [j for j in jobs if j["id"] in a.only]

    # Phase 1: reference cutouts (ESRGAN on GPU, BiRefNet via onnxruntime on CPU).
    session = rembg.new_session("birefnet-general")
    prepared = []
    for job in jobs:
        oid = job["id"]
        out_dir = root / "worlds" / a.world / "output" / oid
        out_dir.mkdir(parents=True, exist_ok=True)
        pending = pending_reference(out_dir, oid)
        if pending:
            n, ref_path = pending
            prepared.append((oid, out_dir, n, Image.open(ref_path), ref_path))
            print(json.dumps({"id": oid, "reused_reference": str(ref_path.relative_to(root))}), flush=True)
            continue
        n = next_index(out_dir, oid)
        cut = rembg.remove(crop(scene, job["box"]), session=session)
        ref = resize_foreground(cut, a.foreground_ratio)
        ref_path = out_dir / f"{n}-{oid}.png"
        ref.save(ref_path)
        (out_dir / f".{n}-{oid}-image-request.json").write_text(json.dumps({
            "schema_version": 1, "provider": "local", "scope": "image",
            "model": "crop + Real-ESRGAN x4 + rembg birefnet-general", "world": a.world,
            "object_id": oid, "input_image": a.image, "box": job["box"],
            "output": str(ref_path.relative_to(root)), "created_at": now(),
        }, indent=2) + "\n")
        prepared.append((oid, out_dir, n, ref, ref_path))
        print(json.dumps({"id": oid, "reference": str(ref_path.relative_to(root))}), flush=True)

    # Free ESRGAN before loading SF3D so the 8GB card only holds one model.
    global _ESRGAN
    _ESRGAN = None
    del session
    torch.cuda.empty_cache()

    # Phase 2: Stable Fast 3D.
    model = SF3D.from_pretrained(
        "stabilityai/stable-fast-3d", config_name="config.yaml", weight_name="model.safetensors"
    )
    model.to("cuda").eval()

    results = []
    for oid, out_dir, n, ref, ref_path in prepared:
        t0 = time.time()
        torch.cuda.reset_peak_memory_stats()
        with torch.no_grad(), torch.autocast(device_type="cuda", dtype=torch.bfloat16):
            mesh, _ = model.run_image(
                ref, bake_resolution=a.texture_resolution, remesh="none", vertex_count=-1
            )
        glb = out_dir / f"{n}-{oid}.glb"
        mesh.export(glb, include_normals=True)
        peak = torch.cuda.max_memory_allocated() / 2**20
        (out_dir / f".{n}-{oid}-model-request.json").write_text(json.dumps({
            "schema_version": 1, "provider": "local", "scope": "model",
            "model": "stabilityai/stable-fast-3d", "world": a.world, "object_id": oid,
            "reference_image": str(ref_path.relative_to(root)),
            "texture_resolution": a.texture_resolution,
            "output": str(glb.relative_to(root)), "peak_vram_mb": round(peak),
            "seconds": round(time.time() - t0, 1), "created_at": now(),
        }, indent=2) + "\n")
        r = {"id": oid, "glb": str(glb.relative_to(root)), "peak_vram_mb": round(peak),
             "seconds": round(time.time() - t0, 1)}
        print(json.dumps(r), flush=True)
        results.append(r)
        torch.cuda.empty_cache()

    print(json.dumps({"done": len(results)}))


if __name__ == "__main__":
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    main()
