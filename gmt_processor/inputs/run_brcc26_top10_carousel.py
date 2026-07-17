"""
run_brcc26_top10_carousel.py
Three-slide carousel for British Rowing Club Championships 2026 day 1:
  intro cover  ->  top-10 crews on one page  ->  closing slide.

Reads the top results straight out of the generated brcc26 leaderboard page
(no network call) and renders PNGs to exhibits/brcc26/ via Playwright, reusing
render_carousel() and the shared visual theme (carousel-top10-template.html).

Usage:
    python run_brcc26_top10_carousel.py
    python run_brcc26_top10_carousel.py --top 10 --heading "Day 1 · Top 10"

Requires:
    pip install playwright && playwright install chromium
"""

import argparse
import csv as _csv
import io as _io
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from generate_carousel import render_carousel  # noqa: E402  (shared Playwright renderer)

REPO_ROOT = Path(__file__).parent.parent.parent
TEMPLATE  = Path(__file__).parent / "carousel-top10-template.html"
PAGE      = REPO_ROOT / "leaderboards" / "brcc26" / "index.html"


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

    out_dir = Path(args.out) if args.out else REPO_ROOT / "exhibits" / "brcc26"
    print(f"\nRendering to {out_dir} ...")
    render_carousel(TEMPLATE, inject_data, out_dir)

    pngs = sorted(out_dir.glob('slide-*.png'))
    print(f"\nDone. {len(pngs)} slides saved.")
    for p in pngs:
        print(f"  {p}")


if __name__ == '__main__':
    main()
