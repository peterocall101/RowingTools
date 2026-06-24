# Rowing Tools

**rowingtools.co.uk** - GMT% calculator and performance analysis tools for UK club rowing.

---

## Repo structure

```text
RowingTools/
├── index.html                               # Landing page (cards -> the three tools)
├── assets/
│   ├── app.css                              # Shared styles for /, /gmt/, /leaderboards/
│   └── app.js                               # Shared script (GMT calc, leaderboard club analysis, subscribe)
├── gmt/index.html                           # GMT% Calculator  (/gmt/)
├── leaderboards/index.html                  # Regatta index (cards) + cross-regatta club ranking  (/leaderboards/)
├── leaderboards/<comp>/index.html           # Individual regatta pages  (/leaderboards/<comp>/), e.g. marlow26, brcc25
├── clubs/index.html                         # Club Profiles directory + detail  (/clubs/, ?club=<name>)
├── heatmap-*.html, clubs.html               # Redirect stubs -> new URLs (kept so old/indexed links don't 404)
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
│   │   ├── generate_heatmap_nsr26.py        # Event-specific: regatta.time-team.nl (NSR 2026)
│   │   ├── generate_heatmap_marlow25.py     # Event-specific: regatta.time-team.nl (Marlow 2025, 2000m multi-lane)
│   │   ├── generate_heatmap_marlow26.py     # Event-specific: regatta.time-team.nl (Marlow 2026, combined-band events + per-crew category labels)
│   │   ├── generate_heatmap_reading26.py    # Event-specific: reading-amateur-regatta.org (Reading 2026, head-to-head 1500m)
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

The public site is a static multi-page app: a landing page at `/` linking to three tools - `/gmt/` (calculator), `/leaderboards/` (regattas + club ranking) and `/clubs/` (club profiles). `/` , `/gmt/` and `/leaderboards/` share `assets/app.css` + `assets/app.js`; individual regatta pages under `/leaderboards/<comp>/` are self-contained. Clean URLs are served via folder + `index.html` (GitHub Pages); old `heatmap-*.html` / `clubs.html` paths are redirect stubs.

All benchmark data lives in `data/benchmarks_vN.json`. Both the website and Python tools load from it - `/gmt/` via `fetch('/data/benchmarks_v3.json')` at load time, `benchmarks.py` from disk at runtime. Never edit benchmark numbers directly in either file.

When benchmark data needs updating, create `data/benchmarks_v4.json` - never edit the current version.

| Version | What changed | Status |
| ------- | ------------ | ------ |
| v1 | Initial - WBT, Met avg, HRR | Frozen 2025-03-24 |
| v2 | Adds HWR (Henley Women's Regatta) | Frozen |
| v3 | Adds Met A/B/C final benchmarks | **Current** |

---

## Tool 1 - GMT% calculator (`/gmt/`)

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
| `generate_heatmap_nottm26.py` | regatta.time-team.nl (Nottingham 2026) - events hardcoded |
| `generate_heatmap_poplar26.py` | beta.regatta.time-team.nl (Poplar 2026) - events hardcoded |
| `generate_heatmap_nsr26.py` | regatta.time-team.nl (NSR 2026) - events hardcoded |
| `generate_heatmap_marlow25.py` | regatta.time-team.nl (Marlow 2025) - events hardcoded, 2000m multi-lane |
| `generate_heatmap_marlow26.py` | regatta.time-team.nl (Marlow 2026) - combined-band events, per-crew category from the table's "event" column |
| `generate_heatmap_reading26.py` | reading-amateur-regatta.org (Reading 2026) - head-to-head, winners-only over 1500m |
| `generate_heatmap_bucs.py` | results.bucsrowing.org.uk (BUCS) |

For Stage 3b, CSV needs columns: `Race, Event, Type, Name, Position, Lane, Time, Diff`. Finals only; position 9999 and J16-and-below excluded; times over 20 minutes treated as null.

**Stage 4 - generate_carousel.py:** reads a heatmap HTML file, produces carousel PNGs (810x1440px) via headless Chromium into `exhibits/<comp>/` (gitignored). Needs `pip install requests playwright && playwright install chromium`.

---

## Tool 3 - met_finals_scraper.py (benchmark data updater)

Scrapes Met A/B/C final results from rowresults.co.uk across multiple years and outputs JSON ready to paste into the next benchmarks version.

---

## Workflow: post-regatta

Full publish checklist (do all of these - steps 3-5 are easy to forget and the
site-wide club pages break silently without them):

1. **Generate the regatta page** - run the appropriate Stage 3 script. It now writes `leaderboards/<comp>/index.html` (served at the clean URL `/leaderboards/<comp>/`), creating the folder if needed.
2. **Add a card** to the `.lb-grid` in `leaderboards/index.html` (newest on top within its year section). The card link is `/leaderboards/<comp>/`.
3. **Rebuild the club dataset** - add the comp to the `HEATMAPS` list in `gmt_processor/inputs/build_all_results.py` (`comp`, `date`; the script reads `leaderboards/<comp>/index.html` and derives the link `/leaderboards/<comp>/`), then run it. This regenerates `data/all_results.json`, which powers the site-wide club analysis at `/clubs/`. Without this the new regatta never appears under any club.
4. **Add the page to `sitemap.xml`** as `https://rowingtools.co.uk/leaderboards/<comp>/`.
5. **Refresh club aliases** - run `python scripts/gen_alias_review.py`, read the "Near-duplicate candidates" in `club_aliases_review.md`, and add any genuine same-club duplicates to `data/club_aliases.json` (keyed by the lowercased canonical form). Event-specific scrapers that pull abbreviated club names (e.g. time-team.nl: "Bath Univ", "Kingston GS") often need a few. Re-run the review to confirm they merged.
6. **Review locally and push.** Optionally run Stage 4 for carousel slides.

