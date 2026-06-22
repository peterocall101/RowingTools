#!/usr/bin/env python3
"""
normalize_slides.py - make a folder of screenshots all the same shape for an
Instagram carousel (every slide must share one aspect ratio or IG crops them).

Each image is placed on a uniform canvas (default 1080x1350, the 4:5 portrait
that matches the Rowing.Tools cover) on a brand-dark background.

  - default ("contain"): the whole image is shown, centred, letterboxed on the
    dark background - nothing is cut. Best when your shots are different shapes.
  - --fill ("cover"): the image is scaled to fill the canvas and the overflow is
    cropped - no bars, but edges may be trimmed.

Usage:
    pip install pillow            # already installed here
    python normalize_slides.py "C:\\path\\to\\your\\insta\\folder"
    python normalize_slides.py "<folder>" --fill          # crop-to-fill instead
    python normalize_slides.py "<folder>" --square        # 1080x1080 instead of 4:5

Output: a subfolder "<folder>/instagram/" with one PNG per source image
(same filename), all exactly the target size. Drop those into the IG post in
filename order.
"""
import argparse
from pathlib import Path
from PIL import Image

EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def bg_rgb(hexstr):
    h = hexstr.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def normalize(img, W, H, bg, fill):
    img = img.convert("RGB")
    iw, ih = img.size
    canvas = Image.new("RGB", (W, H), bg)
    if fill:  # cover: scale to fill, crop overflow
        scale = max(W / iw, H / ih)
        nw, nh = round(iw * scale), round(ih * scale)
        img = img.resize((nw, nh), Image.LANCZOS)
        canvas.paste(img, ((W - nw) // 2, (H - nh) // 2))
    else:     # contain: scale to fit, letterbox
        scale = min(W / iw, H / ih)
        nw, nh = round(iw * scale), round(ih * scale)
        img = img.resize((nw, nh), Image.LANCZOS)
        canvas.paste(img, ((W - nw) // 2, (H - nh) // 2))
    return canvas


def main():
    ap = argparse.ArgumentParser(description="Normalise images to one Instagram shape.")
    ap.add_argument("folder", nargs="?", default=".", help="folder of source images")
    ap.add_argument("--square", action="store_true", help="1080x1080 instead of 1080x1350")
    ap.add_argument("--fill", action="store_true", help="crop-to-fill instead of letterbox")
    ap.add_argument("--bg", default="#0f0f0e", help="background hex (default #0f0f0e)")
    ap.add_argument("--width", type=int, default=None)
    ap.add_argument("--height", type=int, default=None)
    args = ap.parse_args()

    W = args.width or 1080
    H = args.height or (1080 if args.square else 1350)
    bg = bg_rgb(args.bg)

    src = Path(args.folder)
    if not src.is_dir():
        print(f"Not a folder: {src.resolve()}")
        return
    out = src / "instagram"
    out.mkdir(exist_ok=True)

    imgs = sorted(p for p in src.iterdir() if p.suffix.lower() in EXTS and p.is_file())
    if not imgs:
        print(f"No images found in {src.resolve()}")
        return

    print(f"Target: {W}x{H}  mode: {'fill (crop)' if args.fill else 'contain (letterbox)'}")
    for p in imgs:
        with Image.open(p) as im:
            print(f"  {p.name:<32} {im.size[0]}x{im.size[1]} -> {W}x{H}")
            normalize(im, W, H, bg, args.fill).save(out / (p.stem + ".png"))
    print(f"\nDone. {len(imgs)} slides written to {out.resolve()}")


if __name__ == "__main__":
    main()
