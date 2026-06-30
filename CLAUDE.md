# RowingTools

Static site served by GitHub Pages (no build step, no framework). Personal project.

## Live Henley Royal Regatta results — ACTIVE 30 Jun – 5 Jul 2026

The page at **rowingtools.co.uk/henley** (`henley/index.html`) shows live HRR results during the
regatta. It is kept up to date by re-running a scraper that overwrites **`data/henley_2026.json`**.

**To scrape new results and update the live site, follow [henley/MOBILE_OPS.md](henley/MOBILE_OPS.md).**
That file has the exact prompts for doing this from a phone, plus what's already automated.

The single operation is:

```bash
python gmt_processor/inputs/scrape_henley.py --year 2026 --results-only
```

then commit **only** `data/henley_2026.json` and push to `main`. GitHub Pages auto-deploys; no HTML
or other files need editing. If the scrape yields no change, nothing is committed (that's correct).

Hands-off updates already run via a scheduled cloud routine (hourly) and the GitHub Actions schedule
— see MOBILE_OPS.md. Manual scraping is only needed for fresher-than-hourly updates.

> After 5 July 2026 this section is dormant; the scraper/workflow are no-ops outside the regatta.
