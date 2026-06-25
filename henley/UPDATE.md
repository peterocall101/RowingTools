# Updating the Henley page (e.g. daily during the regatta)

The whole update is **one command**. The page auto-detects which years have data, so adding a
new year needs no HTML edit.

## Daily update during a live regatta

Run (locally, or from a phone via Claude Code on the web):

```bash
python gmt_processor/inputs/scrape_henley.py --year 2026
```

This re-fetches from the official HRR site and writes:

- `data/henley_2026.json`  - every race that year (splits, winner/loser, loserLeading, verdict, day)
- `data/henley_records.json` - course records (refreshed each run)

Then commit and push. GitHub Pages redeploys, and the page picks up the new data on reload.
The first time `data/henley_2026.json` exists, a **2026 tab appears automatically** and becomes
the default (newest year). Re-run any evening to refresh that day's results.

> Run it **after the day's racing has finished** - the HRR results page fills in live, so a
> mid-day scrape would be incomplete.

## Automated (GitHub Action) - hands-off during HRR 2026

`.github/workflows/henley-2026.yml` runs the scraper automatically every 30 min
(06:00-19:30 UTC) on the 2026 race days (Tue 30 Jun - Sun 5 Jul 2026) and commits
**only `data/henley_2026.json`** - it never edits the page or any other file. The 2026
tab appears on its own once that file has races. A date-guard makes it a no-op outside
the regatta window, and you can trigger it manually any time from the **Actions tab**
(or the GitHub mobile app) via "Run workflow" (`workflow_dispatch`).

**Requirement:** scheduled Actions only run from the **default branch (`main`)**, and the
bot commits to `main`. So the Henley feature + this workflow must be **merged to `main`
before Tuesday** for the automation to fire. The records benchmark (`henley_records.json`,
records going into 2026 = through 2025) is already in place and the Action does not change it.

## Doing it from a phone (Claude Code on the web)

One-time setup (do before you travel):

1. Open **claude.ai/code** (or the Claude mobile app -> **Code** tab) and install the **Claude GitHub App**, granting access to this repo. (Pro plan is enough.)
2. Create a cloud environment for the repo with:
   - **Network access: Full** - the scraper fetches from `hrr.co.uk` (general internet, which the default "Trusted" level blocks).
   - **Setup script:** `pip install -r requirements.txt`
3. Each day, give it one instruction, e.g.:
   > "Run `python gmt_processor/inputs/scrape_henley.py --year 2026`, then commit and push to main."

That's it - no code edits, no laptop.

## Adding a brand-new year later (e.g. 2027)

Add the year to `YEAR_CANDIDATES` near the top of `henley/index.html` (newest first), then scrape it.

## Notes / known limits

- **Weather popups lag ~5 days**: Open-Meteo's *archive* API runs behind, so that day's wind/temp
  won't show until it backfills. The leaderboards are unaffected.
- **`% of record` can go blank at the Finish** for events whose record falls that year: HRR drops
  the superseded (slower) record from its page, so there's no "going into the year" value to score
  against. Barrier/Fawley usually still have one.
- The scraper is read-only against HRR and idempotent - re-running just refreshes the files.
