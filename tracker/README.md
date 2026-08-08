# RowingTools Tracker

Athlete-facing training log at **rowingtools.co.uk/tracker/** - weights sessions against a
user-defined exercise library, and erg sessions logged manually or by photographing the monitor
(Concept2 PM5 / RowPerfect) and letting Claude vision read it.

Static frontend (no build step, same as the rest of the site) + the existing RowingTools
Supabase project (ref `tbhujqdflswhgxtioznb`, shared with the coach dashboard). Every tracker
table is keyed by `profile_id` with owner-only RLS, and stays that way: the squad feature shares
totals through a `SECURITY DEFINER` function rather than by widening those policies. See
**Squads** below.

## Files

| Path | What |
|---|---|
| `index.html` | The app - tabs grouped as Record (Weights / Erg / Core), Review (Summary / Progress / History), Set up (Templates) |
| `login.html` | Standalone signin/signup/forgot/recovery against the shared Supabase project |
| `js/config.js` | Supabase URL + anon key + Edge Function endpoint |
| `js/app.js` | All app logic |
| `supabase/tracker_schema.sql` | Additive schema: `tracker_exercises`, `tracker_workouts`, `tracker_erg_sessions`, `tracker_core_*` + RLS. First run only - bare `CREATE TABLE`, so it errors on a second run |
| `supabase/social_schema.sql` | Squads: reuses the dashboard's `groups`/`group_members`, adds `tracker_sharing`, shared templates and the board function. Idempotent |
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
- **Progress is one lift, one measure, one axis.** Never two y-scales. Reps-and-weight exercises
  offer heaviest set / estimated 1RM (Epley, labelled as an estimate) / session volume; timed
  holds offer longest hold / total time held. The chart is drawn at a measured pixel width
  rather than scaled from a `viewBox`, so axis labels stay legible on a phone, and it re-renders
  on resize and when its tab is opened. Every plotted session is also in the table below it.
- **Erg photo parses are never auto-saved**: the parsed numbers land in an editable
  confirmation card first. `source` on each erg row records `photo` / `manual` (and later
  `c2-logbook` for the planned Concept2 Logbook API sync).

## Squads

A squad is a group of athletes who can see how much training each other is getting through, and
swap exercise templates. Run `supabase/social_schema.sql` to enable it; without that the Board tab
explains what to run rather than erroring.

**It reuses the coach dashboard's `groups` + `group_members`** in the same Supabase project, along
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
- **Membership shares no training data**, but it is not invisible: everyone in a squad can see who
  else is in it and their display name, because the board lists non-sharers so it can honestly say
  "2 of 3 sharing". Appearing with *numbers* is the separate, explicit, revocable act recorded in
  `tracker_sharing` - no row means no numbers.
- **Every `jsonb` expansion in the board function is guarded on `jsonb_typeof`,** and the
  exercise-id cast on an exact uuid regex. These columns have no CHECK constraint, so without the
  guards a single member with an odd row - a hand-written API call, a future format change - would
  raise and take the board down for *everyone* in the squad.
- **Non-sharers are shown, greyed, as "not sharing".** The board says "2 of 3 sharing" rather than
  quietly pretending the squad is smaller than it is.
- **The default metric is days trained, not volume.** A board topped by whoever erged the most
  metres rewards junk volume and punishes the athlete on a taper. Days trained reflects turning
  up, is far harder to inflate than a distance you type in, and does not disadvantage the lighter
  athlete the way tonnage does. Volume metrics are available but secondary, and the board says
  in as many words that the numbers are self-reported and are not race results.
- **Join by six-character code.** The dashboard's invite flow is email-based and its Edge Function
  does not exist yet, so codes are the self-serve route in. The alphabet omits O/0, I/1 and S/5 -
  these get read aloud in a boathouse and typed with cold hands. Codes are not readable by
  non-members, so they cannot be enumerated; joining goes through an RPC.
- **`group_members` has no INSERT policy at all.** Creating and joining go through
  `SECURITY DEFINER` RPCs where the row written is fixed by the code, which is what stops anyone
  adding themselves to a squad they were not invited to.
- **Deferred: following.** Groups already deliver "see other people"; a follow graph is a second,
  different set of visibility rules, and doubling the RLS surface in one go is how privacy bugs
  get in.

### Known gaps in the squad model

Real, and deliberately not built yet - none of them risks data, but they will bite operationally:

- **No member management.** There is no RPC to remove someone, promote a member, or rotate a join
  code, and `group_members` has no UPDATE or DELETE policy. So: an admin cannot evict anyone; a
  squad whose only admin leaves can never have another; and an abandoned squad keeps a live join
  code nobody can revoke. `tracker_leave_group` does not check whether you are the last admin.
  Fixing this is `tracker_admin_remove_member`, `tracker_set_role` and `tracker_rotate_code`, all
  `SECURITY DEFINER` and gated on `is_group_admin()`.
- **Join codes are a brute-forceable online oracle.** 31 characters over 6 positions is about 29.5
  bits, and `tracker_join_group` has no rate limit, lockout or expiry, and joins silently with no
  approval step. The payoff is only the aggregates of members who opted in, so severity is low,
  but code rotation plus admin-remove would close it properly.
- **Shared templates include each exercise's coaching cue** (the `note` field on the library), which
  is a deliberate part of posting a template but is worth a preview before posting. This is
  unrelated to the "never shared" line in the consent panel, which is about *session* notes.

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
- Anonymous try-before-signup mode - v1 requires an account.
