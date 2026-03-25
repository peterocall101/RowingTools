# Rowing Tools

**rowingtools.co.uk** - GMT% calculator and performance analysis tools for UK club rowing.

---

## Repo structure

```
rowing-tools/
│
├── index.html                      # Public website (GitHub Pages)
│
├── data/
│   └── benchmarks_v1.json          # Single source of truth for all benchmark data
│
├── gmt_processor/
│   ├── gmt_processor.py            # Stage 1: CSV in, ranked GMT table out
│   ├── benchmarks.py               # Loads from benchmarks_v1.json
│   ├── scraper.py                  # Stage 2: URL in, results fetched + processed
│   ├── sample_results.csv          # Test data
│   └── requirements.txt
│
└── outputs/                        # Local only - CSV outputs from processor runs
```

---

## Architecture

### Single source of truth

All benchmark data lives in `data/benchmarks_v1.json`. Both tools load from it:

- `index.html` fetches it at load time via `fetch('data/benchmarks_v1.json')`
- `gmt_processor/benchmarks.py` reads it from disk at runtime

**Never edit benchmark numbers directly in index.html or benchmarks.py.**
Edit the JSON only. Both tools update automatically.

### Benchmark versioning

When benchmark data needs updating (e.g. adding 2026 Met results), create a new
`data/benchmarks_v2.json` — never edit v1. This keeps historical scores reproducible.
The version is recorded in the JSON `_meta` block and in each output CSV.

---

## Tool 1 - index.html (public website)

Hosted on GitHub Pages at rowingtools.co.uk. Static, no backend, no API calls.

**Features:**
- Enter multiple results and calculate GMT% against WBT, Met avg, Henley qual.
- Toggle which benchmarks to show
- Sort by any metric
- Download results as CSV

**Deploy:** Push `index.html` to main branch. GitHub Pages redeploys in ~30s.

---

## Tool 2 - gmt_processor (local Python, never deployed)

Run locally to process bulk results and generate ranked tables for publishing.

### Stage 1 - gmt_processor.py (complete)

Takes a CSV of results, calculates GMT%, outputs ranked table.
No external dependencies beyond Python standard library.

```bash
python gmt_processor.py --sample
python gmt_processor.py --input results.csv --output top100.csv --top 100
python gmt_processor.py --input results.csv --sort met_pct
```

### Stage 2 - scraper.py (written, needs local setup)

Points at a URL, fetches results, extracts finals via Claude API, pipes through GMT.

```bash
# Set your API key first
export ANTHROPIC_API_KEY=your_key_here

# Wallingford (static HTML - no Chrome needed)
python scraper.py --url "https://wallingford-regatta.org.uk/results/" --output wallingford_2025.csv

# Met Saturday (rowresults - needs ChromeDriver)
python scraper.py --url "https://rowresults.co.uk/metsat25" --top 100

# Nottingham (Google Sheets)
python scraper.py --url "https://docs.google.com/spreadsheets/d/1AUep12yygXKtKwin1ytBl-dDzepKbWnf2Hu7SweHAgQ/edit"
```

**Local setup for Stage 2:**
```bash
pip install anthropic requests beautifulsoup4 selenium pandas
# For rowresults only: install ChromeDriver matching your Chrome version
# https://googlechromelabs.github.io/chrome-for-testing/
```

---

## Workflow: post-regatta GMT analysis

1. Run `scraper.py --url <regatta_url> --output results.csv`
2. Review CSV, correct any misclassified boat classes
3. Run `gmt_processor.py --input results.csv --top 10` to get top performances
4. Write up as a post and publish on the site or share via social

---

## Progression steps

### Done
- [x] GMT calculator HTML tool (WBT, Met, Henley benchmarks)
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
- [x] benchmarks_v1.json as single source of truth
- [x] HTML loads benchmarks from JSON (consistency loop closed)
- [x] Benchmark versioning architecture in place

### Next
- [ ] Set up Namecheap email forwarding (feedback@rowingtools.co.uk -> personal Gmail)
- [ ] Install scraper.py dependencies locally and test against Wallingford URL
- [ ] Test scraper.py against rowresults (needs ChromeDriver)
- [ ] Run Met 2025 through processor on regatta day, publish top GMT post
- [ ] Head race converter (next tool - different distances, same logic)
- [ ] Henley eligibility checker (pure logic, no data needed)

### Future / subscription tier
- [ ] Performance tracking over time (requires accounts + storage)
- [ ] Club dashboard (coach sees all crews GMT trend across a season)
- [ ] benchmarks_v2.json once 2026 Met data available
