# Rowing Tools

**[rowingtools.co.uk](https://rowingtools.co.uk)** - GMT% calculator and performance-analysis tools for UK club rowing.

GMT% ("Gold Medal Time" percentage) = `world best time / your time × 100`. It is always ≤ 100% for a standard event and lets you compare performances across boat classes and regattas on one scale. The site benchmarks crews against four references: **WBT** (World Best Time), **Met** (Metropolitan Regatta championship average), **HRR** (Henley Royal Regatta fastest non-qualifier) and **HWR** (Henley Women's Regatta championship winner).

This README is the single source of truth for the repo's structure, architecture and tooling. It is reference documentation only - no roadmap or todo lists.

---

## Quick start (for a new developer)

The **public website is static** - HTML, CSS and vanilla JS, no build step, no framework, no backend. To work on it:

```bash
git clone <repo-url>
cd RowingTools
# serve the folder so clean URLs and fetch() work (file:// will not):
python -m http.server 8000
# open http://localhost:8000
```

That's all you need for front-end work. Edit a file, refresh, done. Deploy by pushing to `main` - GitHub Pages redeploys in ~30s.

The **Python tools in `gmt_processor/` are local-only** - they generate the data and the regatta pages, and are never deployed. They split into three dependency tiers; install only what you need:

```bash
# Henley live-update / lightweight scrapers (also what the GitHub Action uses)
pip install -r requirements.txt            # requests, Pillow

# The full results scraper (Stage 2, uses the Claude API + Selenium)
pip install -r gmt_processor/requirements.txt   # anthropic, requests, beautifulsoup4, selenium, pandas
#   plus ChromeDriver matching your Chrome: https://googlechromelabs.github.io/chrome-for-testing/

# Social-media carousel image generation (Stage 4)
pip install playwright && playwright install chromium
```

The two big recurring jobs are documented in full below: [**publishing a new regatta**](#workflow-publishing-a-new-regatta) and [**updating Henley during the regatta**](#workflow-henley-live-update). Read those before touching the data tools.

---

## The site: four public tools

| Tool | URL | What it is |
| ---- | --- | ---------- |
| **GMT% Calculator** | `/gmt/` | Type in crew times, get GMT% vs WBT / Met / HRR / HWR. Sortable, CSV export, benchmark reference tabs. |
| **Leaderboards** | `/leaderboards/` | Index of every regatta we've covered, plus per-regatta pages (`/leaderboards/<comp>/`) with four tabs: Heatmap, Top 250 Results, Club Leaderboard, Club Compare. |
| **Club Profiles** | `/clubs/` | Cross-regatta view: browse/search clubs, a season club ranking, and a per-club profile (`/clubs/?club=<name>`) aggregating every result that club has across all regattas. |
| **Henley** | `/henley/` | Standalone Henley Royal Regatta daily leaderboards - crews ranked by raw time, % of course record, and % of WBT, with year/day tabs that appear automatically as data lands. |

All four are reachable from the landing page at `/`.

---

## Repo structure

```text
RowingTools/
│
├── index.html                  # Landing page - cards linking to the four tools
├── assets/
│   ├── app.css                 # Shared styles for /, /gmt/, /leaderboards/ (index), /clubs/
│   └── app.js                  # Shared script (GMT calc, club analysis, subscribe form)
│
│   ── PUBLIC PAGES (clean URLs via folder + index.html) ──
├── gmt/index.html              # /gmt/        GMT% calculator
├── leaderboards/index.html     # /leaderboards/   regatta index + season club ranking
├── leaderboards/<comp>/index.html   # /leaderboards/<comp>/   one regatta (e.g. marlow26, brcc25)
├── clubs/index.html            # /clubs/      club directory + per-club profile (?club=)
├── henley/index.html           # /henley/     Henley daily leaderboards
├── henley/methodology/index.html    # /henley/methodology/   how the Henley rankings work
├── henley/post/index.html      # Instagram-post generator for Henley (noindex, unlisted)
│
│   ── REDIRECT STUBS (old indexed URLs → new clean URLs; do not 404) ──
├── heatmap-*.html              # → /leaderboards/<comp>/   (one per regatta)
├── clubs.html                  # → /clubs/
│
│   ── DATA (loaded by the site via fetch, and written by the Python tools) ──
├── data/
│   ├── benchmarks_v1.json      # Frozen 2025-03-24 (WBT, Met avg, HRR)
│   ├── benchmarks_v2.json      # Frozen (adds HWR)
│   ├── benchmarks_v3.json      # CURRENT (adds Met A/B/C final benchmarks)
│   ├── all_results.json        # Every regatta's results, flattened - powers /clubs/
│   ├── club_aliases.json       # Canonical club-name merge map
│   ├── henley_records.json     # HRR course-record progression (Barrier/Fawley/Finish)
│   ├── henley_2025.json        # All HRR 2025 races
│   └── henley_2026.json        # All HRR 2026 races (filled live during the regatta)
│
│   ── PWA / hosting plumbing ──
├── manifest.json               # PWA manifest (installable app)
├── sw.js                       # Service worker (network-first cache)
├── icons/                      # PWA / Android launcher icons (192, 512, maskable-512)
├── .well-known/assetlinks.json # Android TWA app-link verification
├── conditions.js               # "Race conditions" weather widget (shared, see below)
├── rowingtools-share.js        # Share-as-PNG cards for results / clubs (shared)
├── favicon.svg, robots.txt, sitemap.xml, .nojekyll, CNAME   # hosting config
│
│   ── PYTHON TOOLS (local only, never deployed) ──
├── requirements.txt            # Lightweight deps (Henley scraper, icon gen)
├── gmt_processor/
│   ├── requirements.txt        # Full scraper deps (anthropic, selenium, ...)
│   ├── gmt_processor.py        # Stage 1: CSV in → ranked GMT% table out
│   ├── benchmarks.py           # Loads data/benchmarks_vN.json (shared by Python + site)
│   └── inputs/
│       ├── scraper.py                       # Stage 2: URL → results CSV (Claude API extraction)
│       ├── generate_heatmap*.py             # Stage 3: results source → regatta page (see table)
│       ├── build_all_results.py             # Rebuilds data/all_results.json from the regatta pages
│       ├── courses.py                        # Venue registry (lat/lon/bearing) + comp→venue map
│       ├── scrape_henley.py                  # HRR scraper → data/henley_*.json + henley_records.json
│       ├── met_finals_scraper.py            # Benchmark updater (Met A/B/C finals)
│       ├── met_finals_data.json             # Its output, staged for the next benchmarks version
│       ├── generate_carousel.py             # Stage 4: regatta page → Instagram carousel PNGs
│       ├── generate_season_carousel.py      # Season top-10-clubs carousel PNGs
│       ├── carousel-*.html                   # Carousel slide templates
│       ├── run_mets*26_carousel.py          # One-off carousel drivers (per-regatta examples)
│       ├── update_heatmap_styles.py         # One-off: bulk restyle of heatmap pages
│       ├── update_heatmap_animations.py     # One-off: inject count-up animations
│       └── brcc25_scraper.py                # One-off: BRCC 2025 data patch
│
├── scripts/
│   ├── gen_alias_review.py      # Finds near-duplicate club names → club_aliases_review.md
│   └── generate_app_icons.py   # Renders the PWA icons in icons/
├── normalize_slides.py         # One-off: pad screenshots to Instagram aspect ratios
│
├── club_aliases_review.md      # Generated review output (from gen_alias_review.py)
└── henley/UPDATE.md            # Step-by-step Henley live-update guide (read for that job)
```

Gitignored (local only, not in the repo): `gmt_processor/outputs/`, `exhibits/` (carousel PNG output), `__pycache__/`.

---

## Architecture

**Static multi-page app on GitHub Pages.** Each tool is a folder with an `index.html`, served at a clean URL (`/gmt/`, `/leaderboards/`, `/clubs/`, `/henley/`). `.nojekyll` disables Jekyll; `CNAME` pins the custom domain. There is no server and no build step - what's in the repo is what ships.

**Three layers of HTML:**

1. **Shared-shell pages** (`/`, `/gmt/`, `/leaderboards/` index, `/clubs/`) pull in `assets/app.css` + `assets/app.js`.
2. **Per-regatta pages** (`/leaderboards/<comp>/index.html`) are **self-contained** - each is a single generated file with its own inline CSS/JS plus the shared `conditions.js` and `rowingtools-share.js`. They are produced by the Stage 3 generators, not hand-edited.
3. **Redirect stubs** - the old `heatmap-<comp>.html` and `clubs.html` paths are tiny meta-refresh + `location.replace` files pointing at the new clean URLs, so previously-indexed links never 404. They forward `location.search`/`hash` too.

**PWA.** `manifest.json` makes the site installable; `sw.js` is a network-first service worker (cache name `rowingtools-v1`, falls back to cache then to `/` offline) registered inline on the main pages. `icons/` and `.well-known/assetlinks.json` support an Android Trusted Web Activity wrapper.

**Data flow.** The site reads JSON from `data/` at runtime via `fetch()`. Those files are produced by the Python tools and committed. The site never computes benchmarks itself - it reads them.

```
results source ──Stage 2/3──▶ leaderboards/<comp>/index.html ──build_all_results.py──▶ data/all_results.json ──▶ /clubs/
HRR site ───────scrape_henley.py──▶ data/henley_*.json ──▶ /henley/
rowresults ─────met_finals_scraper.py──▶ benchmarks_v(N+1).json ──▶ /gmt/ + all GMT% calcs
```

---

## Data files reference

| File | Written by | Read by | Shape |
| ---- | ---------- | ------- | ----- |
| `benchmarks_vN.json` | `met_finals_scraper.py` (Met section) + manual | `/gmt/` (fetch), `benchmarks.py` | WBT / Met / HRR / HWR reference times per boat class. **Single source of truth for all GMT% maths.** |
| `all_results.json` | `build_all_results.py` | `/clubs/` | Array of regattas: `{comp, title, date, url, venue{lat,lon,bearing,lanes}, results[{crew, club, event, round, time, pct, boat, clock, date}]}`. |
| `club_aliases.json` | manual (guided by `gen_alias_review.py`) | `build_all_results.py`, `/clubs/`, `/leaderboards/` | Map of canonical/lowercased club name → display name, merging spelling/abbreviation variants. |
| `henley_<year>.json` | `scrape_henley.py` | `/henley/` | Array of races: id, event, class, round, station, winner/loser, verdict, day, and `barrier`/`fawley`/`finish` split objects (`secs`, `display`, `newRecord`, `loserLeading`). |
| `henley_records.json` | `scrape_henley.py` | `/henley/` | Per-event course-record progression by timing point. **Merged, never overwritten**, so superseded records are preserved for year-baseline lookups. |

### Benchmark versioning

**Never edit an existing `benchmarks_vN.json`.** When numbers change, create `benchmarks_v(N+1).json` and point the consumers at it. This keeps every published page reproducible.

**Each version is purely additive** - a new version only *adds* benchmark sections, it never changes or removes existing ones. The `wbt` / `met_raw` / `hrr_raw` numbers are byte-for-byte identical across v1, v2 and v3, so a page that still loads v1 computes exactly the same GMT% as one loading v3.

| Version | Keys (top-level) | What's new | Status |
| ------- | ---------------- | ---------- | ------ |
| v1 | `wbt`, `met_raw`, `hrr_raw` | Baseline - World Best Times, Met championship averages, HRR fastest non-qualifier | Frozen 2025-03-24 |
| v2 | + `hwr_raw` | Adds HWR - Henley Women's Regatta championship winning times (women's benchmark) | Frozen |
| v3 | + `met_a_slowest`, `met_b_slowest`, `met_c_slowest` | Adds Met final-depth benchmarks - 2nd-slowest finisher in each of the A/B/C finals (tier reference points below the championship average; produced by `met_finals_scraper.py`) | **Current** |

The site fetches `benchmarks_v3.json` directly. `benchmarks.py` defaults to `v1` for backward compatibility - pass the filename (`load_benchmarks('benchmarks_v3.json')`) when using it for current work.

---

## Python tools

### Stage 1 - `gmt_processor.py`
Standard-library only. Takes a CSV of results (`label, time, boat_class, henley_event?`), computes GMT% against every benchmark, prints a ranked table. `--input`, `--output`, `--top`, `--sample`. The reference implementation of the GMT% maths; the website mirrors it in JS.

### Stage 2 - `scraper.py`
Points at a results URL, fetches the page (Selenium for JS-rendered sites like rowresults.co.uk - needs ChromeDriver), and uses the **Claude API** (`anthropic`) to extract the finals into a clean CSV. Used when there's no structured feed to parse. Requires the full `gmt_processor/requirements.txt`.

### Stage 3 - heatmap / regatta-page generators
Each writes a complete self-contained `leaderboards/<comp>/index.html` (four tabs: Heatmap, Top 250 Results, Club Leaderboard, Club Compare) and takes `--comp`, `--title`, `--out`. Pick the generator by **where the results live**:

| Generator | Results source |
| --------- | -------------- |
| `generate_heatmap.py` | rowresults.co.uk JSON API |
| `generate_heatmap_sheet.py` | A Google Sheets export CSV |
| `generate_heatmap_wallingford.py` | wallingford-regatta.org.uk HTML tables |
| `generate_heatmap_didwewin.py` | didwewin.info |
| `generate_heatmap_nottm26.py` / `_poplar26.py` / `_nsr26.py` / `_marlow25.py` / `_marlow26.py` | regatta.time-team.nl (event UUIDs hardcoded per regatta) |
| `generate_heatmap_reading26.py` | reading-amateur-regatta.org (head-to-head, winners-only, 1500m) |
| `generate_heatmap_bucs.py` | results.bucsrowing.org.uk |

The time-team.nl and head-to-head sources each have their own quirks - see [Source-specific notes](#source-specific-notes-and-gotchas).

### `build_all_results.py`
Reads each regatta page listed in its `HEATMAPS` array (`comp`, `date`), pulls the embedded `window.ROWS`/`window.META`, normalises club names (via `club_aliases.json`), attaches the venue from `courses.py`, and writes `data/all_results.json`. **This is what makes a regatta appear under `/clubs/`** - the list is hardcoded, not auto-discovered, so a new regatta must be added here.

### `courses.py`
No CLI - imported by the generators and `build_all_results.py`. Holds `COURSES` (each venue's `lat`, `lon`, `bearing` = compass heading boats travel start→finish, and `lanes`) and `COMP_VENUE` (comp code → venue key). Powers the race-conditions weather widget. Four venues defined: `dorney`, `reading`, `holme`, `albert`.

### `scrape_henley.py`
Scrapes HRR results and course records from hrr.co.uk. `--year <YYYY>` (default 2025); `--results-only` skips the records fetch and writes only `data/henley_<year>.json` (used by the GitHub Action so it never clobbers `henley_records.json`). Records are **merged** with the existing file. Idempotent and read-only against HRR. Full operational guide: [`henley/UPDATE.md`](henley/UPDATE.md).

### `met_finals_scraper.py`
Scrapes Met A/B/C final results across years from rowresults.co.uk and emits `met_finals_data.json` - the depth benchmarks (2nd-slowest finisher per final, per boat class) ready to paste into the next `benchmarks_v(N+1).json`.

### Stage 4 - carousels & social images
- `generate_carousel.py` - regatta page → Instagram carousel PNGs (810×1440) into `exhibits/<comp>/`, via Playwright + `carousel-template-final.html`. `--comp <code>` or `--html <file>`.
- `generate_season_carousel.py` - season top-10-clubs carousel via `carousel-season-template.html`. `--year <YY>`.
- `carousel-henley-feature-template.html` - the Henley feature carousel template (driven from `henley/post/`).
- `run_metsat26_carousel.py` / `run_metsun26_carousel.py` - one-off per-regatta drivers; useful as worked examples of feeding custom top-5 data into `generate_carousel.py`.
- `normalize_slides.py` (repo root) - pads a folder of screenshots to a fixed Instagram aspect ratio (`--fill`, `--square`, `--bg`, `--width`).

### `scripts/`
- `gen_alias_review.py` - reads `all_results.json` + `club_aliases.json`, flags near-duplicate club names (string similarity), writes `club_aliases_review.md`. Run it after ingesting a new regatta; eyeball the candidates and add genuine duplicates to `club_aliases.json`.
- `generate_app_icons.py` - renders the PWA icons in `icons/` from the brand mark (Pillow). One-off, re-run only after a brand/icon change.

### One-off / historical utilities
`update_heatmap_styles.py`, `update_heatmap_animations.py` (bulk edits applied during past redesigns) and `brcc25_scraper.py` (a data patch) are kept for reference but are **not part of the routine workflow**.

---

## Workflow: publishing a new regatta

Do **all** of these. Steps 3-5 are easy to forget and the site-wide club pages break silently without them.

1. **Generate the regatta page** - run the right [Stage 3 generator](#stage-3---heatmap--regatta-page-generators). It writes `leaderboards/<comp>/index.html` (clean URL `/leaderboards/<comp>/`), creating the folder if needed.
2. **Add a card** to the `.lb-grid` in `leaderboards/index.html`. **Newest on top within its year section** (linking `/leaderboards/<comp>/`).
3. **Rebuild the club dataset** - add the comp (`comp`, `date`) to the `HEATMAPS` list in `build_all_results.py`, then run it. This regenerates `data/all_results.json`, which powers `/clubs/`. **Skip this and the regatta never appears under any club.**
4. **Add the page to `sitemap.xml`** as `https://rowingtools.co.uk/leaderboards/<comp>/`.
5. **Refresh club aliases** - run `python scripts/gen_alias_review.py`, read the near-duplicate candidates in `club_aliases_review.md`, add genuine same-club duplicates to `data/club_aliases.json` (keyed lowercased), and re-run to confirm they merged. Abbreviated sources (time-team.nl) usually need a few.
6. **Review locally and push.** Optionally run Stage 4 for carousel slides.

### Race conditions (weather) on a new regatta
Each heatmap row has a clickable time chip opening that race's wind/water/weather (Open-Meteo historical archive); `/clubs/` and the Result Leaderboard reuse the same popup (`conditions.js`).

- **Map the comp to its course** in `courses.py`: add `COMP_VENUE["<comp>"] = "<course-key>"`. New venue? Add it to `COURSES` with `lat`, `lon`, `bearing` (start→finish heading, measured in Google Earth) and `lanes`.
- **The generators do the rest** - each captures the per-race `clock` ("HH:MM"), emits `window.ROWS`/`window.META`, and includes `conditions.js`. Nothing else to wire.
- **Multi-day events** carry a per-race `date` (rowresults uses a `COMP_DATES` weekday→date map; time-team derives it from the `Fri/Sat/Sun` race-header prefix). Sources with no time-of-day (Wallingford) simply get no chip - everything else still works.
- Re-running `build_all_results.py` (step 3) is what powers the popup on `/clubs/` (it reads `clock`/`date` from the page and `venue` from `courses.py`).
- **BRCC has no auto-title** - regenerate with `--title "British Rowing Club Championships 2025"`.

---

## Workflow: Henley live update

Fully documented in [`henley/UPDATE.md`](henley/UPDATE.md). In short:

- **One command:** `python gmt_processor/inputs/scrape_henley.py --year 2026`, then commit + push. The page auto-detects which years have data, so a new year's tab appears with no HTML edit. Run it **after** the day's racing (the HRR page fills in live).
- **Automated:** `.github/workflows/henley-2026.yml` runs the scraper every 10 min (06:00-19:50 UTC) on the HRR 2026 race days (Tue 30 Jun - Sun 5 Jul 2026), committing **only** `data/henley_2026.json`. A date-guard makes it a no-op outside that window; trigger manually any time via the Actions tab (`workflow_dispatch`). **Scheduled Actions only run from `main`** - the feature and workflow must be on `main` before the regatta.
- **From a phone:** Claude Code on the web with full network access and `pip install -r requirements.txt` - give it the one command above. See UPDATE.md for the cloud-environment setup.

---

## Workflow: updating benchmarks

1. Run `met_finals_scraper.py` (and gather any new WBT/HRR/HWR figures).
2. Copy the current `benchmarks_v3.json` to `benchmarks_v4.json` and merge the new numbers in. **Do not edit v3.**
3. Point **all** the consumers at v4 - it's easy to miss one:
   - the `fetch()` URL in `/gmt/`
   - the `fetch('/data/benchmarks_v3.json')` in `henley/index.html` (the Henley "% of WBT" tab reads its WBTs from here, not from the scraper)
   - any Python call to `load_benchmarks(...)`
4. Update the version table in this README.

---

## Source-specific notes and gotchas

**Club-name filtering must use exact match (`===`), never substring.** In every heatmap's JS, club filters (heatmap dim, Top Results, Club Compare, CSV export) must compare `e.club.toLowerCase() === clubQ`, not `.includes(clubQ)` - otherwise "Marlow" also matches "Great Marlow School". (The event-name filter `r.event.includes(q)` is intentionally substring.)

**Trailing entry-letter stripping.** Scrapers that read club names from result *text* (not a code lookup) must strip a trailing entry letter: `re.sub(r'\s+[A-Z]$', '', raw).strip()`, on **every** code path (crew boats *and* sculls), and `normClub` in the page JS must match. The time-team.nl scrapers avoid this entirely by using the `clubs.php` code→name lookup.

**time-team.nl table parsing.** Rendered rows have more cells than the headers imply - a rank column `(1)`,`(2)` is interleaved after each split. Do **not** index the finish time by header position; scan cells right-to-left for the last one matching `^\d+:\d{2}\.\d+$`. Each result row is followed by a sub-row (empty pos cell) for the stroke/club name - skip it where `int(cells[0])` fails. Resolve clubs via `CLUBS.get(code, code)` (from `clubs.php`), not by parsing the crew column.

**Apostrophe in a title** (e.g. "National Schools' Regatta") breaks the JS `downloadCompare` (title embedded in a single-quoted string). In `generate_html`, build `js_title = title.replace("'", "\\'")` and use it inside the SVG text node.

**Top 250 must keep its original rank when filtered.** Assign ranks before filtering, not after:

```javascript
entries.sort((a,b)=>b.pct-a.pct);
entries.forEach((e,i)=>e.rank=i+1);          // BEFORE the filter
const filtered = clubQ ? entries.filter(...) : entries;
filtered.slice(0,250).forEach((e)=>{ /* use e.rank, never i+1 */ });
```

**No defensive catch-all exception handling** in the Python tools. Catch specific, expected exceptions only - a noisy crash beats silently-wrong data.

---

## Deployment

Push to `main`. GitHub Pages serves the repo root at `rowingtools.co.uk` (via `CNAME`) and redeploys in ~30s. There is nothing to build. The Henley GitHub Action is the only automation that writes to the repo, and it only ever commits `data/henley_2026.json`.
