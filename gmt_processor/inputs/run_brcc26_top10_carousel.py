"""
run_brcc26_top10_carousel.py
Three-slide carousel for British Rowing Club Championships 2026 day 1:
  intro cover  ->  top-10 crews on one page  ->  closing slide.

Reads the top results straight out of the generated brcc26 leaderboard page
(no network call) and renders PNGs via Playwright using the shared visual
theme (carousel-top10-template.html).

Two output shapes:
  --format feed   1080x1350 (Instagram 4:5 carousel)   -> exhibits/brcc26/
  --format story  1080x1920 (Instagram/TikTok 9:16)     -> exhibits/brcc26-story/

Usage:
    python run_brcc26_top10_carousel.py                       # feed carousel
    python run_brcc26_top10_carousel.py --format story        # 9:16 stories
    python run_brcc26_top10_carousel.py --heading "Day 2 · Top 10"

Requires:
    pip install playwright && playwright install chromium
    (set PW_CHROME=/path/to/chrome to use a pre-provisioned browser instead)
"""

import argparse
import csv as _csv
import io as _io
import json
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO_ROOT = Path(__file__).parent.parent.parent
TEMPLATE  = Path(__file__).parent / "carousel-top10-template.html"
PAGE      = REPO_ROOT / "leaderboards" / "brcc26" / "index.html"

# width x height of the phone/stage in CSS px; rendered at device_scale_factor 2.
FORMATS = {
    'feed':  {'w': 540, 'h': 675, 'dir': 'brcc26'},        # 1080x1350, Instagram 4:5
    'story': {'w': 540, 'h': 960, 'dir': 'brcc26-story'},  # 1080x1920, 9:16
}


def render_carousel(template_path, inject_data, out_dir, fmt):
    """Render each slide to a PNG. `fmt` selects the aspect ratio (feed/story)."""
    spec = FORMATS[fmt]
    out_dir.mkdir(parents=True, exist_ok=True)
    launch_kwargs = {}
    if os.environ.get('PW_CHROME'):
        launch_kwargs['executable_path'] = os.environ['PW_CHROME']

    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_kwargs)
        page = browser.new_page(
            viewport={'width': spec['w'], 'height': spec['h']},
            device_scale_factor=2,
        )
        page.goto(template_path.resolve().as_uri())
        page.wait_for_timeout(1800)  # fonts load

        page.evaluate(f"window.__inject({json.dumps(inject_data)})")
        page.wait_for_timeout(700)

        # Fill the viewport edge-to-edge (no rounded phone frame in the export).
        page.evaluate(f"""
            const ph = document.querySelector('.phone');
            if (ph) {{
                ph.style.width = '{spec['w']}px';
                ph.style.height = '{spec['h']}px';
                ph.style.borderRadius = '0';
                ph.style.border = 'none';
                ph.style.boxShadow = 'none';
            }}
        """)

        slide_count = page.evaluate("window.__slideCount()")
        stage = page.locator('#stage')
        for i in range(slide_count):
            page.evaluate(f"window.__goTo({i})")
            page.wait_for_timeout(250)
            out_path = out_dir / f"slide-{str(i).zfill(2)}.png"
            stage.screenshot(path=str(out_path))
            print(f"  [{i+1}/{slide_count}] {out_path.name}")

        browser.close()


def norm_club(name):
    """Match the website / build_all_results normalisation for display."""
    name = re.sub(r'\s*\([A-Za-z]\)\s*$', '', name or '').strip()   # drop "(A)" tier tags
    name = re.sub(r'\s*/\s*', '/', name)                            # composite spacing
    name = re.sub(r'\bUniv\b', 'University', name)
    name = re.sub(r'\bColl\b', 'College', name)
    name = re.sub(r'\bSch\b', 'School', name)
    name = re.sub(r'\s+(Rowing Club|Boat Club|RC|BC|ARC)\s*$', '', name, flags=re.I).strip()
    return name


def top_results(page_path, n):
    html = Path(page_path).read_text(encoding='utf-8')
    m = re.search(r'const ROWS=(\[.*?\]);', html)
    if not m:
        sys.exit(f"Could not find ROWS in {page_path}")
    rows = json.loads(m.group(1))

    entries = []
    for r in rows:
        for lane in r['lanes']:
            if lane.get('pct') is None:
                continue
            entries.append({
                'crew':  norm_club(lane['club']),
                'event': f"{r['event']} · {r['round']}",
                'gmt':   lane['pct'],
            })
    entries.sort(key=lambda x: -x['gmt'])
    return entries[:n]


def results_to_csv(results):
    buf = _io.StringIO()
    w = _csv.writer(buf)
    w.writerow(['rank', 'crew', 'event', 'gmt'])
    for i, e in enumerate(results, 1):
        w.writerow([i, e['crew'], e['event'], f"{e['gmt']:.1f}"])
    return buf.getvalue().strip()


def main():
    ap = argparse.ArgumentParser(description="brcc26 day-1 top-10 carousel (intro + table + outro).")
    ap.add_argument('--top', type=int, default=10, help="Number of results (default: 10)")
    ap.add_argument('--title', default="British Rowing Club Championships")
    ap.add_argument('--short', default="Brit Champs '26")
    ap.add_argument('--subtitle', default="Day 1 &middot; Top 10 crews by GMT%")
    ap.add_argument('--heading', default="Day 1 &middot; Top 10")
    ap.add_argument('--subheading', default="By GMT% vs world best time")
    ap.add_argument('--footnote',
                    default="Full leaderboard &amp; GMT% analysis at rowingtools.co.uk/leaderboards/brcc26")
    ap.add_argument('--format', choices=list(FORMATS), default='feed',
                    help="feed = 1080x1350 (4:5), story = 1080x1920 (9:16). Default: feed")
    ap.add_argument('--out', default=None)
    args = ap.parse_args()

    if not TEMPLATE.exists():
        sys.exit(f"Template not found: {TEMPLATE}")
    if not PAGE.exists():
        sys.exit(f"Regatta page not found: {PAGE}")

    results = top_results(PAGE, args.top)
    print(f"Top {len(results)} day-1 results:")
    for i, e in enumerate(results, 1):
        print(f"  {i:2d}. {e['gmt']:5.1f}%  {e['crew']}  ({e['event']})")

    inject_data = {
        'title':         args.title,
        'regattaShort':  args.short,
        'coverSubtitle': args.subtitle,
        'heading':       args.heading,
        'subheading':    args.subheading,
        'footnote':      args.footnote,
        'results':       results_to_csv(results),
    }

    out_dir = Path(args.out) if args.out else REPO_ROOT / "exhibits" / FORMATS[args.format]['dir']
    print(f"\nRendering {args.format} ({FORMATS[args.format]['w']*2}x{FORMATS[args.format]['h']*2}) to {out_dir} ...")
    render_carousel(TEMPLATE, inject_data, out_dir, args.format)

    pngs = sorted(out_dir.glob('slide-*.png'))
    print(f"\nDone. {len(pngs)} slides saved.")
    for p in pngs:
        print(f"  {p}")


if __name__ == '__main__':
    main()
