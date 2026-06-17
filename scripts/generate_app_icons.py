"""Generate PWA / TWA launcher icons from the RowingTools brand mark.

Recreates the favicon ("rt." on a navy rounded square) at the PNG sizes that
the web app manifest and Google Play (via Bubblewrap) need. Run with Pillow:

    python scripts/generate_app_icons.py

Outputs to ../icons/ : icon-192.png, icon-512.png, icon-maskable-512.png
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

NAVY = (26, 39, 68)      # #1a2744 background
CREAM = (245, 239, 230)  # #f5efe6 "rt"
ACCENT = (200, 71, 43)   # #c8472b dot

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)

# Georgia Bold matches the favicon's serif weight; fall back to a generic serif.
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\georgiab.ttf",
    r"C:\Windows\Fonts\timesbd.ttf",
]


def load_font(px):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, px)
    return ImageFont.load_default()


def draw_icon(size, maskable=False):
    # Supersample 4x then downscale for clean edges.
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if maskable:
        # Full-bleed navy; content stays inside the central safe zone.
        d.rectangle([0, 0, s, s], fill=NAVY)
        font_px = int(s * 0.42)
    else:
        radius = int(s * 0.208)  # favicon rx 10/48
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=NAVY)
        font_px = int(s * 0.62)

    font = load_font(font_px)

    rt_w = d.textbbox((0, 0), "rt", font=font)[2]
    dot_w = d.textbbox((0, 0), ".", font=font)[2]
    total_w = rt_w + dot_w

    # Vertical centring via the full glyph metrics.
    bbox = d.textbbox((0, 0), "rt.", font=font)
    text_h = bbox[3] - bbox[1]
    x = (s - total_w) / 2
    y = (s - text_h) / 2 - bbox[1]

    d.text((x, y), "rt", font=font, fill=CREAM)
    d.text((x + rt_w, y), ".", font=font, fill=ACCENT)

    return img.resize((size, size), Image.LANCZOS)


def main():
    for size in (192, 512):
        draw_icon(size).save(OUT / f"icon-{size}.png")
        print(f"wrote icons/icon-{size}.png")
    draw_icon(512, maskable=True).save(OUT / "icon-maskable-512.png")
    print("wrote icons/icon-maskable-512.png")


if __name__ == "__main__":
    main()
