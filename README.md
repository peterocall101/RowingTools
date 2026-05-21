# Rowing Tools

**rowingtools.co.uk** - GMT% calculator and performance analysis tools for UK club rowing.

---

## Repo structure

```text
RowingTools/
├── index.html                               # Public website (GitHub Pages)
├── heatmap-metsat25.html                    # Met 2025 Saturday
├── heatmap-metsun25.html                    # Met 2025 Sunday
├── heatmap-brcc25.html                      # British Rowing Club Championships 2025
├── heatmap-wallingford25.html               # Wallingford Regatta 2025
├── heatmap-nottm25.html                     # Nottingham City Regatta 2025 (not linked - suspect data)
├── heatmap-wallingford26.html               # Wallingford Regatta 2026
├── heatmap-nottm26.html                     # Nottingham City Regatta 2026
├── heatmap-poplar26.html                    # Poplar Regatta 2026
├── heatmap-bucs26.html                      # BUCS Regatta 2026 (not linked - multi-day, scores not comparable)
├── wallingford26-workflow.yml               # Post-race checklist for Wallingford 2026
├── data/
│   ├── benchmarks_v1.json                   # Frozen 2025-03-24
│   ├── benchmarks_v2.json                   # Frozen - adds HWR benchmark
│   └── benchmarks_v3.json                   # Current - adds Met A/B/C final benchmarks
├── gmt_processor/
│   ├── gmt_processor.py                     # Stage 1: CSV in, ranked GMT table out
│   ├── benchmarks.py                        # Loads benchmark data from data/
│   ├── inputs/
│   │   ├── scraper.py                       # Stage 2: URL in, results fetched + processed
│   │   ├── generate_heatmap.py              # Stage 3a: rowresults.co.uk comp in, heatmap HTML out
│   │   ├── generate_heatmap_sheet.py        # Stage 3b: Google Sheets CSV in, heatmap HTML out
│   │   ├── generate_heatmap_wallingford.py  # Stage 3c: wallingford-regatta.org.uk HTML in, heatmap HTML out
│   │   ├── generate_heatmap_didwewin.py     # Stage 3d: didwewin.info in, heatmap HTML out
│   │   ├── generate_heatmap_nottm26.py      # Event-specific: regatta.time-team.nl (Nottingham 2026)
│   │   ├── generate_heatmap_poplar26.py     # Event-specific: beta.regatta.time-team.nl (Poplar 2026)
│   │   ├── generate_heatmap_bucs.py         # Event-specific: results.bucsrowing.org.uk (BUCS)
│   │   ├── generate_carousel.py             # Stage 4: heatmap HTML in, carousel PNGs out
│   │   ├── carousel-template-final.html     # Carousel slide template
│   │   └── met_finals_scraper.py            # Benchmark updater: scrapes Met finals data
│   └── outputs/                             # Local only (gitignored)
├── exhibits/                                # Local only (gitignored) - carousel PNG output
└── CNAME                                    # rowingtools.co.uk domain config
```

---

## Architecture

All benchmark data lives in `data/benchmarks_vN.json`. Both the website and Python tools load from it - `index.html` via `fetch()` at load time, `benchmarks.py` from disk at runtime. Never edit benchmark numbers directly in either file.

When benchmark data needs updating, create `data/benchmarks_v4.json` - never edit the current version.

| Version | What changed | Status |
| ------- | ------------ | ------ |
| v1 | Initial - WBT, Met avg, HRR | Frozen 2025-03-24 |
| v2 | Adds HWR (Henley Women's Regatta) | Frozen |
| v3 | Adds Met A/B/C final benchmarks | **Current** |

---

## Tool 1 - index.html (public website)

Hosted on GitHub Pages at rowingtools.co.uk. Static, no backend. Features: GMT% calculator against WBT, Met, HRR, and HWR benchmarks; sort by any metric; CSV download; benchmark reference tabs; mobile responsive; dark mode. Deploy by pushing to main - GitHub Pages redeploys in ~30s.

---

## Tool 2 - gmt_processor (local Python, never deployed)

Pipeline from a live regatta results source to a published heatmap page.

**Stage 1 - gmt_processor.py:** takes a CSV of results, calculates GMT%, outputs a ranked table.

**Stage 2 - scraper.py:** points at a URL, fetches results, extracts finals via Claude API, outputs CSV. Needs `pip install anthropic requests beautifulsoup4 selenium pandas`. rowresults.co.uk also needs ChromeDriver.

**Stage 3 - heatmap generators:** all output a self-contained four-tab HTML file (Heatmap, Top 250 Results, Club Leaderboard, Club Compare). All take `--comp`, `--title`, `--out`. Choose by results source:

| Script | Results source |
| ------ | -------------- |
| `generate_heatmap.py` (3a) | rowresults.co.uk JSON API |
| `generate_heatmap_sheet.py` (3b) | Google Sheets export CSV |
| `generate_heatmap_wallingford.py` (3c) | wallingford-regatta.org.uk HTML tables |
| `generate_heatmap_didwewin.py` (3d) | didwewin.info (Wallingford 2026) - URL hardcoded |
| `generate_heatmap_nottm26.py` | regatta.time-team.nl (Nottingham 2026) |
| `generate_heatmap_poplar26.py` | beta.regatta.time-team.nl (Poplar 2026) |
| `generate_heatmap_bucs.py` | results.bucsrowing.org.uk (BUCS) |

For Stage 3b, CSV needs columns: `Race, Event, Type, Name, Position, Lane, Time, Diff`. Finals only; position 9999 and J16-and-below excluded; times over 20 minutes treated as null.

**Stage 4 - generate_carousel.py:** reads a heatmap HTML file, produces carousel PNGs (810x1440px) via headless Chromium into `exhibits/<comp>/` (gitignored). Needs `pip install requests playwright && playwright install chromium`.

---

## Tool 3 - met_finals_scraper.py (benchmark data updater)

Scrapes Met A/B/C final results from rowresults.co.uk across multiple years and outputs JSON ready to paste into the next benchmarks version.

---

## Workflow: post-regatta

Run the appropriate Stage 3 script, add a card to the `#sec-leaderboards` grid in `index.html`, review locally, push. Optionally run Stage 4 for carousel slides.

- **Path A - rowresults.co.uk:** Stage 3a with the comp code
- **Path B - Google Sheets:** export CSV, run Stage 3b
- **Path C - wallingford-regatta.org.uk:** Stage 3c
- **Path D - didwewin.info:** Stage 3d - full checklist in `wallingford26-workflow.yml`
- **Path E - event-specific scraper:** dedicated script for that regatta (see table above)
