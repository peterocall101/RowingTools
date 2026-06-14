"""
generate_season_carousel.py
Generates a season leaderboard carousel (top 10 clubs by top-10 avg GMT%) for a given year.

Usage:
    python generate_season_carousel.py --year 26
    python generate_season_carousel.py --year 26 --out exhibits/season26/

Requires:
    pip install playwright
    playwright install chromium
"""

import argparse
import csv as _csv
import io as _io
import json
import sys
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Error: pip install playwright && playwright install chromium")
    sys.exit(1)

REPO_ROOT = Path(__file__).parent.parent.parent
TEMPLATE  = Path(__file__).parent / "carousel-season-template.html"
EXHIBITS  = REPO_ROOT / "exhibits"

COMP_SHORT = {
    'reading26': 'Reading',
    'metsun26': 'Met Sun',
    'metsat26': 'Met Sat',
    'nsr26':    'NSR',
    'poplar26': 'Poplar',
    'nottm26':  'Nottm',
    'wallingford26': 'Wlfd',
    'metsun25': 'Met Sun',
    'metsat25': 'Met Sat',
    'brcc25':   'Brit Champs',
    'wallingford25': 'Wlfd',
}


def compute_season_top10(year_suffix, all_results, aliases):
    regs = [r for r in all_results if r['comp'].endswith(year_suffix)]
    if not regs:
        print(f"No regattas found for year suffix '{year_suffix}'")
        sys.exit(1)

    comp_names = [r['comp'] for r in regs]
    print(f"Regattas ({len(regs)}): {comp_names}")

    # Alias keys are lowercase in club_aliases.json - match website behaviour
    lc_aliases = {k.lower(): v for k, v in aliases.items()}

    club_data = {}
    for reg in regs:
        comp = reg['comp']
        short = COMP_SHORT.get(comp, comp)
        for r in reg['results']:
            if '/' in (r['club'] or ''):
                continue
            if r['pct'] is None:
                continue
            club = lc_aliases.get(r['club'].lower(), r['club'])
            if club not in club_data:
                club_data[club] = []
            club_data[club].append({
                'pct':   r['pct'],
                'event': r['event'],
                'comp':  comp,
                'short': short,
            })

    ranked = []
    for name, results in club_data.items():
        pcts = sorted([r['pct'] for r in results], reverse=True)
        if len(pcts) < 10:
            continue
        top10avg = sum(pcts[:10]) / 10
        best_gmt = pcts[0]
        regattas = len({r['comp'] for r in results})
        top3 = sorted(results, key=lambda x: -x['pct'])[:3]
        ranked.append({
            'name':     name,
            'top10avg': top10avg,
            'best_gmt': round(best_gmt, 1),
            'entries':  len(pcts),
            'regattas': regattas,
            'top3':     top3,
        })

    ranked.sort(key=lambda x: -x['top10avg'])
    return ranked[:10]


def clubs_to_csv(clubs_ranked_asc):
    """clubs_ranked_asc: rank 1 first. We reverse for carousel suspense (rank 10 first)."""
    buf = _io.StringIO()
    w = _csv.writer(buf)
    w.writerow(['rank', 'club', 'top10avg', 'best_gmt', 'entries', 'regattas',
                'r1_event', 'r1_gmt', 'r2_event', 'r2_gmt', 'r3_event', 'r3_gmt'])
    for i, c in enumerate(reversed(clubs_ranked_asc), 1):
        rank = len(clubs_ranked_asc) - i + 1
        tr = c['top3']
        row = [
            rank, c['name'], round(c['top10avg'], 1), c['best_gmt'],
            c['entries'], c['regattas'],
            f"{tr[0]['event']} · {tr[0]['short']}", round(tr[0]['pct'], 1),
            f"{tr[1]['event']} · {tr[1]['short']}", round(tr[1]['pct'], 1) if len(tr) > 1 else '',
            f"{tr[2]['event']} · {tr[2]['short']}", round(tr[2]['pct'], 1) if len(tr) > 2 else '',
        ]
        w.writerow(row)
    return buf.getvalue().strip()


def render_carousel(template_path, inject_data, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={'width': 540, 'height': 675},
            device_scale_factor=2,
        )
        page.goto(template_path.resolve().as_uri())
        page.wait_for_timeout(1500)

        page.evaluate(f"window.__inject({json.dumps(inject_data)})")
        page.wait_for_timeout(600)

        page.evaluate("""
            const ph = document.querySelector('.phone');
            if (ph) {
                ph.style.width = '540px';
                ph.style.height = '675px';
                ph.style.borderRadius = '0';
                ph.style.border = 'none';
                ph.style.boxShadow = 'none';
            }
        """)

        slide_count = page.evaluate("window.__slideCount()")
        print(f"  {slide_count} slides to render")

        stage = page.locator('#stage')
        for i in range(slide_count):
            page.evaluate(f"window.__goTo({i})")
            page.wait_for_timeout(200)
            out_path = out_dir / f"slide-{str(i).zfill(2)}.png"
            stage.screenshot(path=str(out_path))
            print(f"  [{i+1}/{slide_count}] {out_path.name}")

        browser.close()


def main():
    parser = argparse.ArgumentParser(description="Generate season leaderboard carousel.")
    parser.add_argument('--year', default='26',
                        help="Two-digit year suffix, e.g. 26 (default: 26)")
    parser.add_argument('--out', default=None,
                        help="Output directory (default: exhibits/season<year>/)")
    args = parser.parse_args()

    if not TEMPLATE.exists():
        print(f"Error: template not found at {TEMPLATE}")
        sys.exit(1)

    with open(REPO_ROOT / 'data' / 'all_results.json', encoding='utf-8') as f:
        all_results = json.load(f)
    with open(REPO_ROOT / 'data' / 'club_aliases.json', encoding='utf-8') as f:
        aliases = json.load(f)

    print(f"Computing 20{args.year} season leaderboard...")
    clubs = compute_season_top10(args.year, all_results, aliases)

    print("\nTop 10 (rank 1 = best):")
    for i, c in enumerate(clubs, 1):
        print(
            f"  {i}. {c['name']:40s} {c['top10avg']:.2f}%"
            f"  ({c['entries']} entries, {c['regattas']} regattas)"
        )

    num_regattas = len([r for r in all_results if r['comp'].endswith(args.year)])
    cover_subtitle = f"Top 10 clubs · {num_regattas} regattas"

    inject_data = {
        'regattaFull':   f"20{args.year} Season So Far",
        'regattaShort':  f"Season ’{args.year}",
        'clubs':         clubs_to_csv(clubs),
        'mode':          'season',
        'coverSubtitle': cover_subtitle,
    }

    out_dir = Path(args.out) if args.out else EXHIBITS / f"season{args.year}"
    print(f"\nRendering to {out_dir} ...")
    render_carousel(TEMPLATE, inject_data, out_dir)

    pngs = sorted(out_dir.glob('slide-*.png'))
    print(f"\nDone. {len(pngs)} slides saved to {out_dir}")


if __name__ == '__main__':
    main()
