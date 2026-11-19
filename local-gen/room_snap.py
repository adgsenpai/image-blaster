"""Snap room props flush onto the scanned room surfaces using the World Labs collider mesh.

Usage: room_snap.py <world-dir> <game.json> [more game.json copies...]

Reads arena.room.props from the first game.json, where every prop may carry a `snap` hint:
  {"snap": "wall", "hint": [x, z]}            nearest wall around the hint, feet on the floor (machines)
  {"snap": "view", "hint": [x, y, z]}         the wall the photo camera sees in that direction (signs, boards)
and writes `at` / `rotY` back to every given game.json. Room space = viewer room space
(flip Y/Z, metric scale, ground offset; photo camera at origin looking down -z).
"""
import json
import sys
from pathlib import Path

import numpy as np
import trimesh

wdir = Path(sys.argv[1])
cfgs = [Path(p) for p in sys.argv[2:]]
sem = json.loads((wdir / "output/world/0-world.json").read_text())["assets"]["splats"]["semantics_metadata"]
mesh = trimesh.load(wdir / "output/world/0-world.glb", force="mesh")
v = mesh.vertices.copy()
v[:, 1] *= -1
v[:, 2] *= -1
v *= sem["metric_scale_factor"]
v[:, 1] += sem["ground_plane_offset"]
mesh = trimesh.Trimesh(v, mesh.faces[:, ::-1], process=False)
import torch  # noqa: E402

dev = "cuda" if torch.cuda.is_available() else "cpu"
T = torch.tensor(mesh.triangles, dtype=torch.float32, device=dev)
V0, E1, E2 = T[:, 0], T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]


def cast(origins, dirs):
    """Nearest-hit Moller-Trumbore on the GPU. Returns (hit points, ray indices, triangle indices)."""
    O = torch.tensor(np.asarray(origins, float), dtype=torch.float32, device=dev)
    D = torch.tensor(np.asarray(dirs, float), dtype=torch.float32, device=dev)
    locs, rays, tris = [], [], []
    for i in range(len(O)):
        o, d = O[i], D[i]
        p = torch.cross(d.expand_as(E2), E2, dim=1)
        det = (E1 * p).sum(1)
        inv = 1.0 / torch.where(det.abs() < 1e-9, torch.full_like(det, 1e-9), det)
        tv = o - V0
        u = (tv * p).sum(1) * inv
        q = torch.cross(tv, E1, dim=1)
        w = (d * q).sum(1) * inv
        t = (E2 * q).sum(1) * inv
        ok = (det.abs() > 1e-9) & (u >= 0) & (w >= 0) & (u + w <= 1) & (t > 1e-4)
        if ok.any():
            tt = torch.where(ok, t, torch.full_like(t, 1e9))
            k = int(torch.argmin(tt))
            locs.append((o + d * tt[k]).cpu().numpy())
            rays.append(i)
            tris.append(k)
    return np.array(locs).reshape(-1, 3), np.array(rays, int), np.array(tris, int)


def floor_at(x, z, y_from=1.5):
    loc, _, _ = cast([[x, y_from, z]], [[0, -1, 0]])
    return float(loc[0][1]) if len(loc) else 0.0


def facing(normal, toward):
    n = np.array([normal[0], 0.0, normal[2]])
    n /= np.linalg.norm(n) + 1e-9
    if np.dot(n, toward) < 0:
        n = -n
    return n


def snap_wall(x, z, depth, y=1.0):
    angs = np.radians(np.arange(0, 360, 2.5))
    dirs = np.stack([np.sin(angs), np.zeros_like(angs), -np.cos(angs)], 1)
    org = np.repeat([[x, y, z]], len(dirs), 0)
    loc, ir, it = cast(org, dirs)
    d = np.linalg.norm(loc - org[ir], axis=1)
    k = int(np.argmin(d))
    hit, back = loc[k], dirs[ir[k]]
    n = facing(mesh.face_normals[it[k]], -back)
    p = hit + n * (depth / 2 + 0.02)
    fy = floor_at(p[0], p[2])
    fy = fy if abs(fy) < 0.15 else 0.0  # a hit above the floor is furniture, not floor
    return [round(float(p[0]), 3), round(fy, 3), round(float(p[2]), 3)], round(float(np.arctan2(n[0], n[2])), 4), float(d[k])


def snap_view(x, y, z, depth):
    d = np.array([x, 0.0, z])
    d /= np.linalg.norm(d)
    loc, _, it = cast([[0, y, 0]], [d])
    if not len(loc):
        return None
    n = facing(mesh.face_normals[it[0]], -d)
    p = loc[0] + n * (depth / 2 + 0.03)
    return [round(float(p[0]), 3), round(float(y), 3), round(float(p[2]), 3)], round(float(np.arctan2(n[0], n[2])), 4)


data = json.loads(cfgs[0].read_text())
props = data["arena"]["room"]["props"]
report = []
for m in props.get("machines", []):
    if m.get("snap") == "manual":
        continue
    hx, hz = m.get("hint", [m["at"][0], m["at"][2]])
    m["hint"], m["snap"] = [hx, hz], "wall"
    m["at"], m["rotY"], dist = snap_wall(hx, hz, 0.72)
    report.append((m["perk"], m["at"], m["rotY"], round(dist, 2)))
for key in ("sign", "board"):
    s = props.get(key)
    if not s or s.get("snap") == "manual":
        continue
    hint = s.get("hint", s["at"])
    s["hint"], s["snap"] = hint, "view"
    r = snap_view(*hint, 0.05)
    if r:
        s["at"], s["rotY"] = r
    report.append((key, s["at"], s.get("rotY")))
for c in cfgs:
    d = json.loads(c.read_text())
    d["arena"]["room"]["props"] = props
    c.write_text(json.dumps(d, indent=2) + "\n")
for r in report:
    print(r)
