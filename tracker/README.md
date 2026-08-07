# RowingTools Tracker

Athlete-facing training log at **rowingtools.co.uk/tracker/** - weights sessions against a
user-defined exercise library, and erg sessions logged manually or by photographing the monitor
(Concept2 PM5 / RowPerfect) and letting Claude vision read it.

Static frontend (no build step, same as the rest of the site) + the existing RowingTools
Supabase project (ref `tbhujqdflswhgxtioznb`, shared with the coach dashboard). All data is
strictly personal: every table is keyed by `profile_id` with owner-only RLS. No squad linkage.

## Files

| Path | What |
|---|---|
| `index.html` | The app - tabs grouped as Record (Weights / Erg / Core), Review (Summary / History), Set up (Templates) |
| `login.html` | Standalone signin/signup/forgot/recovery against the shared Supabase project |
| `js/config.js` | Supabase URL + anon key + Edge Function endpoint |
| `js/app.js` | All app logic |
| `supabase/tracker_schema.sql` | Additive schema: `tracker_exercises`, `tracker_workouts`, `tracker_erg_sessions` + RLS |
| `supabase/functions/parse-erg/index.ts` | Edge Function: erg photo -> structured session JSON via Claude vision |

## One-time deployment steps (in order)

1. **Create the tables.** Supabase dashboard > SQL Editor > paste and run
   `tracker/supabase/tracker_schema.sql`. Requires the dashboard schema's `profiles`
   table + `handle_new_user()` trigger, which are already live.

2. **Deploy the Edge Function** (needs the Supabase CLI, logged in to the personal account):

   ```bash
   supabase functions deploy parse-erg --project-ref tbhujqdflswhgxtioznb
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref tbhujqdflswhgxtioznb
   ```

   The function uses `claude-opus-5` (roughly 5p per photo - the split rows are small, dense
   digits and accuracy was worth the money). To trade accuracy for cost:
   `supabase secrets set PARSE_ERG_MODEL=claude-sonnet-5 ...`.

3. **Push to `main`.** GitHub Pages serves `/tracker/` automatically. The page is `noindex`
   and not linked from the public site yet - share the URL directly while testing.

## Local test

```bash
python -m http.server 8000   # from repo root
# -> http://localhost:8000/tracker/login.html
```

The Edge Function works from localhost too (CORS is open); it just needs step 2 done.

## Design decisions

- **No programme concept anywhere.** Users build their own exercise library (name, session
  group, movement type, reps-vs-seconds, per-side, bodyweight). The Weights tab picker and
  sections are generated from it.
- **Template share** = download the library as a JSON file; a crewmate uploads it and gets the
  same picker. No server logic.
- **Deleting a used exercise retires it** (soft delete) so old sessions still classify
  correctly in History/Summary; never-used exercises hard-delete.
- **Every save is a new row** (date + time), never an overwrite - two sessions in a day is normal.
- **The weights log is a draft until you save it.** What is on the page is mirrored into
  `localStorage` (keyed by user and by date) on every change, so a refresh, a locked phone or a
  tab switch loses nothing, and flipping the date picker moves between drafts rather than
  binning one. It is deliberately device-local: it is a working copy, not history, so it never
  reaches the database until **Save session**. Drafts older than a fortnight are pruned.
  Cross-device drafts would need a `draft` flag column on `tracker_workouts`.
- **Exercises are closed off one at a time.** "Done with this exercise" collapses a card to its
  one-line summary, with **Edit** to reopen it - you fill the session in as you do it, not from
  memory at the end. Collapsing is display-only; the inputs stay in the DOM, so the save reads
  the same values either way.
- **The core timer counts up and never auto-advances.** Holding longer than target is a result,
  not something to truncate: the clock keeps running past the target (one beep as it passes),
  and you call the round with **Next**. Starting a round runs a 5-second countdown first
  (skippable). Time not spent working is recorded as `rest_s` on the round just finished, so a
  saved session carries its real length: `sum(actual_s) + sum(rest_s)`.
- **A per-side core step runs twice.** `per_side` on a routine step expands into two rounds in
  the runner, left then right, separately timed and separately saved with `side: "L"/"R"`.
- **Erg photo parses are never auto-saved**: the parsed numbers land in an editable
  confirmation card first. `source` on each erg row records `photo` / `manual` (and later
  `c2-logbook` for the planned Concept2 Logbook API sync).

## Not built yet (by design)

- Stripe billing (free-trial gating) - P2, shared with the coach dashboard plan.
- Concept2 Logbook OAuth sync - P3; the `source` column is ready for it.
- Anonymous try-before-signup mode - v1 requires an account.
