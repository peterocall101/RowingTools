# Rowing Tools

**rowingtools.co.uk** - GMT% calculator and performance analysis tools for UK club rowing.

---

## Repo structure

```text
RowingTools/
│
├── index.html                          # Public website (GitHub Pages)
├── heatmap-metsat25.html               # Met 2025 Saturday - regatta analysis page
├── heatmap-metsun25.html               # Met 2025 Sunday - regatta analysis page
├── heatmap-demo.html                   # Test/demo output from generate_heatmap.py
│
├── data/
│   ├── benchmarks_v1.json              # Frozen 2025-03-24
│   ├── benchmarks_v2.json              # Frozen - adds HWR benchmark
│   └── benchmarks_v3.json              # Current - adds Met A/B/C final benchmarks
│
├── gmt_processor/
│   ├── gmt_processor.py                # Stage 1: CSV in, ranked GMT table out
│   ├── benchmarks.py                   # Loads benchmark data from data/
│   ├── requirements.txt
│   ├── inputs/
│   │   ├── scraper.py                  # Stage 2: URL in, results fetched + processed
│   │   ├── generate_heatmap.py         # Stage 3: rowresults comp in, heatmap HTML out
│   │   ├── met_finals_scraper.py       # Benchmark updater: scrapes Met finals data
│   │   └── testinputset1.csv           # Test input data
│   └── outputs/                        # Local only (gitignored)
│
└── CNAME                               # rowingtools.co.uk domain config
```

---

## Architecture

### Single source of truth

All benchmark data lives in `data/benchmarks_vN.json`. Both tools load from it:

- `index.html` fetches it at load time via `fetch('data/benchmarks_v3.json')`
- `gmt_processor/benchmarks.py` reads it from disk at runtime

**Never edit benchmark numbers directly in index.html or benchmarks.py.**
Edit the JSON only. Both tools update automatically.

### Benchmark versioning

When benchmark data needs updating (e.g. adding 2026 Met results), create a new
`data/benchmarks_v4.json` - never edit the current version. This keeps historical scores reproducible.
The version is recorded in the JSON `_meta` block.

### Benchmark data

