#!/usr/bin/env python3
"""Decode an in-page Gemini export bundle ({name: data-url PNG}) into PNG files.

usage: python tools/art/decode_bundle.py <bundle.json> <out_dir> [name=file ...]
Without name=file pairs every entry is written as <name>.png.
"""
import base64, json, os, sys

def main():
    bundle, out = sys.argv[1], sys.argv[2]
    pairs = dict(a.split("=", 1) for a in sys.argv[3:])
    with open(bundle, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    os.makedirs(out, exist_ok=True)
    for name, url in data.items():
        if pairs and name not in pairs:
            continue
        target = pairs.get(name, name)
        path = os.path.join(out, target if target.endswith(".png") else target + ".png")
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(url.split(",", 1)[1]))
        print("wrote", path)

if __name__ == "__main__":
    main()
