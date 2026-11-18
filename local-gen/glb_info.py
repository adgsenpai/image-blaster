"""Print a GLB's animations, skins/bones, meshes and bounds (reads the JSON chunk only)."""
import json
import struct
import sys


def main(path):
    data = open(path, "rb").read()
    magic, version, length = struct.unpack("<III", data[:12])
    assert magic == 0x46546C67, "not a GLB"
    clen, ctype = struct.unpack("<II", data[12:20])
    j = json.loads(data[20:20 + clen])
    nodes = j.get("nodes", [])
    print("generator:", j.get("asset", {}).get("generator"))
    print("meshes:", len(j.get("meshes", [])), "materials:", [m.get("name") for m in j.get("materials", [])][:12])
    print("textures:", len(j.get("textures", [])), "images:", len(j.get("images", [])))
    for a in j.get("animations", []):
        print("anim:", a.get("name"), "channels:", len(a.get("channels", [])))
    for s in j.get("skins", []):
        names = [nodes[i].get("name") for i in s.get("joints", [])]
        print("skin joints:", len(names))
        print("  ", names)
    mins, maxs = [], []
    for m in j.get("meshes", []):
        for p in m.get("primitives", []):
            acc = j["accessors"][p["attributes"]["POSITION"]]
            mins.append(acc.get("min"))
            maxs.append(acc.get("max"))
    print("position bounds min:", mins[:3], "max:", maxs[:3])


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print("==", p)
        main(p)