| Version | What changed | Status |
| ------- | ------------ | ------ |
| v1 | Initial - WBT, Met avg, HRR | Frozen 2025-03-24 |
| v2 | Adds HWR (Henley Women's Regatta) | Frozen |
| v3 | Adds Met A/B/C final benchmarks | **Current** |

**v3 sections:**

| Section | What it is | Distance | Years |
| ------- | ---------- | -------- | ----- |
| `wbt` | World Best Times (World Rowing official) | 2000m | all-time |
| `met_raw` | Met Regatta championship A-final winning times | 2000m | 2021-2025 (no 2024) |
| `hrr_raw` | Henley Royal Regatta fastest non-qualifying times | 2112m → scaled to 2000m | 2021-2025 |
| `hwr_raw` | Henley Women's Regatta championship winning times | 1500m → scaled to 2000m | 2022-2025 |
| `met_a_slowest` | 2nd-slowest A-final finisher per boat class, avg across years | 2000m | 2021-2025 (no 2024) |
| `met_b_slowest` | 2nd-slowest B-final finisher per boat class, avg across years | 2000m | 2021-2025 (no 2024) |
| `met_c_slowest` | 2nd-slowest C-final finisher per boat class, avg across years | 2000m | 2021-2025 (no 2024) |

HRR times are scaled by `× 2000/2112`. HWR times are scaled by `× 2000/1500`.
HWR 2021 is excluded - that year used a shortened course due to pandemic construction.
The 2nd-slowest (not slowest) finisher is used for met_a/b/c_slowest to guard against outliers from equipment failures.

---

## Tool 1 - index.html (public website)

Hosted on GitHub Pages at rowingtools.co.uk. Static, no backend, no API calls.

**Features:**

- Enter multiple results and calculate GMT% against WBT, Met avg, Henley qual., and HWR avg
- Toggle which benchmarks to show (WBT, Met, Henley qual., HWR)
- Sort by any metric
- Download results as CSV
- Benchmark reference tabs: WBT, Met, Henley qualification, HWR
- "What is GMT?" explainer

**Deploy:** Push `index.html` to main branch. GitHub Pages redeploys in ~30s.

---

## Tool 2 - gmt_processor (local Python, never deployed)

Run locally to process bulk results and generate ranked tables for publishing.

### Stage 1 - gmt_processor.py

Takes a CSV of results, calculates GMT%, outputs ranked table.

```bash
python gmt_processor.py --sample
python gmt_processor.py --input inputs/testinputset1.csv --output outputs/top100.csv --top 100
python gmt_processor.py --input inputs/results.csv --sort met_pct
```

### Stage 2 - scraper.py (written, needs local setup)

Points at a URL, fetches results, extracts finals via Claude API, pipes through GMT.

```bash
export ANTHROPIC_API_KEY=your_key_here

# Wallingford (static HTML - no Chrome needed)
python inputs/scraper.py --url "https://wallingford-regatta.org.uk/results/" --output inputs/wallingford_2025.csv

# Met Saturday (rowresults - needs ChromeDriver)
python inputs/scraper.py --url "https://rowresults.co.uk/metsat25" --top 100
```

**Local setup:**

```bash
pip install anthropic requests beautifulsoup4 selenium pandas
# For rowresults only: install ChromeDriver matching your Chrome version
# See: googlechromelabs.github.io/chrome-for-testing/
```

### Stage 3 - generate_heatmap.py

Fetches results directly from the rowresults.co.uk JSON API and generates a self-contained regatta analysis HTML page. No Selenium or Claude API needed.

```bash
python inputs/generate_heatmap.py --comp metsat25 --out ../../heatmap-metsat25.html
python inputs/generate_heatmap.py --comp metsun25 --out ../../heatmap-metsun25.html
```

The output HTML has four tabs:

- **Heatmap** - race-by-race grid, one column per lane, colour-coded by GMT% tier (elite / high club / competitive / developing)
- **Top 250 Results** - individual results ranked by GMT%, filterable by club
- **Club Leaderboard** - clubs ranked by average GMT% across all their entries
- **Club Compare** - dot-plot comparing selected clubs' GMT% distributions

The file is fully self-contained (no external dependencies) and can be opened locally or pushed to the repo and linked from the site.

**Competition codes** follow rowresults.co.uk naming: `metsat25` (Met 2025 Saturday), `metsun25` (Met 2025 Sunday), etc.

---

## Tool 3 - met_finals_scraper.py (benchmark data updater)

Scrapes A/B/C final results from rowresults.co.uk across multiple Met years and outputs JSON ready to paste into the next benchmarks version. No Selenium or Claude API needed.

```bash
python inputs/met_finals_scraper.py
python inputs/met_finals_scraper.py --output met_finals_data.json
python inputs/met_finals_scraper.py --include-2024
```

Outputs `met_a_slowest`, `met_b_slowest`, `met_c_slowest` sections. Paste into `data/benchmarks_vN.json` alongside the existing sections. Only Championship events are included to match `met_raw`.

---

## Workflow: post-regatta GMT analysis

1. Run `python inputs/generate_heatmap.py --comp <code> --out ../../heatmap-<code>.html`
2. Open the HTML locally to review, then push to repo to publish
3. Optionally: run `python inputs/scraper.py --url <url>` + `gmt_processor.py` for a ranked CSV to write up as a post

---

## Progression steps

### Done

- [x] GMT calculator HTML tool (WBT, Met, Henley qual., HWR benchmarks)
- [x] Benchmark tabs with searchable reference tables
- [x] Sort and reorder by any metric
- [x] CSV download
- [x] Mobile responsive layout
- [x] Dark mode
- [x] Google Analytics (G-876ELQ9529)
- [x] Google Search Console verified
- [x] Live at rowingtools.co.uk
- [x] Python Stage 1 - CSV processor with ranked output
- [x] Python Stage 2 - scraper.py written (needs local deps)
- [x] benchmarks_v1.json as single source of truth (frozen 2025-03-24)
- [x] benchmarks_v2.json - adds HWR (Henley Women's Regatta) benchmark
- [x] benchmarks_v3.json - adds Met A/B/C final benchmarks (via met_finals_scraper.py)
- [x] HTML loads benchmarks from JSON (consistency loop closed)
- [x] Benchmark versioning architecture in place
- [x] HWR as fourth benchmark (W8+, W4-, W2-, W4x, W2x, W1x, 2022-2025 avg, 1500m→2000m)
- [x] Set up Namecheap email forwarding (feedback@rowingtools.co.uk to personal Gmail)
- [x] generate_heatmap.py - self-contained regatta analysis HTML from rowresults API
- [x] Regatta analysis pages published (heatmap-metsat25.html, heatmap-metsun25.html)
- [x] met_finals_scraper.py - benchmark data updater for Met A/B/C finals

### Next

- [ ] Install scraper.py dependencies locally and test against Wallingford URL
- [ ] Test scraper.py against rowresults (needs ChromeDriver)
- [ ] Add 2026 Met data to benchmarks_v4.json once available
- [ ] Head race converter (next tool - different distances, same logic)
- [ ] Henley eligibility checker (pure logic, no data needed)

### Future / subscription tier

- [ ] Performance tracking over time (requires accounts + storage)
- [ ] Club dashboard (coach sees all crews GMT trend across a season)
