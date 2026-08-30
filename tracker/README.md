# RowingTools Tracker

Athlete-facing training log at **rowingtools.co.uk/tracker/** - weights sessions against a
user-defined exercise library, erg sessions logged manually or by photographing the monitor
(Concept2 PM5 / RowPerfect) and letting Claude vision read it, and core circuits against a timer.

It is a public part of the site: the homepage leads with it, `login.html` is the indexable front
door, and **the whole app runs without an account** in sample mode (below). Only the app itself
(`index.html`) stays `noindex`.

Static frontend (no build step, same as the rest of the site) + the existing RowingTools
Supabase project (ref `tbhujqdflswhgxtioznb`, shared with the shelved coach dashboard). Every tracker
table is keyed by `profile_id` with owner-only RLS, and stays that way: the squad feature shares
totals through a `SECURITY DEFINER` function rather than by widening those policies. See
**Squads** below.

## Files

| Path | What |
|---|---|
| `index.html` | The app - tabs grouped as Record (Weights / Erg / Water / Core), Review (Progress / History / Races), Squad (Board), Set up (Templates) |
| `login.html` | The public front door: what the tracker is, sign in / sign up / forgot / recovery, and **Try it without an account** |
| `terms.html` | Terms of use and privacy notice. The version date at the top is the one stamped on the profile at signup |
| `js/config.js` | Supabase URL + anon key + Edge Function endpoint. `sb` is a `let` so sample mode can swap it |
| `js/trial.js` | Sample mode: a localStorage-backed stand-in for the Supabase client, plus the seed library |
| `js/app.js` | All app logic |
| `supabase/tracker_schema.sql` | **The** schema - whole database in one idempotent file. Re-run it any time; its report checks the live DB against what the app writes |
| `supabase/functions/parse-erg/index.ts` | Edge Function: erg photo -> structured session JSON via Claude vision |

The Races tab additionally reads two files from the main site - `/data/all_results.json` (the regatta leaderboards) and `/data/club_aliases.json` - and injects `/conditions.js` for the weather card. All three are fetched only when that tab is first opened.

## One-time deployment steps (in order)

1. **Create the tables.** Supabase dashboard > SQL Editor > paste and run
   `tracker/supabase/tracker_schema.sql`. Idempotent, so re-run it whenever the app changes
   rather than hunting for a migration. Requires `public.profiles` and the `handle_new_user()`
   trigger, which are already live.

2. **Deploy the Edge Function** (needs the Supabase CLI, logged in to the personal account).
   **Run it from `tracker/`, not the repo root** - the CLI looks for `supabase/functions/<name>`
   relative to the working directory, and this repo keeps its Supabase project under `tracker/`.
   From the repo root you get "no functions found".

   ```bash
   cd tracker
   supabase functions deploy parse-erg --project-ref tbhujqdflswhgxtioznb
   # secrets take the ref explicitly, so these work from anywhere
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref tbhujqdflswhgxtioznb
   ```

   The function uses `claude-opus-5`. **Measured cost: about 3.7p a photo** (2026-08-30, from the
   tokens logged in `tracker_erg_parses`: ~7,330 input + ~430 output per successful read, at
   $5/$25 per MTok). The split rows are small, dense digits and the accuracy was worth the money.
   To trade accuracy for cost: `supabase secrets set PARSE_ERG_MODEL=claude-sonnet-5 ...`.

   **Where the money goes, and what not to touch.** Input is ~77% of it, and ~5,600 of those input
   tokens are the image itself - so image size is the only real lever, and it is the one that must
   not be pulled: dropping below 2576px is what destroyed the split-row digits the first time
   round. Output is only ~430 tokens, so adaptive thinking is barely engaging and lowering
   `output_config.effort` would save a fraction of a penny for a real accuracy risk. Prompt caching
   stays ruled out too: photos arrive minutes or days apart and cache writes cost 1.25x.

   **This sets the floor under any subscription price.** At 3.7p, £5 a month breaks even at about
   135 photos, and `MONTHLY_LIMIT` is 150 - so a user at the cap is a small loss. Either drop the
   cap to ~120, price above £5, or accept it on the grounds that almost nobody reaches it.

   To re-measure, query `tracker_erg_parses`; failed calls log with null tokens, so exclude them or
   they drag the average down.

   **Then run PART 4 of the schema** (see *Who can spend the API key* below). Without it the
   entitlement check this function performs can be defeated by the caller.

3. **Push to `main`.** GitHub Pages serves `/tracker/` automatically. The homepage links to it and
   `login.html` is in the sitemap; the app itself stays `noindex`.

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
  and you call the round with **Next**. Time not spent working is recorded as `rest_s` on the
  round just finished, so a saved session carries its real length:
  `sum(actual_s) + sum(rest_s)`.
- **The get-set countdown is a preference, not a law.** It was a fixed five seconds before every
  round with only a per-round **Skip**, which is five seconds and a tap nobody asked for at every
  hold. `Get set` in the timer options sets it to off / 3s / 5s / 10s (`rt-core-countdown` in
  `localStorage`), and while it is running the clock itself is a skip target as well as the
  button.
- **A per-side core step runs twice**, and can be made per-side mid-circuit. `per_side` on a
  routine step expands into two rounds in the runner, left then right, separately timed and
  separately saved with `side: "L"/"R"`. The runner rows also carry an **e/s** control, so a hold
  you discover is one-sided while standing over it splits into L and R for *this run* without a
  trip back to the routine (and merges back while both rounds are still unrecorded). Ticking
  **E/S** on the routine in Templates is still what makes it permanent.
- **Every insert carries a client-generated `id`.** That is what makes an offline retry safe: if
  the first attempt did reach the server, the retry hits the primary key and a `23505` is treated
  as success. Failed writes go into a local outbox and flush on the `online` event, on boot, and
  on demand from the badge in the header. Only *transport* failures queue - a row the database
  rejected is a bug, not a retry, or the app would retry a bad write for ever.
- **A session already in History can be amended in place.** Editing loads it back into the log,
  suspends drafting (it is not a draft of a new session), and saves with `update`, not `insert`.
  Sets belonging to retired exercises can't be rendered as cards, so they are held aside and
  written back untouched - editing a session must never silently drop part of it.
- **Best-so-far is shown on the card, not asked for.** The number you want between sets is
  "what did I do for this many reps last time", and it is already in memory client-side. It
  narrows to the rep count currently in set 1 and falls back to the all-time heaviest set.
  This is deliberately not the AI-question feature: an instant, always-correct number beats a
  conversational one you have to type for.
- **Progress covers all three disciplines, and they are not the same shape.** A segmented
  control switches between them rather than stacking them:
  - **Weights** opens on **All lifts** - sets or sessions a week as bars, then every lift in
    every week underneath with its change in average load. "How much am I lifting" comes before
    "how is the squat going", and the first question has no answer anywhere else in the app.
    Picking a single lift from the same picker switches to one lift, one measure, a line by
    session: heaviest set and estimated 1RM (Epley, labelled as an estimate) for reps-and-weight
    exercises, longest hold and total time held for timed ones. The set that produced the number
    is on the tile, the tooltip and the table, so a measure can never quietly gloss over the reps
    behind it.
  - **Erg / Water / Core** - weekly load: distance or time a week on the erg and on the water,
    time working or sessions a week for core. Weeks with nothing in them are drawn as gaps, not
    skipped, because a fortnight off is the most important thing a load chart can show.
  - **Session tonnage was removed on purpose.** It moves whenever the rep scheme moves and says
    nothing about whether you got stronger, so it is not offered as a measure of anything - not
    on Progress, and not as the collapsed summary line in History. Core **rounds** went the same
    way: a round count is a property of the routine, not of the work done, so core is counted in
    sessions and time working.

- **Every choice on Progress is a button, and the range is one toggle.** The controls were four
  dropdowns; each held two or three options, and a dropdown that hides two alternatives behind a
  click is a worse control than the two buttons themselves. What is left is: the discipline
  (Weights / Erg / Water / Core), the measure (Distance | Time, Time | Sessions, Sessions | Sets),
  and one **Show all time / Last 12 weeks** toggle in place of the four-way range list. Twelve
  weeks is the block a rower thinks in and everything else is "zoom out", so the range is two
  states rather than a menu. The exercise list stays a `<select>` - it is the one control with
  more than a handful of options. The measure keys survive a mode change where they can (`min`
  means time everywhere), and reset to the mode's first measure where they cannot.
- **The weekly figure sits above its own bar, with its unit.** A chart you must hover to read is no
  use on a phone. Each bar carries its value in mono above it - `35.5 km`, `1h 34m`, `4` - with the
  latest week at full strength. The unit is there because a bare `35.5` over a bar is a number
  looking for a caption, and the y-axis that would have carried one deliberately does not exist.
  **The thinning is driven by the widest label, not a fixed bar width**: `35.5 km` needs half again
  the room of `12`, so the labels drop to every other bar and then stop altogether at the width
  where they would collide - the tap-for-a-chip tooltip is still there underneath.

  Never two measures on one axis. Both charts are drawn at a measured pixel width rather than
  scaled from a `viewBox`, so labels stay legible on a phone, and they re-render on resize and
  when the tab is opened. Every plotted point is also in the table below it.
- **The three weekly load charts have no y-axis, on purpose.** Bars, a hairline baseline, one
  dashed line at the average for the range on screen, and dates every fifth bar. The numbers a
  person wants off a load chart - this week, the average, the best week - are in the three tiles
  directly above it, so axis ticks would be a third copy of them and gridlines would be ruling
  off numbers nobody is reading. Reading a single week is a tap: the bar lights up and a chip
  gives the figure. The average line is deliberately *not* labelled inline; on a phone the label
  lands on top of the bars, and the Weekly average tile has already said it. The most recent week
  is drawn at full strength so "where am I now" needs no hunting. This is the training-app idiom
  (Strava's weekly mileage chart) rather than the scientific-plot one, and it suits a question
  about shape rather than magnitude. The per-lift line chart keeps its axis: those are absolute
  kilos with no tile to lean on.
- **There is no Summary tab.** There was, and it duplicated Progress: the same weekly erg and core
  numbers, one tab across. Three review tabs for two questions is one too many, so Summary went and
  the two things it did that nothing else could were rehomed rather than dropped:
  - **The week across all three disciplines at once** (weights sessions and sets, erg km and time,
    core time) now heads each week group in **History**, which was already the week-grouped view.
    Putting the totals directly above the sessions that produced them is better than having them a
    tab apart.
  - **Every lift in a week, with the change in average load,** is `All lifts, week by week` at the
    top of the Progress exercise picker, and is what the Weights mode now opens on. Progress
    charts one lift at a time, so this is the only place a whole week of lifting is on one page.
    It takes the same measure-and-range controls as Erg and Core, and the range governs the whole
    page: only the weeks on the chart get a table.

  Both are built by `weekStripHTML()` and `liftWeekHTML()`, which is all that survives of
  `renderSummary()`.
- **History is a ruled sheet, not a card stack.** One line per session in aligned columns (day,
  discipline, what it was), expanding in place, under the week strip. Results-board language
  throughout: hairlines, tabular figures, square corners.
- **History filters by discipline, client-side.** All / Weights / Erg / Water / Core, each with its
  count, over the sessions already loaded - so it is instant and works offline. Three deliberate
  details: **all five are always shown**, the empty ones greyed and disabled rather than hidden -
  hiding a discipline at zero shrinks the row to "All / Weights" and makes the filter itself look
  like it is not there, which is exactly how it was first read; the **week strip keeps showing the
  whole week** even with a filter on, because it is the context for what you are reading and a
  filtered week would otherwise look like a light one; and a filter that would empty the page falls
  back to All rather than showing nothing.
- **The jump to Templates works before you have anything to edit.** The Core tab's button was
  disabled with no routines - which is precisely when someone needs it, since an empty Core tab has
  no other route to building one. It stays enabled and changes job instead: **Build a routine**
  opens the builder on a blank routine, **Edit this routine** opens the one you have picked.
- **The Weights picker lost its "Recent" row and gained a way out.** Recent duplicated the group
  rows underneath it - the same chips, one scroll apart - and the thing people actually wanted
  from the picker was a route to *edit* the library, which meant hunting for the Templates tab.
  The header line is now one sentence plus **Edit exercises**, which jumps to Templates and scrolls
  the library into view. Core's runner has the same jump to its routine.
- **Water sessions are their own table, not a flag on the erg one.** The columns would nearly have
  fitted - `tracker_erg_sessions` already has distance, time and notes - but `tracker_squad_board()`
  sums that table as "erg metres", the Progress erg chart reads it, History labels it "erg" and
  `parse-erg` writes to it. A single `mode` column would have made every one of those quietly mean
  "erg or water". `tracker_water_sessions` costs one more table and keeps all four honest.

  Distance is the only required field; time is optional and notes are free text. **The average split
  is derived, never stored** - it is distance over time, and a stored copy can drift out of step with
  the two numbers it came from. Durations use whole seconds (`fmtDur`) rather than the tenth
  `fmtTime` gives an erg piece: an hour on the water is not timed to 0.1s and "56:55.0" is false
  precision. The split keeps its decimal, because that one is a real measurement.

  Progress treats water exactly like the erg - same weekly bars, same measures - so `WATER_METRICS`
  is `ERG_METRICS` rather than a copy of it.
- **Races are claimed, never matched.** The Races tab reads `data/all_results.json` - the same
  file behind the regatta leaderboards and club pages, 4,900-odd results across every regatta with
  a GMT percentage. A result there is a *crew*, and no results file published anywhere names who
  was in the boat, so there is nothing to match a person against and nothing is guessed: you search
  by year, regatta and club, and press **+** on the ones you were in. That also keeps a claim a
  statement about yourself rather than an assertion about someone else's crew.

  **What is stored is a snapshot, not a foreign key.** `tracker_races` copies the eight fields of
  the result plus the regatta's venue. The results file is re-cut whenever a regatta is added or a
  correction lands, so a race stored as "look it up by `race_key`" would go blank the day that
  happens; a copy costs a few hundred bytes an athlete and means a race history works offline and
  survives the file changing under it. `race_key` (`comp|event|round|crew|time`) is kept anyway,
  unique per athlete, which is what makes the **+** idempotent and lets the finder grey out what
  you already have.

  **The file is ~800KB, so it is fetched on the first visit to the tab and never on boot**, and
  held in `sessionStorage` for the rest of the visit - the same treatment `clubs/` gives it.
  `conditions.js` is injected on the same trigger, which is how a claimed race opens the identical
  weather card the leaderboards use: course diagram, wind relative to the course, the lot. A
  tracker that only logs training pays for none of it.

  **Top three, not top ten.** The clubs pages rank a club on its best ten results because a club
  enters a hundred crews a season. A person races a handful, so ten would be "all of them,
  including the one you sculled in a gale". Three is enough to mean a good season rather than one
  good day, and small enough that a first season has it - and when you have fewer than three the
  tile says so (`Top 2 GMT`, "your 2 races so far") rather than quietly averaging a smaller set
  under a bigger label.

  The club-name normalisation (`Univ`/`Coll`/`Sch` expansion, trailing `RC`/`BC`, the `(A)` crew
  suffix, then `data/club_aliases.json`) is a deliberate copy of the one in `clubs/index.html`. If
  that one changes, this has to change with it or a search here quietly misses results.
- **A race also carries where you came, because GMT does not say that.** 84% into a headwind at
  Nottingham can be a win; 88% in a flat final can be last. Every crew in the same `comp`, `event`
  and `round` **is** that race, so `raceField()` reads the placing and the field size straight off
  the file - `3rd of 6` on the row. The round is part of the key on purpose: "Final B" is its own
  race, and calling someone 3rd when they were 3rd of the B final would be a lie by omission. Both
  numbers are stored with the claim (so they survive offline and a re-cut) and **backfilled in one
  quiet pass** for races claimed before this existed - derived data, so there is nothing to
  announce and nothing to undo.

  **The gap to the winner was built and cut the same day.** On a multi-lane course the placing is
  the fact; a `+12.40` beside a 4th of 5 says the same thing twice, in a way that reads as a
  reproach on a page someone opens to see how their season went. `gap_s` is dropped in the schema
  rather than left unused, so the table stays exactly what the app writes.
- **A result is a link back to its leaderboard**, opened filtered to the club
  (`/leaderboards/<comp>/?club=<club>` - those pages read `?club=` on load, via
  `rowingtools-share.js`), so it lands on the crew rather than on 900 rows. New tab on purpose:
  it is a reference, and losing a half-finished search to a back button is a poor trade.
- **Races sort by date or best-first, inside the year.** Never across years: a season is the unit a
  rower thinks in, and one list running best-to-worst over four years would bury this summer under
  a good day two seasons ago. One control, applied to every year block.
- **The conditions button is labelled and tinted, not a glyph.** It was a bare wind mark and nobody
  could tell it was the thing to press. It now takes the same red-tinted treatment the leaderboards
  give it (`.wx-mini` there), in this page's square-cornered idiom, with the word **Conditions** on
  it. On a phone the row's controls drop to a second line rather than squeeze the label out.
- **The season chart is dots on a real time axis, not weekly bars.** Racing is not a volume you
  accumulate: it is a handful of separate afternoons, weeks apart, and bars would invent a rhythm
  that is not there. It keeps its y-axis, unlike the training charts - these are absolute
  percentages that mean the same thing for every athlete in every year, which is exactly the case
  the weekly charts do not have. Season boundaries are ruled and labelled, dots take the same four
  GMT colours as everywhere else, and **every dot opens the conditions for that race**, which is
  the question a dot on this chart provokes.

  **A dot is labelled with the boat and the regatta, not the event code.** `W Ch Lwt 4x` carries a
  class and a tier that mean nothing once you already know it is your own race; `W4x · Marlow` is
  the pair of facts that says which afternoon this was. Long regatta names collapse to what they
  are called out loud - British Rowing Club Championships is `BRCC`, National Schools' is `NSR` -
  except a two-day regatta, where the day is the half that tells the two apart, so `Met Regatta -
  Saturday` becomes `Met - Sat` rather than the useless `MRS` initials would give.

  **The labels are placed, not just drawn.** Greedily: above the dot, then below, and a candidate
  is rejected if it would collide with a label already placed, with any *other dot*, or with the
  axis or the season row. Whatever will not fit is dropped rather than overlapped - at 22 races on
  a desktop 13 labels fit, on a phone 6 - and the chip has the rest.

  **Each dot has a 17px invisible hit circle under it.** A 7px dot is not a tap target, and hover
  was the only way to read the thing. The hit circle is emitted *before* its dot so `.rchit:hover +
  .rcdot` lights the right one; with the dot first, the adjacent-sibling rule lit the next race
  along.
- **The season card is a copy of the leaderboards' recipe, not a call into it.** `shareSeason()`
  draws the same 600x300 SVG, paints it to a canvas at 2x and hands over a PNG, exactly as
  `rowingtools-share.js` does - but that file's two functions read `document.title` and a button's
  dataset, neither of which exists here. Sharing the shape rather than the code means a card from
  the tracker and a card from a leaderboard look like they came from the same place.
- **Erg photo limits are enforced server-side, and the client only mirrors them.** A 402 (not on
  the plan), a 429 (over your quota or the site's) and a 503 (switched off) are all expected
  states with a message of their own, so the app shows them as warnings rather than dressing them
  up as errors, and offers manual entry.
- **Erg photo parses are never auto-saved**: the parsed numbers land in an editable
  confirmation card first. `source` on each erg row records `photo` / `manual` (and later
  `c2-logbook` for the planned Concept2 Logbook API sync).

## Sample mode (no account)

**Try it without an account** on `login.html` sets one localStorage flag and opens the app. Boot in
`app.js` sees the flag, finds no session, and **swaps `sb` for the stand-in client in `js/trial.js`**
- a small slice of PostgREST (`from().select().eq().order().limit().insert().update().delete()
.single()`, thenable) backed by one JSON blob in `localStorage`.

- **There is no second, cut-down tracker.** That is the whole reason for doing it this way: every
  render path, every save path and every draft is the same code, so sample mode cannot drift out of
  step with the real app, and nothing in `app.js` has to ask "am I in a trial?" before each write.
- **Three things are refused, each at the one place it happens.** Erg-photo parsing (`canReadPhotos`
  returns false: every parse costs real money and a sample cannot spend it), squads (`renderSquad`
  returns an explainer: a squad is other people, and a device is not a person), and `cacheData`
  (the sample already is the local store; a second copy would eat the same quota twice).
- **The store is seeded with a starter library and a core circuit.** A sample that opens on an empty
  exercise picker is a sample of nothing. They are ordinary rows and can be edited or deleted.
- **Creating an account uploads it, once.** `migrateTrial()` runs before `loadAll()` on the first
  boot where a real session and a sample exist together. It **upserts on `id` with
  `ignoreDuplicates`**, not inserts: a migration that dies halfway has to be safe to repeat, and a
  bulk insert where one row conflicts fails the whole statement. Exercises and routines go first,
  because a workout's `sets` object is keyed by exercise id and a core session points at a routine
  id - which is also why trial.js generates real uuids rather than counters. The `profile_id` on
  every row is rewritten to the new account. Only on success is the local store cleared; a failure
  leaves it alone and says so, and the next boot tries again.
- **Nothing is sent anywhere until then.** No account, no email, no network write.

## Terms

`terms.html` is the terms of use and privacy notice, dated at the top. Signup requires the tick, and
records `terms_accepted_at` + `terms_version` in `auth.users.raw_user_meta_data` - the copy the
client cannot edit. `stampTerms()` mirrors both onto `public.profiles` on the first authenticated
boot, because the app cannot query auth metadata back. `TERMS_VERSION` appears in three places and
they have to agree: `js/app.js`, `login.html`, and the date printed on `terms.html`.

The old signup line said the training log was "only ever visible to me", which stopped being true
the moment squads existed. The tick now points at the terms and states the squad case in one
sentence.

## Who can spend the API key

Erg-photo reading is the only thing in the tracker that costs money per use, and it is billed to
the owner's Anthropic key. Four gates stand between a stranger and that bill, and all four live in
the Edge Function, because the app is a static file anyone can skip:

1. **`verify_jwt`** (Supabase default) - no account, no call.
2. **The plan is read with the service role**, from `profiles`, never taken from the request. The
   `canReadPhotos()` check in `app.js` is only there to grey out a button.
3. **Per-user daily allowance, set by the plan.** There are two kinds of member and this is the
   only thing separating them: `trial` is free and gets **2 photos a day**, `paid` is £5 a month and
   gets **20**, with a 150/month ceiling that only a paid account can reach. A trial is not a
   countdown - it is the smaller allowance, indefinitely - so nobody is refused the reader outright
   and there is no 402 path any more. Counted from `tracker_erg_parses`, which has a SELECT-only
   policy and *no* insert, update or delete policy at all, so nobody can clear their own quota.
   Failed calls are logged too: a retry loop burns allowance rather than only money.
4. **A global daily ceiling and a kill switch.** Gate 3 bounds what one account can spend; it says
   nothing about how many accounts exist, so it cannot bound the bill. `GLOBAL_DAILY_LIMIT`
   (default 100, about £5 a day at the current model) is the number that actually decides the
   worst case, and `PARSE_ERG_ENABLED=0` stops the feature in one command with no redeploy:

   ```bash
   supabase secrets set PARSE_ERG_ENABLED=0 --project-ref tbhujqdflswhgxtioznb
   supabase secrets set PARSE_ERG_GLOBAL_DAILY_LIMIT=40 --project-ref tbhujqdflswhgxtioznb
   ```

**Gate 2 is only as strong as the column grants, and by default it is not strong at all.** Supabase
gives `authenticated` a blanket UPDATE on `public.profiles`, so a signed-in user can set
`tracker_plan = 'paid'` on themselves with one REST call and help themselves to the larger
allowance.
PART 4 of `tracker_schema.sql` is the fix and is **left commented out on purpose**, because
re-running it blindly would revoke any user-writable column added since. The order is: run the
file, read section 7 of the report (it prints the columns `authenticated` may currently write),
add anything you still need to the grant, then run PART 4 by hand.

The tracker itself only ever writes `terms_accepted_at` and `terms_version` to `profiles`, so the
grant as written covers it. The shelved coach dashboard is the unknown - its code is not in this
repo.

Section 9 of the report answers "is anyone burning my key": calls in the last 24 hours and 30 days
with a distinct-user count, and the list of accounts currently entitled to call it at all. Users
can only see their own parse rows, so this is the only place the total is visible.

Outside the code: keep auto-reload off on the Anthropic account, or set a spend limit, so a bug in
any of the above cannot bill past a number you chose. And check email confirmation is required on
signup - account creation is the door all four gates sit behind.

## Squads

A squad is a group of athletes who can see how much training each other is getting through, and
swap exercise templates. Run `supabase/tracker_schema.sql` to enable it; without that the Board tab
explains what to run rather than erroring.

**It reuses `groups` + `group_members`** - inherited from the shelved coach dashboard, live in the same Supabase project - along
with its `is_group_member()` / `is_group_admin()` helpers. No new group model was invented.

- **The tracker's own RLS is not widened. Not one policy on `tracker_workouts`,
  `tracker_erg_sessions`, `tracker_core_sessions` or `tracker_exercises` is modified.** Squad-mates
  never gain `SELECT` on your rows. Every number on the board comes from
  `tracker_squad_board()`, a `SECURITY DEFINER` function returning counts and totals only. It
  cannot leak a note, a lift or a session date because it never reads them. RLS cannot hide a
  column; a function that never selects the column can. The verification query at the bottom of
  the SQL file asserts those four tables still have exactly one policy each - if that count ever
  rises, someone has widened `SELECT` and the guarantee is gone.
- **The period is a keyword, never a caller-supplied date.** This one is load-bearing and was
  wrong in the first draft. `tracker_squad_board(p_group, p_period)` takes `week` / `4w` / `12w` /
  `all` and derives the boundary itself. With a free `date` parameter - which the function is
  granted to `authenticated` and callable directly over `/rest/v1/rpc/` - anyone could call it
  twice a day apart and subtract: a `days_trained` delta of 1 proves the athlete trained on that
  exact date, and where the erg-session delta is 1 the metres and seconds deltas **are** that
  single session's numbers. Iterating dates reconstructs the whole training calendar. Four fixed
  windows leave nothing to difference. Do not add a date parameter back.
- **Being in the squad is being on its board. Leaving is how you come off it.** This *changed*: it
  used to be a separate opt-in on top of membership, which meant a loud consent panel on every visit
  to explain a distinction nobody wanted - you join a squad in order to be on its board.
  `tracker_create_group` and `tracker_join_group` now write the `tracker_sharing` row, and a
  one-time backfill in the schema covers memberships that predate the change.

  **The table stayed, and so did everything privacy-critical built on it.** `tracker_squad_board()`
  still reads `tracker_sharing` rather than `group_members`, its RLS is unchanged, and the four
  owner-only policies are untouched. Only *who writes the row* changed, which means the board can be
  put back behind an explicit opt-in later without going near the function that decides what leaks.
  A member with no sharing row still renders greyed, and if it is you there is a "show my totals"
  link on your own row to repair it.
- **Every `jsonb` expansion in the board function is guarded on `jsonb_typeof`,** and the
  exercise-id cast on an exact uuid regex. These columns have no CHECK constraint, so without the
  guards a single member with an odd row - a hand-written API call, a future format change - would
  raise and take the board down for *everyone* in the squad.
- **Non-sharers are shown, greyed, as "not sharing".** The board says "2 of 3 sharing" rather than
  quietly pretending the squad is smaller than it is.
- **The board ranks on one of six things, chosen with buttons.** Erg, Water, Erg + Water,
  Weights, Core, Racing - then a second row for the measure of whichever one is picked, on exactly the same
  pattern as Progress (distance | time, sessions | sets, time | sessions), and a third for the
  period. It replaced two dropdowns. **Erg + Water is computed client-side** (`combined_metres`,
  `combined_seconds` in `boardVal`) rather than added to the SQL: it is the sum of two columns the
  function already returns, and a derived total that lives in the client cannot disagree with its
  own parts.

  **Racing ranks on results rather than training** - a race count, and the average of the best
  three, over the same window. A claimed race is *already* public: it is on the regatta leaderboard
  under the crew's name. What crosses to the squad is the athlete's own association with it, which
  is exactly what putting yourself on a board says. It is deliberately kept out of `days_trained`
  and `sessions_total`: those count training logged as it happened, and a claimed race is attached
  retrospectively, so mixing them would let an afternoon of claiming last season read as a week of
  training. Two details that matter: a squad-mate who has not raced shows a dash, **not 0%** - the
  SQL returns null and `boardVal` keeps it null, because nobody rows a nought and a zero would rank
  them below someone who had a shocker; and the bars for a percentage measure are drawn from a
  floor a little under the field rather than from zero, or eight averages between 82 and 90 would
  be eight identical bars.

  **There is no cross-discipline "Overall" mode.** One was built - days trained / total sessions -
  and cut on 2026-08-30. Ranking a squad on an aggregate of four unlike things means deciding what
  an erg piece is worth against a core circuit, and no honest exchange rate exists; a board people
  cannot see the working behind is one they stop trusting. Days trained survives as context on each
  athlete's own row, where it explains a number rather than being one. Do not re-add it as a mode.
- **Everything you *do* to a squad is behind Board settings.** The board itself is a thing you
  read; inviting, removing people, sharing templates, importing one and leaving are things you do,
  and they were all sitting above and below the standings, on every visit, for the one visit in
  twenty that needed them. They now live in a drawer that opens on **Board settings** and is shut
  by default. Nothing changed about who can do what - the drawer just stops a rarely-used admin
  surface from being the loudest thing on the page.
- **A shared template is read before it is imported, and imported in part.** "Import" used to be a
  button on a name and a count, which is asking someone to take a stranger's whole library on
  trust. Opening one lists every exercise with its group, movement type and coaching note; the ones
  already in your library are ticked out and greyed as **already yours** (matched on lower-cased
  name, the same rule the import itself uses), and the import button names the count and stays
  disabled until something is ticked. The selection lives in `SQ.picked`, in memory only - it is a
  selection, not a setting, and it dies with the preview. The merge rules are unchanged and still
  additive: importing never edits or removes anything you already have.
- **It opens on erg distance, and every mode says what it is measuring.** The line under the board
  names the discipline, the measure and the window in words, and says in as many words that the
  numbers are self-reported and are not race results. Volume is a weak thing to rank on - it rewards
  junk metres and punishes the athlete on a taper - so the breakdown under each name (days, weights,
  erg, water, core) is always there to put a big number in context, and days trained counts water
  outings as well as erg and gym.
- **Join by six-character code, or by link.** The alphabet omits O/0, I/1 and S/5 - these get read
  aloud in a boathouse and typed with cold hands. Codes are not readable by non-members, so they
  cannot be enumerated; joining goes through an RPC. An invite link is
  `/tracker/?join=CODE`, and the Board tab offers it three ways: **Invite by email** (a `mailto:`
  with the link and a written invite, opened in the sender's own mail app - there is no mail server
  and no sender domain to verify), **Share** (the phone share sheet, where `navigator.share`
  exists), and **Copy link**.

  An arriving `?join=` code is parked in `localStorage` and taken out of the address bar
  immediately, so it survives sign-in *and* an email-confirmation round trip and is not shared on by
  accident. The signed-out fast redirect in `index.html` parks it before bouncing to `login.html`,
  which says an invite is waiting; a sample says the code is being held until there is an account.
- **Every squad needs a code, and an admin can (re)issue one.** `tracker_rotate_code` both gives a
  code to a squad that has none and replaces one that has got out; the two are the same operation
  and only the warning differs. It matters because **squads inherited from the coach dashboard
  predate `join_code` and have null there**, which left their admin looking at "No invite code on
  this squad" with nothing to do about it. The generator is `tracker_new_join_code()`, pulled out
  of `tracker_create_group` so both paths mint codes the same way; it is `SECURITY DEFINER` for
  the uniqueness check, because `groups` has RLS and a caller who can only see their own squads
  would happily hand back a code another squad is already using. The report counts squads with a
  null code so this state is visible rather than discovered.
- **The admin is whoever created the squad, and only they can remove people.**
  `tracker_admin_remove_member` is `SECURITY DEFINER` and gated on `is_group_admin()` - the client
  cannot touch `group_members`, which still has no DELETE policy. It refuses to remove *you*
  (leaving is `tracker_leave_group`; an admin removing themselves through here could strand a squad
  with no admin), and it takes the person's sharing row and anything they posted to the squad with
  them, because that is what "removed" means.
- **`group_members` has no INSERT policy at all.** Creating and joining go through
  `SECURITY DEFINER` RPCs where the row written is fixed by the code, which is what stops anyone
  adding themselves to a squad they were not invited to.
- **Deferred: following.** Groups already deliver "see other people"; a follow graph is a second,
  different set of visibility rules, and doubling the RLS surface in one go is how privacy bugs
  get in.

### Known gaps in the squad model

Real, and deliberately not built yet - none of them risks data, but they will bite operationally:

- **Partial member management.** Removing someone (`tracker_admin_remove_member`) and re-issuing a
  join code (`tracker_rotate_code`) are done. Still missing: **promoting** a member. So a squad
  whose only admin leaves can never have another, and `tracker_leave_group` does not check whether
  you are the last admin. The fix is `tracker_set_role`, `SECURITY DEFINER` and gated on
  `is_group_admin()`, plus a last-admin guard on leaving.
- **Join codes are a brute-forceable online oracle, and now they let you straight onto a board.**
  31 characters over 6 positions is about 29.5 bits, and `tracker_join_group` has no rate limit,
  lockout or expiry, and joins silently with no approval step. Sharing-follows-membership raises the
  payoff from "aggregates of whoever opted in" to "aggregates of everyone in the squad", which is
  the one place the model change costs something. Admin-remove and code rotation are the
  mitigations that now exist; a join rate limit is the one still missing, and is the next thing to
  build here.
- **A failed read of the shared templates used to render as "Nothing shared with this squad yet".**
  `loadBoard()` dropped `tmpl.error` on the floor, so a missing table or a missing SELECT policy
  looked exactly like an empty squad and sent you looking in the wrong place. The error is now
  kept on `SQ.tmplError` and shown in the panel, the way `SQ.boardError` already was for the
  board. The report also prints the policies on `tracker_sharing` and `tracker_shared_templates`
  (section 6b) and a per-squad line of members / on the board / templates read as the table owner
  (section 8) - a template count of 0 there means the post never landed, above 0 means the
  reader's SELECT is what is broken.
- **Shared templates include each exercise's coaching cue** (the `note` field on the library), which
  is a deliberate part of posting a template. The *reading* half of this is now covered - the
  preview shows every exercise and its note before any of it lands in your library - but there is
  still no preview of your own library on the way **out**, so posting is the step taken on trust.
  This is unrelated to the "never shared" line in the consent panel, which is about *session* notes.

## Offline

Three pieces have to line up, and all three are load-bearing - drop any one and the app is a dead
error page in a gym basement:

1. **The shell is cached.** The tracker registers the site service worker (`/sw.js`). `sw.js`
   caches same-origin GETs, **plus cross-origin requests that have a request `destination`** -
   scripts, styles, fonts. A data fetch has an empty destination, which is exactly the
   discriminator wanted here: the Supabase client script from jsDelivr is cached (without it
   `sb` is never created and nothing loads at all), while a signed-in athlete's Supabase reads
   never land in a cache that outlives the session or is shared with whoever next picks up the
   device.
2. **The last good load is kept locally.** `loadAll()` failing used to end the boot sequence. Now
   a *transport* failure falls back to a localStorage snapshot of the last successful load, so
   the library, history and routines are all still there. A real error (missing tables, RLS)
   still stops with the original message. The snapshot is refreshed after every save, so a
   session logged offline survives a reload.
3. **Writes queue.** See the client-generated `id` note above.

A queue drained at boot re-reads from the server afterwards - the rows were not in the load that
had just finished, and leaving the athlete looking at a log missing the session they logged
offline is how a session gets entered twice.

What works offline: opening the app, and logging weights, erg and core sessions. What does not:
first sign-in, erg photo parsing (it needs the Edge Function), and *amending* a saved session -
edits go straight to `update` and are not queued.

## Not built yet (by design)

- Stripe billing (free-trial gating) - P2, shared with the coach dashboard plan.
- Concept2 Logbook OAuth sync - P3; the `source` column is ready for it.
- Server-sent invite emails. Invites open the sender's own mail app; a real RowingTools-sent invite
  would be an Edge Function against the Brevo account already used for the results newsletter,
  which needs an API key as a Supabase secret, a verified sender, and a rate limit so the endpoint
  cannot be turned into a spam relay.
- Promoting a squad member, and a last-admin guard on leaving.
