# Rowing Tools

**rowingtools.co.uk** - GMT% calculator and performance analysis tools for UK club rowing.

---

## Repo structure

```
RowingTools/
│
├── index.html                          # Public website (GitHub Pages)
│
├── data/
│   ├── benchmarks_v1.json              # Frozen 2025-03-24
│   └── benchmarks_v2.json              # Current - add HWR, loaded by index.html
│
├── gmt_processor/
│   ├── gmt_processor.py                # Stage 1: CSV in, ranked GMT table out
│   ├── benchmarks.py                   # Loads benchmark data from data/
│   ├── requirements.txt
│   ├── inputs/
│   │   ├── scraper.py                  # Stage 2: URL in, results fetched + processed
│   │   └── testinputset1.csv           # Test input data
│   └── outputs/                        # Local only (gitignored)
│
└── CNAME                               # rowingtools.co.uk domain config
```

---

## Architecture

### Single source of truth

All benchmark data lives in `data/benchmarks_vN.json`. Both tools load from it:

- `index.html` fetches it at load time via `fetch('data/benchmarks_v2.json')`
- `gmt_processor/benchmarks.py` reads it from disk at runtime

**Never edit benchmark numbers directly in index.html or benchmarks.py.**
Edit the JSON only. Both tools update automatically.

### Benchmark versioning

When benchmark data needs updating (e.g. adding 2026 Met results or new HWR years), create a new
`data/benchmarks_v3.json` - never edit the current version. This keeps historical scores reproducible.
The version is recorded in the JSON `_meta` block.

### Benchmark data - what's in v2

| Section | What it is | Distance | Years |
| ------- | ---------- | -------- | ----- |
| `wbt` | World Best Times (World Rowing official) | 2000m | all-time |
| `met_raw` | Met Regatta championship A-final winning times | 2000m | 2021-2025 (no 2024) |
| `hrr_raw` | Henley Royal Regatta fastest non-qualifying times | 2112m → scaled to 2000m | 2021-2025 |
| `hwr_raw` | Henley Women's Regatta championship winning times | 1500m → scaled to 2000m | 2022-2025 |

HRR times are scaled by `× 2000/2112`. HWR times are scaled by `× 2000/1500`.
HWR 2021 is excluded - that year used a shortened course due to pandemic construction.

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

### Stage 1 - gmt_processor.py (complete)

Takes a CSV of results, calculates GMT%, outputs ranked table.

```bash
python gmt_processor.py --sample
python gmt_processor.py --input inputs/testinputset1.csv --output outputs/top100.csv --top 100
python gmt_processor.py --input inputs/results.csv --sort met_pct
```

### Stage 2 - scraper.py (written, needs local setup)

Points at a URL, fetches results, extracts finals via Claude API, pipes through GMT.

```bash
# Set your API key first
export ANTHROPIC_API_KEY=your_key_here

# Wallingford (static HTML - no Chrome needed)
python inputs/scraper.py --url "https://wallingford-regatta.org.uk/results/" --output inputs/wallingford_2025.csv

# Met Saturday (rowresults - needs ChromeDriver)
python inputs/scraper.py --url "https://rowresults.co.uk/metsat25" --top 100

# Nottingham (Google Sheets)
python inputs/scraper.py --url "https://docs.google.com/spreadsheets/d/1AUep12yygXKtKwin1ytBl-dDzepKbWnf2Hu7SweHAgQ/edit"
```

**Local setup for Stage 2:**
```bash
pip install anthropic requests beautifulsoup4 selenium pandas
# For rowresults only: install ChromeDriver matching your Chrome version
# https://googlechromelabs.github.io/chrome-for-testing/
```

---

## Workflow: post-regatta GMT analysis

1. Run `python inputs/scraper.py --url <regatta_url> --output inputs/results.csv`
2. Review CSV, correct any misclassified boat classes
3. Run `python gmt_processor.py --input inputs/results.csv --top 10` to get top performances
4. Write up as a post and publish on the site or share via social

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
- [x] HTML loads benchmarks from JSON (consistency loop closed)
- [x] Benchmark versioning architecture in place
- [x] HWR as fourth benchmark (W8+, W4-, W2-, W4x, W2x, W1x, 2022-2025 avg, 1500m→2000m)

### Next
- [ ] Set up Namecheap email forwarding (feedback@rowingtools.co.uk -> personal Gmail)
- [ ] Install scraper.py dependencies locally and test against Wallingford URL
- [ ] Test scraper.py against rowresults (needs ChromeDriver)
- [ ] Run Met 2025 through processor on regatta day, publish top GMT post
- [ ] Add 2026 Met data to benchmarks_v3.json once available
- [ ] Head race converter (next tool - different distances, same logic)
- [ ] Henley eligibility checker (pure logic, no data needed)

### Future / subscription tier

- [ ] Regatta leaderboard section - blog-style pages showing GMT% rankings per regatta
- [ ] Performance tracking over time (requires accounts + storage)
- [ ] Club dashboard (coach sees all crews GMT trend across a season)
