# Next steps

Working list for the tracker and the wider site. `README.md` is reference documentation and
deliberately has no roadmap in it; this is where the roadmap lives.

Ordered by what blocks what, not by size. Each item records what is **decided** so it does not get
re-argued, and what is still **open** so it is obvious what a session needs before it can start.

Last reviewed: 2026-08-29.

---

## 1. Stripe, and the copy that depends on it

**Status:** critical path. Nothing else about the tracker should ship before it.
**Decided:** signing up will cost money. Not freemium, not a free tier with a paid photo reader.

This is one job, not three: the billing plumbing, the copy pass, and the terms rewrite all have to
land together, because today every user-facing surface says the tracker is free.

### The code

The pattern is already proven by `parse-erg`: an Edge Function holding a secret, deployed from
`tracker/` with the CLI. Three pieces:

- **`create-checkout`** - takes the caller's JWT, opens a Stripe Checkout Session with the profile
  id attached, returns the URL. Small.
- **`stripe-webhook`** - verifies the signature, handles subscription created / updated / cancelled,
  writes `tracker_plan`. **`verify_jwt` must be OFF on this one**, because Stripe is not a signed-in
  user. That makes the signature check the only thing standing between the internet and a function
  that grants paid access, so it has to be right, and it needs to be idempotent because Stripe
  retries.
- **Schema** - `stripe_customer_id`, `stripe_subscription_id`, `subscription_status` on `profiles`,
  service-role write only, the same treatment `tracker_plan` has.

Plus, client side: the paywall screen, the return-from-checkout path, and a link into Stripe's
billing portal so cancellations are never handled by hand.

### The copy that has to change with it

Every one of these currently promises free:

| Where | What it says |
|---|---|
| `index.html` | "Free · try it without an account" on the tracker panel |
| `tracker/login.html` | "Free. Weights, erg and core in one log…", and the meta description |
| `tracker/js/app.js` | the erg gate: "logging weights and typing erg sessions in by hand is free, and always unlimited" |
| `tracker/js/app.js` | "Create a free account" in the sample banner and the squad gate |
| `tracker/terms.html` | several, including the one below |

The two "Free tools for UK club rowing" lines on the homepage are fine - that is the
GMT%/leaderboards side, which stays free - but the page has to make clear the tracker is the
exception.

**One line in the terms is a commitment, not copy:**

> If a paid tier is introduced, you will be told before anything is charged and nothing you already
> have will be taken away from you retrospectively.

That binds anyone who signed up under it. Changing it is clean while there are no users. It is not
clean afterwards, so it has to be rewritten **before** the first paying signup, not after.

### Open decisions, needed before any of it can be built

1. **Subscription or one-off?** Monthly, annual, or both?
2. **Does sample mode stay free?** Assumed yes - under paid signup it is the entire shop window.
3. **What happens when someone cancels?** A training log that deletes your history when you stop
   paying is hostile, and it will cost word of mouth in a small community. The normal answer is
   read-only plus export. Whatever is chosen has to be stated in the terms.
4. **Any founding-member or club rate?** Much cheaper to build in now than to retrofit.

### Timing

The code is about a day. Getting to actually taking money is a week or two, and almost all of that
is **Stripe account verification** (business details, bank verification). That has a queue in front
of it and costs nothing to start early, so start it before the code.

### The funnel problem to solve alongside it

Under paid signup, sample mode is the whole sales pitch - and it deliberately excludes erg photo
reading and squads, which are the two features most likely to justify the price. So a prospect is
asked to pay for the two things they cannot try.

Not built, suggested: a canned demo of both inside the sample. A stock monitor photo that returns a
real parse **without calling the API**, and a board with three invented squadmates.

---

## 2. `og:image` across the site

**Status:** not blocked by anything. Can be done any time.

There is not a single `og:image` on the site. Rowing clubs run on WhatsApp, and every link anyone
shares - a leaderboard, a Henley result, a club profile - currently renders as bare text. That is a
tax on the sharing the site already gets for free.

`rowingtools-share.js` already builds share cards for individual crew results, so the machinery is
not foreign to the codebase.

Worth doing before Stripe, because it improves every page that already exists rather than only the
tracker.

---

## 3. Cross-links to the tracker from the high-traffic pages

**Status:** blocked on Stripe. The link copy depends on whether the tracker is free.

Only `index.html` links to the tracker. Real traffic lands on `/leaderboards/`, `/clubs/`,
`/henley/` and `/gmt/` from WhatsApp and Google, and none of those pages mention the tracker exists.

Held back only because there is no point writing "Training Tracker · free" into four page headers
the week before it stops being free.

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

## Below the line

Real, none of them urgent at ten users, all worth closing before a hundred. Written up properly in
`tracker/README.md` under **Known gaps in the squad model**:

- Join codes have no rate limit, and joining now puts you straight onto a board.
- A squad whose only admin leaves can never have another. No last-admin guard on leaving.
- No way to promote a member to admin (`tracker_set_role`).
- Server-sent invite emails. Invites currently open the sender's own mail app.
- Concept2 Logbook OAuth sync. The `source` column on `tracker_erg_sessions` is ready for it.

---

## Not being done, and why

- **Video form checking.** Expensive per use, and it means a solo developer telling someone their
  deadlift is safe. The liability is real and the accuracy bar is brutal.
- **An AI that writes training programmes.** Same liability problem, and it aims at the wrong
  person: the growth mechanic is a captain onboarding twenty athletes at once, and a product that
  replaces the coach is a product the coach will not share.
- **A "first N erg photos free" allowance.** Proposed 2026-08-29 as an alternative to a time-based
  trial, declined in favour of going straight to paid signup. Do not re-propose.
