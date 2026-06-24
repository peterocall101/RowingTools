"""
generate_carousel.py
Generates Top 5 Results + Top 5 Clubs carousel slide images for a rowresults regatta.
Output goes to exhibits/<comp>/ as slide-00.png, slide-01.png, ...

Usage:
    python generate_carousel.py --comp metsat25
    python generate_carousel.py --html ../../heatmap-brcc25.html
    python generate_carousel.py --html ../../heatmap-metsun25.html --mode clubs

Requires:
    pip install requests playwright
    playwright install chromium
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

# ── DEPENDENCIES ──────────────────────────────────────────────────────────────

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Error: pip install playwright && playwright install chromium"); sys.exit(1)

# ── PATHS ─────────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).parent.parent.parent
TEMPLATE  = Path(__file__).parent / "carousel-template-final.html"
EXHIBITS  = REPO_ROOT / "exhibits"
BM_JSON   = REPO_ROOT / "data" / "benchmarks_v3.json"


# ── HTML DATA SOURCE ──────────────────────────────────────────────────────────

def rows_from_html(html_path):
    """Extract the ROWS array already embedded in a generated heatmap HTML file."""
    html = Path(html_path).read_text(encoding='utf-8')
    m = re.search(r'const ROWS=(\[.*?\]);', html)
    if not m:
        print(f"Error: could not find ROWS data in {html_path}")
        sys.exit(1)
    return json.loads(m.group(1))

def comp_from_html(html_path):
    """Derive comp code from a regatta page path.

    Handles both the new layout `leaderboards/<comp>/index.html` and the
    legacy `heatmap-<comp>.html` filename.
    """
    p = Path(html_path)
    if p.stem == 'index' and p.parent.name and p.parent.name != 'leaderboards':
        return p.parent.name  # leaderboards/<comp>/index.html -> <comp>
    m = re.search(r'heatmap-(.+)$', p.stem, re.I)
    return m.group(1) if m else p.stem


# ── TITLE HELPERS ─────────────────────────────────────────────────────────────

def make_title(comp):
    m = re.match(r'met(sat|sun)(\d{2})$', comp, re.I)
    if m:
        day = 'Saturday' if m.group(1).lower() == 'sat' else 'Sunday'
        return f"Met Regatta 20{m.group(2)} · {day}"
    m = re.match(r'met(\d{2})(sat|sun)$', comp, re.I)
    if m:
        day = 'Saturday' if m.group(2).lower() == 'sat' else 'Sunday'
        return f"Met Regatta 20{m.group(1)} · {day}"
    if re.match(r'brcc\d{2}$', comp, re.I):
        return f"Brit Club Champs · 20{comp[-2:]}"
    return comp

def make_short(comp):
    m = re.match(r'met(sat|sun)(\d{2})$', comp, re.I)
    if m:
        day = 'Sat' if m.group(1).lower() == 'sat' else 'Sun'
        return f"Met · {day} '{m.group(2)}"
    m = re.match(r'met(\d{2})(sat|sun)$', comp, re.I)
    if m:
        day = 'Sat' if m.group(2).lower() == 'sat' else 'Sun'
        return f"Met · {day} '{m.group(1)}"
    if re.match(r'brcc\d{2}$', comp, re.I):
        return f"Brit Champs · '{comp[-2:]}"
    return comp


# ── TIME UTILS ────────────────────────────────────────────────────────────────

def parse_t(t):
    if not t:
        return None
    m = re.match(r'^(\d+):(\d{2})\.(\d+)$', str(t).strip())
    if m:
        return int(m.group(1)) * 60 + int(m.group(2)) + float(f"0.{m.group(3)}")
    return None

def format_margin(diff_secs):
    if diff_secs < 0:
        return ''
    if diff_secs < 60:
        return f"+{diff_secs:.1f}s"
    mins = int(diff_secs // 60)
    secs = diff_secs - mins * 60
    return f"+{mins}m {secs:.0f}s"

def load_wbt():
    bm = json.loads(BM_JSON.read_text())
    wbt = {}
    for key, val in bm['wbt'].items():
        t = parse_t(val['time'])
        if t:
            wbt[key] = t
    return wbt


# ── CLUB NAME NORMALISATION ───────────────────────────────────────────────────

def norm_club(name):
    return re.sub(r'\s*\([A-Za-z]\)\s*$', '', name or '').strip()

def extract_modifier(club_name):
    m = re.search(r'\(([A-Za-z])\)\s*$', club_name or '')
    return m.group(1) if m else ''


# ── DATA PROCESSING ───────────────────────────────────────────────────────────

def compute_top5_results(rows, wbt):
    """Return top-5 results sorted for carousel display (rank 5 first, rank 1 last)."""
    entries = []
    for r in rows:
        for lane in r['lanes']:
            if lane['pct'] is None:
                continue
            entries.append({
                'crew':     norm_club(lane['club']),
                'modifier': extract_modifier(lane['club']),
                'event':    f"{r['event']} · {r['round']}",
                'gmt':      lane['pct'],
                'time':     lane['time'],
                'boat':     r['boat'],
            })

    entries.sort(key=lambda x: x['gmt'], reverse=True)
    top5 = entries[:5]

    for e in top5:
        wbt_secs  = wbt.get(e['boat'])
        race_secs = parse_t(e['time'])
        e['margin'] = format_margin(race_secs - wbt_secs) if (wbt_secs and race_secs) else ''

    # Assign ranks: 1 = best (top5[0] is best)
    for i, e in enumerate(top5):
        e['rank'] = i + 1

    # Carousel builds suspense: show rank 5 first, rank 1 last
    return list(reversed(top5))


def compute_top5_clubs(rows, min_entries=2):
    """Return top-5 clubs by top-3 avg GMT%, sorted for carousel display (rank 5 first)."""
    club_map = {}
    for r in rows:
        for lane in r['lanes']:
            if lane['pct'] is None:
                continue
            if '/' in (lane['club'] or ''):
                continue  # skip composites
            cn = norm_club(lane['club'])
            if not cn:
                continue
            if cn not in club_map:
                club_map[cn] = {'pcts': [], 'results': []}
            club_map[cn]['pcts'].append(lane['pct'])
            club_map[cn]['results'].append({
                'event': f"{r['event']} · {r['round']}",
                'gmt':   lane['pct'],
            })

    clubs = []
    for name, data in club_map.items():
        if len(data['pcts']) < min_entries:
            continue
        sorted_pcts    = sorted(data['pcts'], reverse=True)
        top3           = sorted_pcts[:3]
        top3_avg       = round(sum(top3) / len(top3), 1)
        sorted_results = sorted(data['results'], key=lambda x: x['gmt'], reverse=True)
        r3             = sorted_results[:3]
        clubs.append({
            'club':          name,
            'top3_avg':      top3_avg,
            'best_gmt':      round(sorted_pcts[0], 1),
            'crews_entered': len(data['pcts']),
            'r1_event':      r3[0]['event'] if len(r3) > 0 else '',
            'r1_gmt':        round(r3[0]['gmt'], 1) if len(r3) > 0 else '',
            'r2_event':      r3[1]['event'] if len(r3) > 1 else '',
            'r2_gmt':        round(r3[1]['gmt'], 1) if len(r3) > 1 else '',
            'r3_event':      r3[2]['event'] if len(r3) > 2 else '',
            'r3_gmt':        round(r3[2]['gmt'], 1) if len(r3) > 2 else '',
        })

    clubs.sort(key=lambda x: x['top3_avg'], reverse=True)
    top5 = clubs[:5]

    for i, c in enumerate(top5):
        c['rank'] = i + 1

    return list(reversed(top5))  # rank 5 first for suspense


# ── CSV FORMATTING ────────────────────────────────────────────────────────────

import csv as _csv
import io as _io

def _csv_row(writer, buf, row):
    writer.writerow(row)
    return buf.getvalue()

def results_to_csv(results):
    buf = _io.StringIO()
    w = _csv.writer(buf, quoting=_csv.QUOTE_MINIMAL)
    w.writerow(['rank', 'crew', 'modifier', 'event', 'gmt', 'time', 'margin'])
    for r in results:
        w.writerow([r['rank'], r['crew'], r['modifier'], r['event'],
                    f"{r['gmt']:.1f}", r['time'], r['margin']])
    return buf.getvalue().strip()

def clubs_to_csv(clubs):
    buf = _io.StringIO()
    w = _csv.writer(buf, quoting=_csv.QUOTE_MINIMAL)
    w.writerow(['rank', 'club', 'top3_avg', 'best_gmt', 'crews_entered',
                'r1_event', 'r1_gmt', 'r2_event', 'r2_gmt', 'r3_event', 'r3_gmt'])
    for c in clubs:
        w.writerow([c['rank'], c['club'], c['top3_avg'], c['best_gmt'], c['crews_entered'],
                    c['r1_event'], c['r1_gmt'], c['r2_event'], c['r2_gmt'],
                    c['r3_event'], c['r3_gmt']])
    return buf.getvalue().strip()


# ── PLAYWRIGHT RENDER ─────────────────────────────────────────────────────────

def render_carousel(template_path, inject_data, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={'width': 540, 'height': 675},
            device_scale_factor=2,  # 1080x1350 output — Instagram 4:5
        )

        url = template_path.resolve().as_uri()
        page.goto(url)
        page.wait_for_timeout(1500)  # fonts load

        page.evaluate(f"window.__inject({json.dumps(inject_data)})")
        page.wait_for_timeout(600)

        # Resize phone frame to fill viewport (4:5, no rounded corners)
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


# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Generate regatta carousel slide images for Instagram / TikTok.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python generate_carousel.py --html ../../heatmap-brcc25.html\n"
            "  python generate_carousel.py --html ../../heatmap-metsun25.html --mode clubs\n"
            "  python generate_carousel.py --comp metsat25\n"
        ),
    )
    parser.add_argument('--html',         default=None,
                        help='Path to generated heatmap HTML (reads ROWS from it, no API call)')
    parser.add_argument('--comp',         default=None,
                        help='rowresults comp code - auto-derived from --html filename if omitted')
    parser.add_argument('--title',        default=None,
                        help='Override carousel title (default: auto from comp code)')
    parser.add_argument('--short',        default=None,
                        help='Override short header tag (default: auto from comp code)')
    parser.add_argument('--mode',         default='combined',
                        choices=['combined', 'results', 'clubs'],
                        help='Carousel mode (default: combined)')
    parser.add_argument('--min-entries',  type=int, default=2,
                        help='Min scored entries for club leaderboard (default: 2)')
    args = parser.parse_args()

    if not args.html and not args.comp:
        parser.error("provide --html <heatmap.html> or --comp <code>")

    if not TEMPLATE.exists():
        print(f"Error: template not found at {TEMPLATE}")
        sys.exit(1)

    comp = args.comp or comp_from_html(args.html)
    title = args.title or make_title(comp)
    short = args.short or make_short(comp)

    print(f"Competition : {comp}")
    print(f"Title       : {title}")
    print(f"Short tag   : {short}")
    print(f"Mode        : {args.mode}")
    print()

    wbt = load_wbt()

    if args.html:
        print(f"Loading race data from {args.html} ...")
        rows = rows_from_html(args.html)
    else:
        try:
            import requests  # noqa: F401
            sys.path.insert(0, str(Path(__file__).parent))
            from generate_heatmap import build_data
        except ImportError as e:
            print(f"Error: {e}"); sys.exit(1)
        print("Fetching race data from rowresults API...")
        rows = build_data(comp, BM_JSON)

    scored = sum(1 for r in rows for l in r['lanes'] if l['pct'] is not None)
    print(f"{len(rows)} finals, {scored} scored results\n")

    results = compute_top5_results(rows, wbt)
    clubs   = compute_top5_clubs(rows, min_entries=args.min_entries)

    print("Top 5 results (rank 1 = best):")
    for r in reversed(results):
        print(f"  {r['rank']}. {r['crew']} ({r['event']}) - {r['gmt']:.1f}% {r['margin']}")

    print(f"\nTop 5 clubs (min {args.min_entries} entries, rank 1 = best):")
    for c in reversed(clubs):
        print(f"  {c['rank']}. {c['club']} - top3 avg {c['top3_avg']:.1f}%  ({c['crews_entered']} entries)")

    inject_data = {
        'regattaFull': title,
        'regattaShort': short,
        'results': results_to_csv(results),
        'clubs': clubs_to_csv(clubs),
        'mode': args.mode,
    }

    out_dir = EXHIBITS / comp
    print(f"\nRendering slides to {out_dir} ...")
    render_carousel(TEMPLATE, inject_data, out_dir)

    pngs = sorted(out_dir.glob('slide-*.png'))
    print(f"\nDone. {len(pngs)} slides saved to {out_dir}")


if __name__ == '__main__':
    main()
