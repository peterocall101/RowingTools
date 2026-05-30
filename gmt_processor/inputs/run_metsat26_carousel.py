"""Generate Met Regatta 2026 Saturday carousel — 10 slides, no outro."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from generate_carousel import render_carousel, TEMPLATE, EXHIBITS

RESULTS_CSV = (
    "rank,crew,modifier,event,gmt,time,margin\n"
    "5,Oxford Univ BC,A,Open 4+ · Final A,93.9,6:22.11,+25.1s\n"
    "4,Oxford Brookes Univ,A,Open 8+ · Final A,94.0,5:38.98,+20.6s\n"
    "3,Oxford Brookes Univ,G,Open 8+ · Final A,94.2,5:38.18,+19.8s\n"
    "2,Leander,A,Open 8+ · Final A,94.7,5:36.38,+18.0s\n"
    "1,Cambridge Univ,A,Open 8+ · Final A,95.0,5:35.38,+17.0s"
)

CLUBS_CSV = (
    "rank,club,top3_avg,best_gmt,crews_entered,r1_event,r1_gmt,r2_event,r2_gmt,r3_event,r3_gmt\n"
    "3,London RC,93.3,93.9,13,Open 4+ · Final A,93.9,Open 8+ · Final A,93.9,Open 8+ · Final B,92.0\n"
    "2,Leander,93.4,94.7,12,Open 8+ · Final A,94.7,Open 4x · Final A,92.8,W 2x · Final A,92.8\n"
    "1,Oxford Brookes Univ,93.8,94.2,13,Open 8+ · Final A,94.2,Open 8+ · Final A,94.0,Open 4+ · Final A,93.3"
)

inject_data = {
    'regattaFull':   'Metropolitan Regatta 2026',
    'regattaShort':  'MET · 2026',
    'coverSubtitle': 'Saturday · Dorney Lake',
    'results':       RESULTS_CSV,
    'clubs':         CLUBS_CSV,
    'mode':          'combined',
    'noOutro':       True,
}

out_dir = EXHIBITS / 'metsat26'
print(f"Rendering to {out_dir} ...")
render_carousel(TEMPLATE, inject_data, out_dir)

pngs = sorted(out_dir.glob('slide-*.png'))
print(f"\nDone. {len(pngs)} slides saved.")
for p in pngs:
    print(f"  {p.name}")
