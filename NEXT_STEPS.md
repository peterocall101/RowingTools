# Next steps

Working list for the tracker and the wider site. `README.md` is reference documentation and
deliberately has no roadmap in it; this is where the roadmap lives.

Ordered by what blocks what, not by size. Each item records what is **decided** so it does not get
re-argued, and what is still **open** so it is obvious what a session needs before it can start.

Last reviewed: 2026-08-30.

---

## 1. Pricing and billing

**Settled 2026-08-30. Two kinds of member, and the daily erg-photo allowance is the only thing that
separates them.**

| Plan | Cost | Erg photos | Everything else |
|---|---|---|---|
| `trial` | free, no time limit | 2 a day | all of it |
| `paid` | £5 a month | 20 a day | all of it |

A trial does not expire; it is the smaller allowance, indefinitely. Nobody is ever locked out of
their own training log, and **"first 100 members free for life" is a promise kept by never
converting those accounts, not a state in the database.**

This replaces the earlier paid-at-signup decision, which was reversed because it put a card form in
front of a product nobody had seen and broke the squad mechanic: a captain cannot onboard twenty
clubmates who each have to pay first.

### Done (2026-08-30) - none of it needed Stripe

- `tracker_plan` now defaults to `trial`, with existing `free` rows moved across.
- `parse-erg` takes the allowance from the plan (2 / 20) instead of one number plus an entitlement
  check. The 402 "not on the plan" branch is gone.
- The Erg tab states the allowance quietly instead of showing a paywall, and the photo button works
  for every account.

Needs the schema re-run and `supabase functions deploy parse-erg` to take effect.

### Still to do: take the money

**You can launch without this.** Billing is only needed once you want to charge someone, so the
tracker can go in front of your club now.

- `create-checkout` and `stripe-webhook` Edge Functions. The pattern is proven by `parse-erg`.
  **`verify_jwt` must be OFF on the webhook** - Stripe is not a signed-in user, which makes the
  signature check the only thing guarding a function that grants the larger allowance, so it must be
  right and it must be idempotent.
- `stripe_customer_id`, `stripe_subscription_id`, `subscription_status` on `profiles`, service-role
  write only.
- The upgrade screen, the return-from-checkout path, and a link into Stripe's billing portal.
- **Start the Stripe account verification now** - business details and bank verification take days;
  the code is about a day.

### What it costs to run

At the measured 3.7p a photo, the 2/day cap makes the free tier predictable: 100 active members
photographing one or two pieces a week lands around **£20-45 a month**. The aggregate control is
`PARSE_ERG_GLOBAL_DAILY_LIMIT` - **40 is a sensible setting** (about £1.50 a day). Watch section 9
of the schema report.

Paid is thinner than it looks: 150 photos a month is £5.55 of API cost against £5 of revenue. Almost
nobody reaches it; drop `PARSE_ERG_MONTHLY_LIMIT` to 120 if you want the cap on the right side of
break-even.

### Copy and terms, to do with Stripe

`index.html`, `tracker/login.html` and `tracker/terms.html` still describe the tracker as flatly
free. It nearly is - the only paid thing is the larger photo allowance - but the terms need to say
so, along with what happens on cancellation (assumed: back to `trial`, keeps the log, keeps 2 a
day). The clause about not taking things away retrospectively **stays**: under this model it is
exactly what "free for life" means to the first hundred.

---

## 2. `og:image` across the site - DONE 2026-08-30

Seven cards in `assets/og/`, 1200x630, rendered from the site's own visual language: red top rule,
Fraunces wordmark, Archivo title, and the same motif that sits on the matching homepage panel, so a
shared link looks like the page it came from.

| Card | Used by |
|---|---|
| `default.png` | homepage, `henley/methodology/` |
| `gmt.png` `leaderboards.png` `clubs.png` `henley.png` | the matching section pages |
| `regatta.png` | all 16 `leaderboards/<regatta>/` pages |
| `tracker.png` | `tracker/login.html` |

Tags added to 23 pages: `og:image` plus width, height and alt, and `twitter:card=summary_large_image`.
Pages that had no Open Graph at all (`clubs/`, and every regatta page) also got `og:title`,
`og:description`, `og:url`, `og:type` and `og:site_name`, derived from the `<title>`, meta
description and canonical each page already had.

The `heatmap-*.html` files at the repo root were skipped on purpose: they are `noindex` meta-refresh
stubs that redirect to `/leaderboards/<regatta>/`, so nothing ever unfurls them.

**To regenerate:** `scripts/og_cards.html` is the checked-in source, documented in `README.md`
alongside the other two scripts. Open it to preview all seven; `?v=<name>` gives one card alone at
1200x630 for screenshotting. Verified to reproduce all seven shipped PNGs byte for byte. Some copy
dates - `311 clubs` and `13 UK regattas` are the numbers that move.

---

## 3. Cross-links to the tracker from the high-traffic pages - DONE 2026-08-30

Was marked blocked on Stripe. It was not: the blocker was the *word* "free", not the link. The copy
is now pricing-neutral - **"Training Tracker →"** and nothing else - so none of it needs revisiting
when the tracker starts charging.

- `gmt/`, `leaderboards/`, `henley/` - the existing single "Back to main tools" line became a
  two-link `.xnav` row (new rule in `assets/app.css`).
