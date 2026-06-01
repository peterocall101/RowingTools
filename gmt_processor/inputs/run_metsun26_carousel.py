"""Generate Met Regatta 2026 Sunday carousel — 10 slides, no outro."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from generate_carousel import render_carousel, TEMPLATE, EXHIBITS

RESULTS_CSV = (
    "rank,crew,modifier,event,gmt,time,margin\n"
    "5,Newcastle Univ,,Open 4+ · Final A,94.7,6:19.20,+20.2s\n"
    "4,Thames,A,W 8+ · Final A,94.9,6:13.17,+19.0s\n"
    "3,London RC,A,Open 8+ · Final A,94.9,5:35.84,+17.2s\n"
    "2,London RC,B,Open 8+ · Final A,94.9,5:35.68,+17.0s\n"
    "1,Thames,A,Open 8+ · Final A,95.5,5:33.63,+14.9s"
)

CLUBS_CSV = (
    "rank,club,top3_avg,best_gmt,crews_entered,r1_event,r1_gmt,r2_event,r2_gmt,r3_event,r3_gmt\n"
    "3,Reading Univ,93.0,93.8,18,W 4x- · Final A,93.8,W 4x- · Final A,93.8,Open 4x · Final A,91.3\n"
    "2,London RC,94.8,94.9,14,Open 8+ · Final A,94.9,Open 8+ · Final A,94.9,Open 4+ · Final A,94.5\n"
    "1,Thames,94.9,95.5,15,Open 8+ · Final A,95.5,W 8+ · Final A,94.9,W 8+ · Final A,94.4"
)

inject_data = {
    'regattaFull':   'Metropolitan Regatta 2026',
    'regattaShort':  'MET · 2026',
    'coverSubtitle': 'Sunday · Dorney Lake',
    'results':       RESULTS_CSV,
    'clubs':         CLUBS_CSV,
    'mode':          'combined',
    'noOutro':       True,
}

out_dir = EXHIBITS / 'metsun26'
print(f"Rendering to {out_dir} ...")
render_carousel(TEMPLATE, inject_data, out_dir)

pngs = sorted(out_dir.glob('slide-*.png'))
print(f"\nDone. {len(pngs)} slides saved.")
for p in pngs:
    print(f"  {p.name}")
