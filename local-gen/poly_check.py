"""List poly.pizza models with title, license and direct GLB url (CC0 filter optional)."""
import re
import sys
import urllib.request


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "image-blaster-asset-check"})
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")


def main(ids, only_cc0=True):
    for mid in ids:
        try:
            h = fetch(f"https://poly.pizza/m/{mid}")
        except Exception as e:  # noqa: BLE001
            print(mid, "error", e)
            continue
        m = re.search(r"\"Title\":\"([^\"]+)\"", h) or re.search(r"og:title\" content=\"([^\"]+)", h)
        a = re.search(r"\"Creator\":\{[^}]*\"Username\":\"([^\"]+)\"", h)
        title = (m.group(1) if m else "?") + " by " + (a.group(1) if a else "?")
        cc0 = "Public Domain (CC0)" in h
        glb = re.search(r"https://static\.poly\.pizza/[0-9a-f-]{36}\.glb", h)
        if only_cc0 and not cc0:
            continue
        print(f"{mid} | {title.strip()} | {'CC0' if cc0 else 'not-CC0'} | {glb.group(0) if glb else '-'}")


if __name__ == "__main__":
    main(sys.argv[1:])