- `clubs/` - styles itself and does not load `app.css`, so the link went inline in its header,
  separated by a middot, using its own local `.back-link` class.
- All 16 `leaderboards/<regatta>/` pages - their own template and their own CSS, so the link went in
  the footer beside "rowingtools.co.uk" rather than a nav row they have no styling for. **These are
  the pages that actually matter**: they are where a WhatsApp link from a regatta lands.

21 pages outside `tracker/` now link to it, against one before.

---

## 4. AI: weekly summary

**Status:** specced, not built. Argued for pulling **ahead** of the questions feature.

A few sentences on the week just gone: "Three weights, four ergs, 21km. Squat is up 5kg in a month.
Erg volume down two weeks running."

- **Fed aggregates only**, never raw sessions - `weeklyStats()`, `ergWeekly()`, `coreWeekly()` from
  `app.js`, last 6-8 weeks. The model narrates numbers it is handed. It never does arithmetic.
- **Generated lazily and cached** in a `tracker_week_summaries` table keyed on (profile, week). When
  the app opens and last week has no summary, it makes one, once. No cron to build, and dormant
  users cost nothing.
- The same text then goes out through Brevo on a Monday, which is the retention play.

**Why first:** retention is the number that decides whether a training log works at all, and this is
the retention mechanism. It is the kind of thing you wish had been running from day one rather than
bolted on later.

---

## 5. AI: ask a question about your history

**Status:** architecture settled, not built.

"Best 8-rep squat this year", "have I done a 5k faster than this", "what did I lift on the 12th".

**The database does the arithmetic through tool calls; the model only handles language.** This is
firm. An occasionally-wrong personal best is worse than no personal best, so raw history is never
shipped to the model and asked for a maximum.

Four or five tools cover most of what gets asked: best set at a rep count, an exercise's history,
erg bests at a distance, weekly totals, what happened on a date.

**Open:** where the question box lives. Leaning a box on Progress, under the chart, rather than its
own tab.

---

## Shared plumbing for 4 and 5

Build once, use twice:

- **A second Edge Function** shaped exactly like `parse-erg`: JWT, service-role reads, per-user
  quota, global daily ceiling, kill switch. That pattern is proven; it is copy and adapt.
- **A flattened sets view** - one row per set (`profile_id, date, exercise_id, exercise_name,
  set_index, reps, weight, unit`). The questions feature cannot be built without it and the summary
  is better with it. The guarded-cast helpers it needs, `tracker_num` and `tracker_is_uuid`, already
  exist for the board function.
- **A terms line.** Erg photos are covered; training aggregates going to an API are not.

**Cost is not a constraint here.** These are small text prompts, not dense images. A weekly summary
on Haiku 4.5 is well under 0.1p; a question on Sonnet 5 is roughly half a penny across its tool
round-trips. Set against 5p per erg photo, neither moves the unit economics. Quota should still
exist - something like 30 questions a day, against 20 photos - but it is a guard, not a budget.

---

## Recently closed

**2026-08-30 - race history.** A Races tab claims results from the regatta leaderboards
(`data/all_results.json`) into `tracker_races`, with a per-year summary and a top-3 GMT average, and
opens the existing `conditions.js` weather card on any claimed race. Four follow-ons shipped the same
day: **place in the field** on every race (`3rd of 6`), each result linking back to its leaderboard
filtered to the club; a **season dot chart** of every claimed race, where a dot opens that race's
conditions; a **Racing mode on the squad board** (top-3 GMT, race count); and a **downloadable
season card** in the leaderboards' house style.

Still open from that list, and the one with no competitor: **training against racing** - what the
eight weeks before your best race looked like versus your worst. It needs the flattened sets view
described above and nothing else.

**2026-08-30 - the squad board counts water sessions.** `tracker_squad_board()` gained a `wa`
CTE and four columns (`sessions_water`, `water_metres`, `water_seconds`, plus water in `days_trained`
and `sessions_total`); the return signature changed, so the schema file drops the function before
recreating it and **`tracker_schema.sql` has to be re-run** for the board to work at all.

---

## Below the line

Real, none of them urgent at ten users, all worth closing before a hundred. Written up properly in
`tracker/README.md` under **Known gaps in the squad model**:

- Join codes have no rate limit, and joining now puts you straight onto a board.
- A squad whose only admin leaves can never have another. No last-admin guard on leaving.
- No way to promote a member to admin (`tracker_set_role`).
- Server-sent invite emails. Invites currently open the sender's own mail app.
- Concept2 Logbook OAuth sync. The `source` column on `tracker_erg_sessions` is ready for it.
- No preview of your own library before you post it as a shared template. Reading someone else's
  before importing is now covered; posting yours is still the step taken on trust.

---

## Not being done, and why

- **Video form checking.** Expensive per use, and it means a solo developer telling someone their
  deadlift is safe. The liability is real and the accuracy bar is brutal.
- **An AI that writes training programmes.** Same liability problem, and it aims at the wrong
  person: the growth mechanic is a captain onboarding twenty athletes at once, and a product that
  replaces the coach is a product the coach will not share.
- **A "first N erg photos free" allowance.** Proposed 2026-08-29 as an alternative to a time-based
  trial, declined in favour of going straight to paid signup. Do not re-propose.
