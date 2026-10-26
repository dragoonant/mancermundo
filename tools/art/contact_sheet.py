#!/usr/bin/env python3
"""Contact sheet of concept PNGs with the slug under each thumbnail.

usage: python tools/art/contact_sheet.py <out.png> [--cols N] [--thumb W] [--prefix goliath-] <dir|files...>
Each figure is cropped to its content box (white background removed) so the proportions read at the same scale.
"""
import os, sys
from PIL import Image, ImageDraw

def crop_fig(im, thresh=235):
    g = im.convert("L")
    mask = g.point(lambda v: 255 if v < thresh else 0)
    box = mask.getbbox()
    return im.crop(box) if box else im

def main():
    args = sys.argv[1:]
    out = args.pop(0)
    cols, thumb, prefix, files = 4, 360, "", []
    while args:
        a = args.pop(0)
        if a == "--cols": cols = int(args.pop(0))
        elif a == "--thumb": thumb = int(args.pop(0))
        elif a == "--prefix": prefix = args.pop(0)
        elif os.path.isdir(a):
            files += sorted(os.path.join(a, f) for f in os.listdir(a) if f.lower().endswith(".png") and f.startswith(prefix) and not f.startswith("contact"))
        else: files.append(a)
    cell_h = int(thumb * 0.9) + 28
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * thumb, rows * cell_h), "white")
    d = ImageDraw.Draw(sheet)
    for i, f in enumerate(files):
        im = crop_fig(Image.open(f).convert("RGB"))
        s = min((thumb - 16) / im.width, (cell_h - 36) / im.height)
        im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)
        x, y = (i % cols) * thumb, (i // cols) * cell_h
        sheet.paste(im, (x + (thumb - im.width) // 2, y + 4))
        d.text((x + 6, y + cell_h - 20), os.path.splitext(os.path.basename(f))[0], fill=(0, 0, 0))
    sheet.save(out)
    print("wrote", out, len(files), "figures")

if __name__ == "__main__":
    main()