### Race conditions (weather feature)

Each heatmap row has a clickable time chip that opens the wind/water/weather for that
race (live from the Open-Meteo historical archive); club profiles and the Result
Leaderboard reuse the same popup. To make this work for a new regatta:

- **Map the comp to its course** in `gmt_processor/inputs/courses.py`: add an entry to
  `COMP_VENUE` (`"<comp>": "<course-key>"`). If it is a new venue, add it to `COURSES`
  with `lat`, `lon`, `bearing` (compass heading the boats travel start->finish, measured
  in Google Earth - draw start->finish), and `lanes`. The four courses are already
  defined: `dorney`, `reading`, `holme`, `albert`.
- **The scrapers do the rest automatically:** each generator captures the per-race start
  `clock` ("HH:MM"), emits `window.ROWS`/`window.META`, and includes
  `conditions.js` (the shared widget). Nothing else to wire on the page.
- **Multi-day events** (e.g. BRCC, NSR): each race also carries its own `date`. For
  rowresults (`generate_heatmap.py`) the weekday->date map lives in `COMP_DATES`; for
  time-team scrapers it is derived from the `Fri/Sat/Sun` prefix in the race header. If a
  source omits the time for some races, those rows simply have no chip (graceful).
- **Sources without a clock time-of-day** (Wallingford via wallingford-regatta.org /
  didwewin) get no chip - everything else still works.
- **build_all_results.py** also reads `clock`/`date` from each heatmap and `venue` from
  `courses.py`, so re-running it (step 3) is what powers the popup on club profiles.
- **BRCC has no auto-title** - regenerate it with
  `--title "British Rowing Club Championships 2025"` (rowresults `make_title` only knows Met).

Result sources by path:

- **Path A - rowresults.co.uk:** Stage 3a with the comp code
- **Path B - Google Sheets:** export CSV, run Stage 3b
- **Path C - wallingford-regatta.org.uk:** Stage 3c
- **Path D - didwewin.info:** Stage 3d
- **Path E - event-specific scraper:** dedicated script for that regatta (see table above)

---

## Path E detail: regatta.time-team.nl

Used for NSR 2026, Nottingham 2026, Poplar 2026. Each scraper is event-specific (events are hardcoded as UUIDs). The general pattern for writing a new one:

**Site structure:**

- Events list: `https://regatta.time-team.nl/<comp>/results/events.php`
  - Each event links to `<UUID>.php` (e.g. `ea5694d44-a0f9-4f8b-95db-e93a14b7f243.php`)
- Clubs list: `https://regatta.time-team.nl/<comp>/results/clubs.php`
  - Table of code -> full club name; scrape this once to build your lookup dict
- Event page: `https://regatta.time-team.nl/<comp>/results/<UUID>.php`
  - Single page shows full progression: Time Trial -> Repechages -> Semifinals -> Finals
  - Each race is headed by an `<h2>` like `"Sat, 16:42 - Race 264Q - 3rd 8+ (Open) Final A"`
  - Finals are identified by `Final [A-Z]` in the h2 text

**Table structure (race pages):**

Headers: `pos. | code | crewstroke | lane | 500m | 1000m interval | 1500m interval | finish interval | difference`

Critically, the rendered table has more cells than headers - a rank column `(1)`, `(2)` etc. is interleaved after each split time. So headers give 9 logical columns but rows have 13 cells. **Do not use header-based indexing for the finish time.** Instead, scan cells right-to-left for the last cell matching `^\d+:\d{2}\.\d+$`.

Each result row is followed by a sub-row (empty pos cell) containing the stroke name (crew boats) or club name (sculls). Skip sub-rows by checking `int(cells[0])` fails.

**Club name resolution:**

For crew boats, `cells[2]` contains `"Club Name [Letter] / Stroke Name"`. For sculls, `cells[2]` contains the athlete name only. Rather than parsing the crew column, use the clubs lookup: `CLUBS.get(code, code)` where `code = cells[1]`. This is reliable for both boat types and avoids the entry-letter stripping problem entirely.

**Writing a new scraper:**

1. Fetch `events.php` and extract UUIDs for the events you want (browser devtools or WebFetch)
2. Fetch `clubs.php` and hardcode the code->name dict
3. Copy `generate_heatmap_nsr26.py` as a template - replace the `EVENTS` list, update `--comp` and `--title` defaults
4. Run and check output for missing events or zero-crew finals

**Gotcha - apostrophe in title:**

If the regatta title contains an apostrophe (e.g. "National Schools' Regatta"), it will break the JS `downloadCompare` function which embeds the title inside a single-quoted JS string. Fix in `generate_html`:

```python
js_title = title.replace("'", "\\'")
# then use {js_title} instead of {title} in the downloadCompare SVG text node
```

**Gotcha - Top 250 Results must preserve original rank when filtering:**

When filtering by club, the `#` column must show the rank in the full unfiltered list, not re-number from 1. Assign ranks before filtering:

```javascript
entries.sort((a,b)=>b.pct-a.pct);
entries.forEach((e,i)=>e.rank=i+1);  // assign BEFORE filter
const filtered=clubQ?entries.filter(e=>...):entries;
filtered.slice(0,250).forEach((e)=>{  // no i parameter
    // use e.rank, not i+1
});
```
