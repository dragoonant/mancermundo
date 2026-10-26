"""Concept images from Hugging Face inference providers (test against Gemini, 2026-10-18).

Reads the token from %USERPROFILE%\\.hf_token or HF_TOKEN (never from the repo). Prompts come from a JSON list
[{"slug": ..., "prompt": ...}]; every image goes to <out>/<slug>[-<n>].png with a sidecar .txt holding the prompt,
model and provider, and a contact sheet <out>/contact-sheet.png is written at the end.

Usage: python tools/art/hf-concepts.py prompts.json --out art/unit-concepts/hf-test [--model black-forest-labs/FLUX.1-dev]
       [--provider auto] [--n 1] [--size 1024] [--seed 7]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from huggingface_hub import InferenceClient
from PIL import Image, ImageDraw


def token() -> str:
    t = os.environ.get("HF_TOKEN")
    if not t:
        p = Path(os.path.expanduser("~")) / ".hf_token"
        if p.exists():
            t = p.read_text(encoding="utf-8").strip()
    if not t:
        sys.exit("no token: set HF_TOKEN or write it to ~/.hf_token")
    return t


def contact_sheet(paths: list[Path], out: Path, cols: int = 5, cell: int = 384) -> None:
    rows = (len(paths) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 24)), "white")
    d = ImageDraw.Draw(sheet)
    for i, p in enumerate(paths):
        im = Image.open(p).convert("RGB")
        im.thumbnail((cell, cell))
        x, y = (i % cols) * cell, (i // cols) * (cell + 24)
        sheet.paste(im, (x + (cell - im.width) // 2, y))
        d.text((x + 4, y + cell + 4), p.stem, fill="black")
    sheet.save(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("prompts")
    ap.add_argument("--out", default="art/unit-concepts/hf-test")
    ap.add_argument("--model", default="black-forest-labs/FLUX.1-dev")
    ap.add_argument("--provider", default="auto")
    ap.add_argument("--n", type=int, default=1, help="images per prompt")
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--only", help="comma-separated slugs")
    args = ap.parse_args()
    client = InferenceClient(provider=args.provider, api_key=token())
    items = json.loads(Path(args.prompts).read_text(encoding="utf-8"))
    if args.only:
        keep = set(args.only.split(","))
        items = [it for it in items if it["slug"] in keep]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    done: list[Path] = []
    for it in items:
        for k in range(args.n):
            name = it["slug"] if args.n == 1 else f"{it['slug']}-{k + 1}"
            dst = out / f"{name}.png"
            t0 = time.time()
            try:
                img = client.text_to_image(it["prompt"], model=args.model, width=args.size, height=args.size, seed=args.seed + k)
            except Exception as e:  # noqa: BLE001
                print(f"FAIL {name}: {str(e)[:300]}")
                continue
            img.save(dst)
            (out / f"{name}.txt").write_text(f"model: {args.model}\nprovider: {args.provider}\nseed: {args.seed + k}\nprompt: {it['prompt']}\n", encoding="utf-8")
            done.append(dst)
            print(f"ok {name} {img.width}x{img.height} {time.time() - t0:.1f}s")
    if done:
        contact_sheet(done, out / "contact-sheet.png")
        print("sheet", out / "contact-sheet.png", len(done), "images")
    return 0 if done else 1


if __name__ == "__main__":
    sys.exit(main())
