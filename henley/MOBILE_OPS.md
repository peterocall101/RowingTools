# Henley 2026 — running the live results from a phone (Claude Code)

This is the operations guide for keeping **rowingtools.co.uk/henley** updated during Henley
Royal Regatta 2026 (Tue 30 Jun – Sun 5 Jul) **without a laptop**. If you are a Claude Code
session pointed at this repo, read this file and follow it exactly.

---

## TL;DR — the one operation

Updating the live website is **one command + commit + push**:

```bash
python gmt_processor/inputs/scrape_henley.py --year 2026 --results-only
```

This re-fetches the official HRR results and overwrites **`data/henley_2026.json`** (and nothing
else). Then commit **only that file** and push to `main`. GitHub Pages redeploys automatically and
the live page shows the new results on a normal refresh. **No HTML edits, no other files.**

If the scrape produces no change (no new races since last time), there is nothing to commit and
nothing deploys — that is correct, not an error.

---

## The exact prompt to give a fresh Claude Code session

Open the repo `peterocall101/RowingTools` in Claude Code (mobile app → Code tab, or claude.ai/code),
then paste **one** of these:

### A) One update now
```
In this repo, run:
python gmt_processor/inputs/scrape_henley.py --year 2026 --results-only
Then, if data/henley_2026.json changed, stage ONLY that file, commit it with message
"Henley 2026: manual update" and push to main. If nothing changed, do nothing.
Report one line: the race count from the scraper, or "no new results".
If the push is rejected ("fetch first"), run `git pull --no-rebase` then push again.
```

### B) Keep updating every 10 minutes (while you're watching)
```
/loop 10m In this repo, run python gmt_processor/inputs/scrape_henley.py --year 2026 --results-only,
then if data/henley_2026.json changed, stage only that file, commit "Henley 2026: manual update"
and push to main (on a rejected push, git pull --no-rebase then push). One line per iteration:
race count or "no new results".
```

> **`/loop` only runs while that session is alive.** It is for when you are around and want
> sub-hourly freshness. It is **not** guaranteed to keep going after you fully close the app.
> For hands-off updates with the phone away, rely on the **cloud backstop** below.

---

## What is already running automatically (do not duplicate-worry)

Two things update the page on their own — you usually don't need to do anything:

1. **Cloud backstop routine (reliable, hourly).** A scheduled Claude Code cloud routine
   (`trig_01EHfrrDfhSxZ9gkF6s5EdAW`, "Henley 2026 cloud backstop") fires **hourly, 09:15–21:15 BST,
   every day 1–5 July**, runs the scraper, and pushes any new data. Runs server-side regardless of
   phone/laptop. Notifications are off, so verify by checking the page or commit history. Each fire
   uses a small amount of Claude usage.
2. **GitHub Actions schedule (free but sporadic).** `.github/workflows/henley-2026.yml` is set to
   run every 10 min during race hours, but GitHub heavily throttles scheduled jobs — in practice it
   fires only a handful of times a day. Treat it as a bonus, not the main mechanism.

**So:** the cloud backstop keeps the page within ~1 hour hands-off. Use prompt A/B above only when
you want it fresher than hourly, or if the backstop appears to have stalled.

---

## Zero-Claude-cost manual trigger (no Claude session needed)

In the **GitHub mobile app** → repo **Actions** tab → **"Henley 2026 auto-update"** → **Run workflow**.
This runs the same scraper on GitHub's servers and auto-deploys if there's new data. One tap, no
Claude tokens. Good for a quick manual nudge.

---

## How to verify an update worked

- **Commits:** the repo's commit history on `main` should show `Henley 2026: ...` commits with rising
  race counts.
- **Live page:** open **rowingtools.co.uk/henley** and refresh (a normal refresh is enough — the page
  is cache-busted). New races appear in the live list, leaderboards, and station tracker.
- A push triggers `pages-build-deployment` automatically; the page is live ~1–2 min after the commit.

## Troubleshooting

- **Push rejected `! [rejected] ... (fetch first)`** — the remote moved (another auto-run committed
  in between). Fix: `git pull --no-rebase` then `git push` again, or just re-run the scrape prompt.
  This is common and harmless.
- **`ModuleNotFoundError` / scraper can't fetch hrr.co.uk** — the cloud environment needs
  **Network access: Full** and the setup script **`pip install -r requirements.txt`** (already
  configured for this repo's env). The scraper hits the public internet (hrr.co.uk), which the
  default "Trusted" network level blocks.
- **No new results all day at the same count** — racing may have finished for the day, or there's a
  midday lull. Re-running just reports "no new results"; nothing to fix.

## Reference

- **Scraper:** `gmt_processor/inputs/scrape_henley.py` — `--year 2026 --results-only` writes only
  `data/henley_2026.json`. (Plain `--year 2026` also refreshes `data/henley_records.json`; not
  needed during the regatta — records going into 2026 are already in place.)
- **Data file (the only one that changes):** `data/henley_2026.json`.
- **Public page:** `henley/index.html` → rowingtools.co.uk/henley. Auto-detects the 2026 tab once the
  data file has races; no HTML edit needed to "turn on" a new day or year.
- **Run it after results post** — HRR fills its results page live, so a scrape just reflects whatever
  is currently published.
