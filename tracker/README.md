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
| `index.html` | The app - tabs grouped as Record (Weights / Erg / Core), Review (Progress / History), Squad (Board), Set up (Templates) |
| `login.html` | The public front door: what the tracker is, sign in / sign up / forgot / recovery, and **Try it without an account** |
| `terms.html` | Terms of use and privacy notice. The version date at the top is the one stamped on the profile at signup |
| `js/config.js` | Supabase URL + anon key + Edge Function endpoint. `sb` is a `let` so sample mode can swap it |
| `js/trial.js` | Sample mode: a localStorage-backed stand-in for the Supabase client, plus the seed library |
| `js/app.js` | All app logic |
| `supabase/tracker_schema.sql` | **The** schema - whole database in one idempotent file. Re-run it any time; its report checks the live DB against what the app writes |
| `supabase/functions/parse-erg/index.ts` | Edge Function: erg photo -> structured session JSON via Claude vision |

## One-time deployment steps (in order)

1. **Create the tables.** Supabase dashboard > SQL Editor > paste and run
   `tracker/supabase/tracker_schema.sql`. Idempotent, so re-run it whenever the app changes
   rather than hunting for a migration. Requires `public.profiles` and the `handle_new_user()`
   trigger, which are already live.

2. **Deploy the Edge Function** (needs the Supabase CLI, logged in to the personal account):

   ```bash
   supabase functions deploy parse-erg --project-ref tbhujqdflswhgxtioznb
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref tbhujqdflswhgxtioznb
   ```

   The function uses `claude-opus-5` (roughly 5p per photo - the split rows are small, dense
   digits and accuracy was worth the money). To trade accuracy for cost:
   `supabase secrets set PARSE_ERG_MODEL=claude-sonnet-5 ...`.

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
    Picking a single lift from the same dropdown switches to one lift, one measure, a line by
    session: heaviest set and estimated 1RM (Epley, labelled as an estimate) for reps-and-weight
    exercises, longest hold and total time held for timed ones. The set that produced the number
    is on the tile, the tooltip and the table, so a measure can never quietly gloss over the reps
    behind it.
  - **Erg / Core** - weekly load: km, time or sessions a week for the erg, time working or
    sessions a week for core. Weeks with nothing in them are drawn as gaps, not skipped, because
    a fortnight off is the most important thing a load chart can show.
  - **Session tonnage was removed on purpose.** It moves whenever the rep scheme moves and says
    nothing about whether you got stronger, so it is not offered as a measure of anything - not
    on Progress, and not as the collapsed summary line in History. Core **rounds** went the same
    way: a round count is a property of the routine, not of the work done, so core is counted in
    sessions and time working.

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
- **The default metric is days trained, not volume.** A board topped by whoever erged the most
  metres rewards junk volume and punishes the athlete on a taper. Days trained reflects turning
  up, is far harder to inflate than a distance you type in, and does not disadvantage the lighter
  athlete the way tonnage does. Volume metrics are available but secondary, and the board says
  in as many words that the numbers are self-reported and are not race results.
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

- **Partial member management.** Removing someone is done (`tracker_admin_remove_member`). Still
  missing: **promoting** a member, and **rotating** a join code. So a squad whose only admin leaves
  can never have another, and an abandoned squad keeps a live join code nobody can revoke.
  `tracker_leave_group` still does not check whether you are the last admin. The fixes are
  `tracker_set_role` and `tracker_rotate_code`, both `SECURITY DEFINER` and gated on
  `is_group_admin()`, plus a last-admin guard on leaving.
- **Join codes are a brute-forceable online oracle, and now they let you straight onto a board.**
  31 characters over 6 positions is about 29.5 bits, and `tracker_join_group` has no rate limit,
  lockout or expiry, and joins silently with no approval step. Sharing-follows-membership raises the
  payoff from "aggregates of whoever opted in" to "aggregates of everyone in the squad", which is
  the one place the model change costs something. Admin-remove is the mitigation that now exists;
  code rotation and a join rate limit would close it properly, and are the next things to build
  here.
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
- Server-sent invite emails. Invites open the sender's own mail app; a real RowingTools-sent invite
  would be an Edge Function against the Brevo account already used for the results newsletter,
  which needs an API key as a Supabase secret, a verified sender, and a rate limit so the endpoint
  cannot be turned into a spam relay.
- Promoting a squad member, rotating a join code, and a last-admin guard on leaving.
