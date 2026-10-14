-- ================================================================
-- RowingTools tracker - THE schema. One file, whole database.
--
-- Run in: Supabase dashboard > SQL Editor, project tbhujqdflswhgxtioznb.
-- IDEMPOTENT. Safe to run any time, as many times as you like. Run it
-- whenever you want to be certain the live database matches the app.
--
-- This is the only .sql file in the repo, on purpose. One-off changes
-- are handed over in conversation and folded back in here, so there is
-- never a pile of dated migrations to apply in the right order.
--
-- THE ONE THING TO UNDERSTAND BEFORE READING ON
-- Every tracker_* table is OWNER-ONLY: profile_id = auth.uid(), one
-- policy each, no exceptions. Squads do NOT widen that. Sharing happens
-- entirely through public.tracker_squad_board(), a SECURITY DEFINER
-- function returning COUNTS AND TOTALS ONLY. It cannot leak a note, an
-- individual lift or a session date, because it never selects them.
-- Row-level security cannot hide a column; a function that never reads
-- the column can.
--
-- The one deliberate exception is a HARD ERG (part 2, section 4): a
-- session the athlete has tagged, one at a time, as an attempt at the
-- squad's erg of the week. tracker_hard_erg_board() returns that
-- session's split, time and distance - still never its date or notes - and,
-- if the athlete ticked it while logging, the photo of the monitor.
--
-- The report at the bottom checks that, and much else. Read it.
-- ================================================================

begin;

-- ================================================================
-- PART 1 - the personal training log
-- ================================================================

-- session_groups = the athlete own session labels ("Session 1", "Gym A").
--   An array, because the same lift often appears in more than one
--   session, and it must stay ONE exercise with one id or its history,
--   last-time prefill and bests get split across them.
-- unit    = 'reps' (reps + weight) or 'secs' (timed holds).
-- retired = soft delete. Old workouts reference exercises by id, so a
--   deleted-but-used exercise is retired, keeping history classifying.
create table if not exists public.tracker_exercises (
  id             uuid        primary key default gen_random_uuid(),
  profile_id     uuid        not null references public.profiles on delete cascade,
  name           text        not null,
  session_groups text[]      not null default '{"Session 1"}',
  pattern        text        not null default 'other',
  unit           text        not null default 'reps' check (unit in ('reps', 'secs')),
  per_side       boolean     not null default false,
  bodyweight     boolean     not null default false,
  note           text,
  position       int         not null default 0,
  retired        boolean     not null default false,
  created_at     timestamptz not null default now()
);

-- sets = { "<exercise_id>": [ {"r": "8", "w": "60"}, ... ] }
-- Never overwritten by date: every save is a new row (at = HH:MM), and
-- two sessions in a day is normal. id is supplied by the CLIENT so an
-- offline save can be retried without risking a duplicate.
create table if not exists public.tracker_workouts (
  id         uuid        primary key default gen_random_uuid(),
  profile_id uuid        not null references public.profiles on delete cascade,
  date       date        not null,
  at         text,
  sets       jsonb       not null default '{}'::jsonb,
  notes      text,
  created_at timestamptz not null default now()
);

-- source: photo = parsed from a monitor photo by the parse-erg Edge
-- Function; manual = typed in; c2-logbook = future Concept2 API sync.
create table if not exists public.tracker_erg_sessions (
  id           uuid        primary key default gen_random_uuid(),
  profile_id   uuid        not null references public.profiles on delete cascade,
  date         date        not null,
  at           text,
  source       text        not null default 'manual' check (source in ('photo', 'manual', 'c2-logbook')),
  erg_type     text        check (erg_type in ('concept2', 'rowperfect') or erg_type is null),
  session_type text,
  total_time_s numeric,
  distance_m   int,
  avg_split_s  numeric,
  avg_rate     int,
  avg_hr       int,
  intervals    jsonb,
  notes        text,
  created_at   timestamptz not null default now()
);

-- steps is an ORDERED list: [{"name","target_s","per_side"}, ...].
-- Order is the round order and repeats are expected - the same hold
-- commonly appears as round 1 and round 4 - so this is a list, never a
-- set keyed by name. per_side marks a side-specific hold: the runner
-- expands it into TWO rounds, left then right, sharing the one target.
create table if not exists public.tracker_core_routines (
  id         uuid        primary key default gen_random_uuid(),
  profile_id uuid        not null references public.profiles on delete cascade,
  name       text        not null,
  steps      jsonb       not null default '[]'::jsonb,
  position   int         not null default 0,
  retired    boolean     not null default false,
  created_at timestamptz not null default now()
);

-- One run through a routine. routine_name is a snapshot so a session
-- stays readable after the routine is renamed or deleted.
-- steps: [{"name","side","target_s","actual_s","rest_s"}, ...]
-- side   = "L"/"R" for a round expanded from a per_side step, else null.
-- rest_s = seconds NOT working after that round (the reset shuffle, plus
--          any pause). Session length = sum(actual_s) + sum(rest_s),
--          which is why reset time lives on the round rather than in its
--          own column: the shape stays inside this jsonb.
create table if not exists public.tracker_core_sessions (
  id           uuid        primary key default gen_random_uuid(),
  profile_id   uuid        not null references public.profiles on delete cascade,
  date         date        not null,
  at           text,
  routine_id   uuid        references public.tracker_core_routines on delete set null,
  routine_name text,
  steps        jsonb       not null default '[]'::jsonb,
  notes        text,
  created_at   timestamptz not null default now()
);

-- Rowing on the water. Deliberately NOT folded into tracker_erg_sessions,
-- even though the columns would nearly fit: tracker_squad_board() sums
-- that table as "erg metres", the Progress erg chart reads it, History
-- labels it "erg", and parse-erg writes to it. One `mode` column would
-- have made every one of those quietly mean "erg or water".
--
-- Distance and time are both required by the app (since 2026-10-13); boat and
-- notes are optional. The columns stay nullable because older rows were saved
-- with a distance alone, and a NOT NULL here would refuse to apply. The
-- average split is NOT stored - it is distance and time, and deriving it
-- for display cannot drift out of step with them.
--
-- boat is the class rowed (1x, 2-, 4+, 8+ ...), free text with a datalist
-- rather than a CHECK: the list of boats a club owns is longer than any list
-- worth hard-coding, and a constraint here would reject a legitimate session
-- with no way for the athlete to argue. It matches the `boat` on
-- tracker_races, so "what do I go quickest in" is answerable later.
create table if not exists public.tracker_water_sessions (
  id           uuid        primary key default gen_random_uuid(),
  profile_id   uuid        not null references public.profiles on delete cascade,
  date         date        not null,
  at           text,
  distance_m   int,
  total_time_s numeric,
  boat         text,
  notes        text,
  created_at   timestamptz not null default now()
);

-- Other cardio: a run, a bike, a swim - anything aerobic that is not rowing.
-- Its own table for the same reason water is: the erg and water figures are
-- distances that add up, and a 10k run does not add up with a 10k row. Time
-- is the one measure every kind of cardio shares, so it is the only number.
-- activity is free text with a datalist in the app (like boat), and both it
-- and the time are required by the app.
create table if not exists public.tracker_cardio_sessions (
  id           uuid        primary key default gen_random_uuid(),
  profile_id   uuid        not null references public.profiles on delete cascade,
  date         date        not null,
  at           text,
  activity     text,
  total_time_s numeric,
  notes        text,
  created_at   timestamptz not null default now()
);

-- Races claimed from the RowingTools regatta leaderboards.
--
-- A SNAPSHOT, not a foreign key. The leaderboard data lives in a static
-- file (data/all_results.json) that is re-scraped as regattas are added,
-- so a race stored as "look it up by key" would go blank the day a
-- correction lands or a comp is re-cut. Copying the eight fields that
-- make up the result costs a few hundred bytes an athlete and means a
-- race history keeps working offline, and after the file changes.
--
-- race_key is comp|event|round|crew|time - the identity of a result
-- within the file. It is unique per athlete so the same race cannot be
-- claimed twice, which is what makes the "+" idempotent.
--
-- venue is copied too (name, lat, lon, bearing, lanes) because that is
-- what conditions.js needs to draw the weather card, and it belongs to
-- the regatta rather than to the result.
create table if not exists public.tracker_races (
  id         uuid        primary key default gen_random_uuid(),
  profile_id uuid        not null references public.profiles on delete cascade,
  race_key   text        not null,
  comp       text        not null,
  comp_title text,
  comp_url   text,
  date       date        not null,
  club       text,
  crew       text,
  event      text,
  round      text,
  boat       text,
  time       text,
  clock      text,
  pct        numeric,
  venue      jsonb,
  -- Where the crew finished in ITS OWN race (same comp, event and round) and
  -- how big that field was. Both are derived from the results file rather than
  -- published in it, and are stored for the same reason as everything else
  -- here: so a race history reads correctly offline and after the file is
  -- re-cut. The client fills them in on claim, and backfills any nulls the
  -- next time it has the file.
  place      int,
  field      int,
  created_at timestamptz not null default now(),
  unique (profile_id, race_key)
);

-- One row per call to parse-erg, including failures - a failed call is
-- still billed. Written by the function with the SERVICE ROLE, so a user
-- cannot clear their own quota.
create table if not exists public.tracker_erg_parses (
  id            uuid        primary key default gen_random_uuid(),
  profile_id    uuid        not null references public.profiles on delete cascade,
  created_at    timestamptz not null default now(),
  model         text,
  input_tokens  int,
  output_tokens int,
  ok            boolean     not null default true
);

-- CREATE TABLE IF NOT EXISTS will not add a missing column to a table
-- that already exists, so every column the app writes is topped up here.
alter table public.tracker_exercises
  add column if not exists session_groups text[]  not null default '{"Session 1"}',
  add column if not exists pattern        text    not null default 'other',
  add column if not exists unit           text    not null default 'reps',
  add column if not exists per_side       boolean not null default false,
  add column if not exists bodyweight     boolean not null default false,
  add column if not exists note           text,
  add column if not exists position       int     not null default 0,
  add column if not exists retired        boolean not null default false;

alter table public.tracker_workouts
  add column if not exists at    text,
  add column if not exists sets  jsonb not null default '{}'::jsonb,
  add column if not exists notes text;

alter table public.tracker_erg_sessions
  add column if not exists at           text,
  add column if not exists source       text not null default 'manual',
  add column if not exists erg_type     text,
  add column if not exists session_type text,
  add column if not exists total_time_s numeric,
  add column if not exists distance_m   int,
  add column if not exists avg_split_s  numeric,
  add column if not exists avg_rate     int,
  add column if not exists avg_hr       int,
  add column if not exists intervals    jsonb,
  add column if not exists notes        text,
  -- Where the monitor photo is, in the erg-screens bucket, for a session the
  -- athlete chose to show as a hard erg attempt. Null for nearly every row:
  -- a photo is only kept when that box is ticked.
  add column if not exists screen_path  text;

alter table public.tracker_core_routines
  add column if not exists steps    jsonb   not null default '[]'::jsonb,
  add column if not exists position int     not null default 0,
  add column if not exists retired  boolean not null default false;

alter table public.tracker_water_sessions
  add column if not exists at           text,
  add column if not exists distance_m   int,
  add column if not exists total_time_s numeric,
  add column if not exists boat         text,
  add column if not exists notes        text;

alter table public.tracker_cardio_sessions
  add column if not exists at           text,
  add column if not exists activity     text,
  add column if not exists total_time_s numeric,
  add column if not exists notes        text;

alter table public.tracker_races
  add column if not exists comp_title text,
  add column if not exists comp_url   text,
  add column if not exists club       text,
  add column if not exists crew       text,
  add column if not exists event      text,
  add column if not exists round      text,
  add column if not exists boat       text,
  add column if not exists time       text,
  add column if not exists clock      text,
  add column if not exists pct        numeric,
  add column if not exists venue      jsonb,
  add column if not exists place      int,
  add column if not exists field      int;

-- The gap to the winner was shown for a day and cut: on a multi-lane course
-- the number that matters is the placing, and a "+12.40" next to a 4th of 5
-- says the same thing twice in a way that reads as a reproach. Dropped rather
-- than left unused, so the table stays exactly what the app writes.
alter table public.tracker_races drop column if exists gap_s;

alter table public.tracker_core_sessions
  add column if not exists at           text,
  add column if not exists routine_id   uuid references public.tracker_core_routines on delete set null,
  add column if not exists routine_name text,
  add column if not exists steps        jsonb not null default '[]'::jsonb,
  add column if not exists notes        text;

-- Entitlement. Only the service role may write these - see the column
-- grants near the end.
--
-- TWO KINDS OF MEMBER, and the only thing separating them is how many erg
-- photos a day they get: 'trial' is free and gets 2, 'paid' is £5 a month
-- and gets 20. Everything else in the tracker is identical, and nobody is
-- ever locked out of the photo reader entirely - a trial is not a countdown,
-- it is just the smaller allowance. "First 100 free for life" is a promise
-- kept by never converting those accounts, not a state in this column.
--
-- 'free' survives in the CHECK for old rows and as somewhere for a lapsed
-- subscription to land later; nothing assigns it now.
alter table public.profiles
  add column if not exists tracker_plan text not null default 'free'
    check (tracker_plan in ('free', 'trial', 'paid')),
  add column if not exists tracker_trial_ends_at timestamptz;

-- ADD COLUMN IF NOT EXISTS will not change the default on a column that
-- already exists, so the new default is set explicitly and the rows that
-- predate it are moved across.
alter table public.profiles alter column tracker_plan set default 'trial';
update public.profiles set tracker_plan = 'trial' where tracker_plan = 'free';

-- tracker_trial_ends_at is no longer read by anything: a trial does not
-- expire. Kept rather than dropped - it is the obvious column to reach for
-- if a time-limited offer ever comes back.

-- Terms acceptance. The tick on the signup form is the record that
-- matters, but it lives in auth.users.raw_user_meta_data where the app
-- cannot query it, so it is mirrored here: the app stamps these on the
-- first authenticated boot where they are null. terms_version is the
-- date the wording last changed (tracker/terms.html), so a future
-- re-consent prompt has something to compare against.
alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version     text;

create index if not exists tracker_exercises_profile_idx
  on public.tracker_exercises (profile_id);
create index if not exists tracker_workouts_profile_date_idx
  on public.tracker_workouts (profile_id, date desc);
create index if not exists tracker_erg_profile_date_idx
  on public.tracker_erg_sessions (profile_id, date desc);
create index if not exists tracker_core_routines_profile_idx
  on public.tracker_core_routines (profile_id);
create index if not exists tracker_core_sessions_profile_date_idx
  on public.tracker_core_sessions (profile_id, date desc);
create index if not exists tracker_water_profile_date_idx
  on public.tracker_water_sessions (profile_id, date desc);
create index if not exists tracker_cardio_profile_date_idx
  on public.tracker_cardio_sessions (profile_id, date desc);
create index if not exists tracker_races_profile_date_idx
  on public.tracker_races (profile_id, date desc);
create index if not exists tracker_erg_parses_profile_time_idx
  on public.tracker_erg_parses (profile_id, created_at desc);
-- The global daily ceiling in parse-erg counts across all users, so it needs
-- created_at leading; the profile-first index above cannot serve that.
create index if not exists tracker_erg_parses_time_idx
  on public.tracker_erg_parses (created_at desc);

-- ---- Owner-only RLS. ONE policy per table, and keep it that way: the
-- ---- whole squad privacy guarantee is that these are never widened.
alter table public.tracker_exercises     enable row level security;
alter table public.tracker_workouts      enable row level security;
alter table public.tracker_erg_sessions  enable row level security;
alter table public.tracker_core_routines enable row level security;
alter table public.tracker_core_sessions enable row level security;
alter table public.tracker_water_sessions enable row level security;
alter table public.tracker_cardio_sessions enable row level security;
alter table public.tracker_races         enable row level security;
alter table public.tracker_erg_parses    enable row level security;

drop policy if exists "own exercises" on public.tracker_exercises;
create policy "own exercises" on public.tracker_exercises
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists "own workouts" on public.tracker_workouts;
create policy "own workouts" on public.tracker_workouts
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists "own erg sessions" on public.tracker_erg_sessions;
create policy "own erg sessions" on public.tracker_erg_sessions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists "own core routines" on public.tracker_core_routines;
create policy "own core routines" on public.tracker_core_routines
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists "own core sessions" on public.tracker_core_sessions;
create policy "own core sessions" on public.tracker_core_sessions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists "own water sessions" on public.tracker_water_sessions;
create policy "own water sessions" on public.tracker_water_sessions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists "own cardio sessions" on public.tracker_cardio_sessions;
create policy "own cardio sessions" on public.tracker_cardio_sessions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- A claimed race is a public result - it is already on the leaderboard
-- under the crew's name - but WHICH results an athlete says are theirs
-- is not public, and nothing outside this app should be able to read the
-- list. Same owner-only policy as everything else.
drop policy if exists "own races" on public.tracker_races;
create policy "own races" on public.tracker_races
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Read-only to the owner (so the UI can show "12 of 20 photos left").
-- No insert/update/delete policy at all: only the service role writes
-- here, which is what stops a user clearing their own quota.
drop policy if exists "read own parse log" on public.tracker_erg_parses;
create policy "read own parse log" on public.tracker_erg_parses
  for select using (profile_id = auth.uid());

-- ================================================================
-- PART 2 - squads
-- ================================================================

-- ----------------------------------------------------------------
-- 0. The group model, inherited from the coach dashboard - a project
--    SHELVED on 2026-08-08 and not being picked up. Its app code lives
--    only on unmerged branches, but these tables ARE LIVE in this
--    Supabase project and are now load-bearing for the tracker:
--    handle_new_user() reads group_members and pending_members, so
--    tracker signup breaks without them. Verified present on the live
--    database 2026-08-08.
--
--    Repeated here VERBATIM so this file stands alone on a fresh
--    project. If they already exist every statement is a no-op. Do not
--    "improve" these definitions or drop them as dashboard leftovers.
-- ----------------------------------------------------------------
create table if not exists public.groups (
  id                   uuid        primary key default gen_random_uuid(),
  name                 text        not null,
  club_id              text,
  club_name            text,
  active_benchmark_id  uuid,
  created_by           uuid        not null references auth.users on delete restrict,
  created_at           timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id    uuid not null references public.groups on delete cascade,
  profile_id  uuid not null references public.profiles on delete cascade,
  role        text not null default 'member' check (role in ('admin', 'member')),
  accepted_at timestamptz,
  joined_at   timestamptz not null default now(),
  primary key (group_id, profile_id)
);
create index if not exists group_members_profile_idx on public.group_members (profile_id);

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

-- SECURITY DEFINER so the policies below can consult group_members
-- without recursing through group_members' own RLS.
create or replace function public.is_group_member(g uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.group_members
    where group_id = g and profile_id = auth.uid()
  );
$$;

create or replace function public.is_group_admin(g uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.group_members
    where group_id = g and profile_id = auth.uid() and role = 'admin'
  );
$$;

-- ----------------------------------------------------------------
-- 1. Join code. A tracker user has no way into a squad otherwise: the
--    dashboard's invite flow is email-based and its Edge Function does
--    not exist yet. A code is self-serve and needs no mail server.
--
--    Deliberately NOT readable by non-members - the policy below only
--    exposes groups you already belong to - so codes cannot be
--    enumerated by reading the table. Joining goes through the RPC.
-- ----------------------------------------------------------------
alter table public.groups
  add column if not exists join_code text;

-- Partial unique index: many groups may have no code, but a code that
-- exists must identify exactly one squad.
create unique index if not exists groups_join_code_key
  on public.groups (upper(join_code)) where join_code is not null;

drop policy if exists "read own groups" on public.groups;
create policy "read own groups" on public.groups
  for select using (public.is_group_member(id));

drop policy if exists "read own memberships" on public.group_members;
create policy "read own memberships" on public.group_members
  for select using (public.is_group_member(group_id));

-- ----------------------------------------------------------------
-- 2. Sharing - one row per (athlete, squad).
--
--    CHANGED. This used to be a separate opt-in on top of membership,
--    so a squad could contain people showing no numbers. In practice
--    that produced a loud consent panel on every visit to explain a
--    distinction nobody wanted: you join a squad in order to be on its
--    board. Being in the squad now IS the sharing, stated at the point
--    of joining, and LEAVING is how you withdraw it.
--
--    The table stays, and so does everything built on it: the board
--    function still reads it rather than group_members, tracker_sharing
--    still cascades on delete, and the RLS below is unchanged. What
--    changed is only who writes the row - tracker_create_group and
--    tracker_join_group now do, and tracker_leave_group deletes it.
--    Keeping the table means the board can be put back behind an opt-in
--    later without touching the privacy-critical function.
--
--    Still true, and still the whole point: sharing means COUNTS AND
--    TOTALS, computed by tracker_squad_board(). No session, no lift, no
--    note and no date crosses to another athlete.
-- ----------------------------------------------------------------
create table if not exists public.tracker_sharing (
  profile_id uuid        not null references public.profiles on delete cascade,
  group_id   uuid        not null references public.groups   on delete cascade,
  shared_at  timestamptz not null default now(),
  primary key (profile_id, group_id)
);
create index if not exists tracker_sharing_group_idx on public.tracker_sharing (group_id);

alter table public.tracker_sharing enable row level security;

-- You manage your own consent, and only for squads you are actually in.
drop policy if exists "manage own sharing" on public.tracker_sharing;
create policy "manage own sharing" on public.tracker_sharing
  for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and public.is_group_member(group_id));

-- Squad-mates may see WHO is sharing. That is a name, not training data.
drop policy if exists "squad reads sharing roster" on public.tracker_sharing;
create policy "squad reads sharing roster" on public.tracker_sharing
  for select using (public.is_group_member(group_id));

-- Backfill for squads that predate the change above. Anyone already in a
-- squad joined it to be on its board; without this they would sit there
-- greyed out as "not sharing" with no control left in the UI to fix it.
-- ON CONFLICT keeps it a no-op on every later run.
insert into public.tracker_sharing (profile_id, group_id)
select gm.profile_id, gm.group_id from public.group_members gm
on conflict (profile_id, group_id) do nothing;

-- ----------------------------------------------------------------
-- 3. Shared templates - the exercise library JSON the Templates tab
--    already exports, posted to a squad instead of emailed as a file.
-- ----------------------------------------------------------------
create table if not exists public.tracker_shared_templates (
  id         uuid        primary key default gen_random_uuid(),
  group_id   uuid        not null references public.groups   on delete cascade,
  profile_id uuid        not null references public.profiles on delete cascade,
  name       text        not null,
  kind       text        not null default 'exercise-template'
               check (kind in ('exercise-template', 'core-routine')),
  payload    jsonb       not null,
  created_at timestamptz not null default now()
);
create index if not exists tracker_shared_templates_group_idx
  on public.tracker_shared_templates (group_id, created_at desc);

alter table public.tracker_shared_templates enable row level security;

drop policy if exists "squad reads templates" on public.tracker_shared_templates;
create policy "squad reads templates" on public.tracker_shared_templates
  for select using (public.is_group_member(group_id));

drop policy if exists "post own templates" on public.tracker_shared_templates;
create policy "post own templates" on public.tracker_shared_templates
  for insert with check (profile_id = auth.uid() and public.is_group_member(group_id));

-- Your own, or anything in a squad you administer.
drop policy if exists "remove own templates" on public.tracker_shared_templates;
create policy "remove own templates" on public.tracker_shared_templates
  for delete using (profile_id = auth.uid() or public.is_group_admin(group_id));

-- ----------------------------------------------------------------
-- 4. Hard ergs - "erg session of the week". Any member sets one: a
--    free-text title (what the piece is), optional notes, and the dates
--    it runs over. Members tag their own erg sessions as attempts at it,
--    and the board can rank on it, fastest average split first.
--
--    This is the ONE place a single session's numbers cross to the
--    squad, and only because the athlete put them there: a tag is an
--    explicit, per-session, revocable "show this one". Nothing untagged
--    is ever read, the session's date and notes never leave, and the
--    tag rows themselves are owner-only - the squad sees the result
--    through tracker_hard_erg_board(), never the tags.
-- ----------------------------------------------------------------
create table if not exists public.tracker_hard_ergs (
  id         uuid        primary key default gen_random_uuid(),
  group_id   uuid        not null references public.groups   on delete cascade,
  created_by uuid        not null references public.profiles on delete cascade,
  title      text        not null check (length(trim(title)) between 1 and 120),
  notes      text        check (notes is null or length(notes) <= 1000),
  starts_on  date        not null,
  ends_on    date        not null,
  created_at timestamptz not null default now(),
  -- A quarter at most: a "hard erg" open all year is just a leaderboard.
  check (ends_on >= starts_on and ends_on - starts_on <= 92)
);
create index if not exists tracker_hard_ergs_group_idx
  on public.tracker_hard_ergs (group_id, ends_on desc);
-- Set when the final ranking is saved (see tracker_freeze_hard_ergs). Only
-- that definer function writes it: there is no UPDATE policy on this table.
alter table public.tracker_hard_ergs add column if not exists frozen_at timestamptz;

create table if not exists public.tracker_hard_erg_entries (
  hard_erg_id    uuid        not null references public.tracker_hard_ergs    on delete cascade,
  erg_session_id uuid        not null references public.tracker_erg_sessions on delete cascade,
  profile_id     uuid        not null references public.profiles             on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (hard_erg_id, erg_session_id)
);
create index if not exists tracker_hard_erg_entries_profile_idx
  on public.tracker_hard_erg_entries (profile_id);

alter table public.tracker_hard_ergs        enable row level security;
alter table public.tracker_hard_erg_entries enable row level security;

drop policy if exists "squad reads hard ergs" on public.tracker_hard_ergs;
create policy "squad reads hard ergs" on public.tracker_hard_ergs
  for select using (public.is_group_member(group_id));

drop policy if exists "members set hard ergs" on public.tracker_hard_ergs;
create policy "members set hard ergs" on public.tracker_hard_ergs
  for insert with check (created_by = auth.uid() and public.is_group_member(group_id));

-- No UPDATE policy: nothing in the app edits a hard erg once set, and one
-- would let a setter clear frozen_at and reopen a final ranking.
drop policy if exists "setter edits hard ergs" on public.tracker_hard_ergs;

-- Whoever set it, or the squad admin.
drop policy if exists "setter removes hard ergs" on public.tracker_hard_ergs;
create policy "setter removes hard ergs" on public.tracker_hard_ergs
  for delete using (created_by = auth.uid() or public.is_group_admin(group_id));

-- Owner-only, and a tag can only point at your OWN session, dated inside
-- the hard erg's window, in a squad you are in. Checked here rather than
-- trusted from the app.
drop policy if exists "own hard erg tags" on public.tracker_hard_erg_entries;
create policy "own hard erg tags" on public.tracker_hard_erg_entries
  for all using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and exists (
      select 1
      from public.tracker_erg_sessions s
      join public.tracker_hard_ergs h on h.id = tracker_hard_erg_entries.hard_erg_id
      where s.id = tracker_hard_erg_entries.erg_session_id
        and s.profile_id = auth.uid()
        and s.date between h.starts_on and h.ends_on
        and public.is_group_member(h.group_id)
    )
  );

commit;

-- ================================================================
-- 4. Functions
-- ================================================================

-- Set values are user-typed strings. A bad one must yield null, not
-- abort the whole board with an invalid-input-syntax error. The digit
-- limits matter: '9' repeated 200000 times passes a naive
-- ^[0-9]+$ and then raises numeric field overflow on the cast.
create or replace function public.tracker_num(t text)
returns numeric language sql immutable parallel safe as $$
  select case when t ~ '^\s*[0-9]{1,9}(\.[0-9]{1,4})?\s*$' then trim(t)::numeric end;
$$;

-- Exact uuid shape. A character class like [0-9a-fA-F-]{36} also matches
-- 36 hyphens, which then reaches ::uuid and raises.
create or replace function public.tracker_is_uuid(t text)
returns boolean language sql immutable parallel safe as $$
  select t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

-- ---- allocate a join code ----------------------------------------
-- Pulled out of tracker_create_group so that rotating a code, and giving
-- a code to a squad that never had one, generate them the same way.
--
-- SECURITY DEFINER for the uniqueness check, not for the writing: groups
-- has RLS, so a caller running as `authenticated` can only see squads it
-- is already in and would happily hand back a code another squad is
-- using, which the partial unique index then rejects. It writes nothing
-- and returns a random unused string, so there is nothing to leak; it is
-- revoked from anon anyway, with the rest.
create or replace function public.tracker_new_join_code()
returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_code text;
  v_try  int := 0;
begin
  -- Ambiguity-free alphabet: no O/0, I/1, S/5. These get read aloud in
  -- a boathouse and typed with cold hands.
  loop
    v_try := v_try + 1;
    select string_agg(substr('ABCDEFGHJKLMNPQRTUVWXYZ23456789',
                             (random() * 30)::int + 1, 1), '')
      into v_code
      from generate_series(1, 6);
    exit when not exists (select 1 from public.groups g where upper(g.join_code) = v_code);
    if v_try > 20 then raise exception 'Could not allocate a join code'; end if;
  end loop;
  return v_code;
end;
$$;

-- ---- give a squad a (new) join code ------------------------------
-- Two jobs, one function. Squads inherited from the coach dashboard
-- predate join_code entirely and have null there, so their admin has no
-- way to invite anyone - the Board tab can only say "no invite code on
-- this squad". And a code that has got out needs to be replaceable, or
-- the only remedy is to abandon the squad and rebuild it.
--
-- Rotating INVALIDATES every link and code already handed out. That is
-- the point of it, and the UI says so before it runs.
create or replace function public.tracker_rotate_code(p_group uuid)
returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_group_admin(p_group) then
    raise exception 'Only a squad admin can change the invite code';
  end if;
  v_code := public.tracker_new_join_code();
  update public.groups set join_code = v_code where id = p_group;
  return v_code;
end;
$$;

-- ---- create a squad ----------------------------------------------
-- SECURITY DEFINER because group_members has no INSERT policy at all:
-- letting a user write it directly would let anyone add themselves to
-- any squad. Creation is the one path that must insert a membership,
-- so it goes through here, where the row written is fixed by the code.
create or replace function public.tracker_create_group(p_name text)
returns table (group_id uuid, join_code text)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id   uuid;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Give the squad a name';
  end if;

  v_code := public.tracker_new_join_code();

  insert into public.groups (name, created_by, join_code)
  values (trim(p_name), auth.uid(), v_code)
  returning id into v_id;

  insert into public.group_members (group_id, profile_id, role, accepted_at)
  values (v_id, auth.uid(), 'admin', now());

  -- Being in the squad is being on its board; see section 2.
  -- ON CONFLICT with NO column list, deliberately. Both of these
  -- functions declare an OUT parameter called group_id, and plpgsql
  -- substitutes its variables into a conflict target - so
  -- `on conflict (profile_id, group_id)` raises
  -- "column reference group_id is ambiguous" and the whole call fails.
  -- The bare form catches any unique violation, and the only unique
  -- constraint on either table is its primary key, so it means exactly
  -- the same thing without naming a column plpgsql can capture.
  insert into public.tracker_sharing (profile_id, group_id)
  values (auth.uid(), v_id)
  on conflict do nothing;

  return query select v_id, v_code;
end;
$$;

-- ---- join a squad by code ----------------------------------------
create or replace function public.tracker_join_group(p_code text)
returns table (group_id uuid, group_name text)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id   uuid;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select g.id, g.name into v_id, v_name
  from public.groups g
  where g.join_code is not null
    and upper(g.join_code) = upper(trim(p_code));

  if v_id is null then
    raise exception 'No squad has that code';
  end if;

  -- ON CONFLICT with NO column list, deliberately. Both of these
  -- functions declare an OUT parameter called group_id, and plpgsql
  -- substitutes its variables into a conflict target - so
  -- `on conflict (profile_id, group_id)` raises
  -- "column reference group_id is ambiguous" and the whole call fails.
  -- The bare form catches any unique violation, and the only unique
  -- constraint on either table is its primary key, so it means exactly
  -- the same thing without naming a column plpgsql can capture.
  insert into public.group_members (group_id, profile_id, role, accepted_at)
  values (v_id, auth.uid(), 'member', now())
  on conflict do nothing;

  insert into public.tracker_sharing (profile_id, group_id)
  values (auth.uid(), v_id)
  on conflict do nothing;

  return query select v_id, v_name;
end;
$$;

-- ---- leave a squad -----------------------------------------------
-- Leaving is how you come off a board: the sharing row goes with the
-- membership, so the next call to tracker_squad_board() cannot see you
-- at all. Nothing of yours was ever copied into the squad, so there is
-- nothing left behind to clean up.
create or replace function public.tracker_leave_group(p_group uuid)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  -- With a null auth.uid() both deletes match nothing anyway, but a
  -- SECURITY DEFINER function should never rely on that for its safety.
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  delete from public.tracker_sharing
   where profile_id = auth.uid() and group_id = p_group;
  -- Tags on this squad's hard ergs mean nothing once you have left it.
  delete from public.tracker_hard_erg_entries e
   using public.tracker_hard_ergs h
   where h.id = e.hard_erg_id and h.group_id = p_group and e.profile_id = auth.uid();
  delete from public.group_members
   where profile_id = auth.uid() and group_id = p_group;
end;
$$;

-- ---- remove someone from a squad (admin only) --------------------
-- The admin is whoever created the squad. group_members has no DELETE
-- policy - deliberately, so nobody can quietly evict anyone by hand - so
-- this is the one path in, and the guard is is_group_admin().
--
-- Removing yourself is refused rather than allowed: leaving is
-- tracker_leave_group, and an admin who removed themselves through here
-- could strand a squad with no admin at all and no way to appoint one.
create or replace function public.tracker_admin_remove_member(p_group uuid, p_profile uuid)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if not public.is_group_admin(p_group) then
    raise exception 'Only a squad admin can remove people';
  end if;
  if p_profile = auth.uid() then
    raise exception 'Use Leave squad to take yourself out';
  end if;
  if not exists (select 1 from public.group_members
                  where group_id = p_group and profile_id = p_profile) then
    raise exception 'That person is not in this squad';
  end if;

  delete from public.tracker_sharing
   where profile_id = p_profile and group_id = p_group;
  -- Templates they posted go too: a template is content shared INTO the
  -- squad, and leaving a stranger's library sitting in it after they have
  -- been removed is not what "removed" means.
  delete from public.tracker_shared_templates
   where profile_id = p_profile and group_id = p_group;
  delete from public.tracker_hard_erg_entries e
   using public.tracker_hard_ergs h
   where h.id = e.hard_erg_id and h.group_id = p_group and e.profile_id = p_profile;
  delete from public.group_members
   where profile_id = p_profile and group_id = p_group;
end;
$$;

-- ---- the board ---------------------------------------------------
-- Returns one row per squad member, counts and totals only. Everything
-- personal is absent by construction: this function never reads notes,
-- per-exercise loads, or session dates.
--
-- Water is counted here as of 2026-08-30. It had to be: water is a discipline
-- the board ranks on in its own right, and "days trained" - shown as context on
-- every athlete's row - would otherwise have under-counted anyone who mostly
-- rows on the water, which in a rowing club is most people.
--
-- Other cardio is counted as of 2026-10-14, for the same reason: a run is a
-- day trained. It is time and a session count only - it has no distance that
-- means anything next to the erg's or the water's.
--
-- Racing was added the same day as water. A claimed race is ALREADY public - it is on
-- the regatta leaderboard under the crew's name - so what crosses here is not
-- the result but the association between an athlete and it, which is exactly
-- what putting yourself on a squad board says. Still counts and totals: a race
-- count and an average of the best three, never the list of races.
--
-- Members who have not opted in are returned with sharing = false and
-- all measures null, so the board can show "3 of 8 sharing" honestly
-- rather than silently pretending the squad is smaller than it is.
-- The period is a KEYWORD, never a caller-supplied date.
--
-- This is the difference between "totals" and "your training diary".
-- With a free date parameter, anyone could call the board twice one day
-- apart and subtract: a days_trained delta of 1 says you trained on that
-- exact date, and if the erg-session delta is 1 then the metres and
-- seconds deltas ARE that single session's numbers. Iterating a year of
-- dates reconstructs the whole calendar. Fixed windows, computed
-- server-side, leave nothing to difference.
--
-- The keywords are 'week' (since Monday), 'lastweek' (the Monday to Sunday
-- before it) and 'month' (since the 1st). A
-- four-digit year is accepted as well: it is the board's "This year", and
-- its Racing mode ranks by season because a week or a month of racing is
-- nought for everyone in September. It stays safe for the same reason the
-- keywords are - the BOUNDARIES are fixed, not chosen. Differencing two
-- whole years only isolates a year's totals. It is matched on an exact
-- ^[0-9]{4}$ and range-checked, so nothing that is not a plain year can
-- get through and become a date.
drop function if exists public.tracker_squad_board(uuid, date);
-- The return signature changed when water was added (and again for cardio), and CREATE OR REPLACE
-- cannot change a function's OUT columns - it fails with "cannot change return
-- type of existing function". Dropping first is what makes this file still
-- idempotent against a database that has the older version.
drop function if exists public.tracker_squad_board(uuid, text);

-- The board's query itself, for any window. NOT callable by any app role:
-- an arbitrary date range is exactly the differencing hole described above,
-- so only the two definer functions that fix the window - the live board and
-- the weekly snapshot - call it. Security invoker, so even if it were exposed
-- it would run under the caller's RLS and see only their own rows.
drop function if exists public.tracker_board_rows(uuid, date, date);
create or replace function public.tracker_board_rows(p_group uuid, p_since date, p_until date)
returns table (
  profile_id       uuid,
  display_name     text,
  sharing          boolean,
  days_trained     int,
  sessions_total   int,
  sessions_weights int,
  sessions_erg     int,
  sessions_water   int,
  sessions_cardio  int,
  sessions_core    int,
  erg_metres       numeric,
  erg_seconds      numeric,
  water_metres     numeric,
  water_seconds    numeric,
  cardio_seconds   numeric,
  races            int,
  races_top3       numeric,
  core_work_s      numeric,
  core_rounds      int,
  weights_sets     int,
  weights_volume   numeric
)
language plpgsql stable set search_path = public, pg_temp as $$
begin
  return query
  with roster as (
    select gm.profile_id as pid,
           (s.profile_id is not null) as opted_in
    from public.group_members gm
    left join public.tracker_sharing s
      on s.profile_id = gm.profile_id and s.group_id = gm.group_id
    where gm.group_id = p_group
  ),
  shared as (select pid from roster where opted_in),
  w as (
    select tw.profile_id as pid,
           count(*)::int as sessions,
           array_agg(distinct tw.date) as dates
    from public.tracker_workouts tw
    join shared on shared.pid = tw.profile_id
    where tw.date >= p_since and tw.date <= p_until
    group by tw.profile_id
  ),
  wsets as (
    -- jsonb: { "<exercise_id>": [ {"r":"8","w":"60"}, ... ] }
    --
    -- Every expansion below is guarded on jsonb_typeof. These columns
    -- have no CHECK constraint, so one member with an odd row - a
    -- hand-written API call, a future format change - would otherwise
    -- raise and take the board down for EVERYONE in the squad.
    select tw.profile_id as pid,
           count(*)::int as n_sets,
           coalesce(sum(
             case when coalesce(te.unit, 'reps') <> 'secs'
                  then public.tracker_num(st.value->>'r') * public.tracker_num(st.value->>'w')
             end
           ), 0)::numeric as volume
    from public.tracker_workouts tw
    join shared on shared.pid = tw.profile_id
    cross join lateral jsonb_each(
      case when jsonb_typeof(tw.sets) = 'object' then tw.sets else '{}'::jsonb end) as ex(key, arr)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ex.arr) = 'array' then ex.arr else '[]'::jsonb end) as st(value)
    -- CASE, not `regex and cast`: an ON clause has no guaranteed
    -- evaluation order, so a malformed key could still reach the cast
    -- and abort with invalid input syntax for uuid.
    left join public.tracker_exercises te
      on te.id = (case when public.tracker_is_uuid(ex.key) then ex.key::uuid end)
    where tw.date >= p_since and tw.date <= p_until
    group by tw.profile_id
  ),
  e as (
    select te2.profile_id as pid,
           count(*)::int as sessions,
           coalesce(sum(te2.distance_m), 0)::numeric as metres,
           coalesce(sum(te2.total_time_s), 0)::numeric as secs,
           array_agg(distinct te2.date) as dates
    from public.tracker_erg_sessions te2
    join shared on shared.pid = te2.profile_id
    where te2.date >= p_since and te2.date <= p_until
    group by te2.profile_id
  ),
  wa as (
    select tws.profile_id as pid,
           count(*)::int as sessions,
           coalesce(sum(tws.distance_m), 0)::numeric as metres,
           coalesce(sum(tws.total_time_s), 0)::numeric as secs,
           array_agg(distinct tws.date) as dates
    from public.tracker_water_sessions tws
    join shared on shared.pid = tws.profile_id
    where tws.date >= p_since and tws.date <= p_until
    group by tws.profile_id
  ),
  oc as (
    select toc.profile_id as pid,
           count(*)::int as sessions,
           coalesce(sum(toc.total_time_s), 0)::numeric as secs,
           array_agg(distinct toc.date) as dates
    from public.tracker_cardio_sessions toc
    join shared on shared.pid = toc.profile_id
    where toc.date >= p_since and toc.date <= p_until
    group by toc.profile_id
  ),
  ra as (
    -- Racing. Deliberately NOT folded into days_trained or sessions_total:
    -- those count training that was logged as it happened, and a claimed race
    -- is a public result attached retrospectively. Mixing them would let a
    -- quiet afternoon of claiming last season's regattas read as a week of
    -- training. It is its own mode on the board, with its own measures.
    --
    -- Top three, matching the Races tab: a person races a handful of times a
    -- season, so a plain average is dragged down by the row you did in a gale
    -- and a maximum is one good day.
    select tr.profile_id as pid,
           count(*)::int as races,
           (select avg(x.pct) from (
              select t2.pct from public.tracker_races t2
              where t2.profile_id = tr.profile_id
                and t2.date >= p_since
                and t2.date <= p_until
                and t2.pct is not null
              order by t2.pct desc
              limit 3) x) as top3
    from public.tracker_races tr
    join shared on shared.pid = tr.profile_id
    where tr.date >= p_since and tr.date <= p_until
    group by tr.profile_id
  ),
  c as (
    select tc.profile_id as pid,
           count(distinct tc.id)::int as sessions,
           coalesce(sum(public.tracker_num(stp.value->>'actual_s')), 0)::numeric as work_s,
           count(stp.value)::int as rounds,
           array_agg(distinct tc.date) as dates
    from public.tracker_core_sessions tc
    join shared on shared.pid = tc.profile_id
    left join lateral jsonb_array_elements(
      case when jsonb_typeof(tc.steps) = 'array' then tc.steps else '[]'::jsonb end) as stp(value) on true
    where tc.date >= p_since and tc.date <= p_until
    group by tc.profile_id
  )
  select
    r.pid,
    coalesce(p.display_name, 'Athlete'),
    r.opted_in,
    case when r.opted_in then (
      select count(distinct d)::int from unnest(
        coalesce(w.dates,  '{}'::date[]) ||
        coalesce(e.dates,  '{}'::date[]) ||
        coalesce(wa.dates, '{}'::date[]) ||
        coalesce(oc.dates, '{}'::date[]) ||
        coalesce(c.dates,  '{}'::date[])
      ) as d
    ) end,
    case when r.opted_in then coalesce(w.sessions, 0) + coalesce(e.sessions, 0)
                            + coalesce(wa.sessions, 0) + coalesce(oc.sessions, 0)
                            + coalesce(c.sessions, 0) end,
    case when r.opted_in then coalesce(w.sessions, 0) end,
    case when r.opted_in then coalesce(e.sessions, 0) end,
    case when r.opted_in then coalesce(wa.sessions, 0) end,
    case when r.opted_in then coalesce(oc.sessions, 0) end,
    case when r.opted_in then coalesce(c.sessions, 0) end,
    case when r.opted_in then coalesce(e.metres, 0) end,
    case when r.opted_in then coalesce(e.secs, 0) end,
    case when r.opted_in then coalesce(wa.metres, 0) end,
    case when r.opted_in then coalesce(wa.secs, 0) end,
    case when r.opted_in then coalesce(oc.secs, 0) end,
    case when r.opted_in then coalesce(ra.races, 0) end,
    -- null rather than 0 when there are no races: nought would sort as the
    -- worst GMT anyone ever rowed, when it means "has not raced".
    case when r.opted_in then ra.top3 end,
    case when r.opted_in then coalesce(c.work_s, 0) end,
    case when r.opted_in then coalesce(c.rounds, 0) end,
    case when r.opted_in then coalesce(wsets.n_sets, 0) end,
    case when r.opted_in then coalesce(wsets.volume, 0) end
  from roster r
  left join public.profiles p on p.id = r.pid
  left join w     on w.pid     = r.pid
  left join wsets on wsets.pid = r.pid
  left join e     on e.pid     = r.pid
  left join wa    on wa.pid    = r.pid
  left join oc    on oc.pid    = r.pid
  left join ra    on ra.pid    = r.pid
  left join c     on c.pid     = r.pid;
end;
$$;

create or replace function public.tracker_squad_board(p_group uuid, p_period text)
returns table (
  profile_id       uuid,
  display_name     text,
  sharing          boolean,
  days_trained     int,
  sessions_total   int,
  sessions_weights int,
  sessions_erg     int,
  sessions_water   int,
  sessions_cardio  int,
  sessions_core    int,
  erg_metres       numeric,
  erg_seconds      numeric,
  water_metres     numeric,
  water_seconds    numeric,
  cardio_seconds   numeric,
  races            int,
  races_top3       numeric,
  core_work_s      numeric,
  core_rounds      int,
  weights_sets     int,
  weights_volume   numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p_since date;
  p_until date;
begin
  -- Not a member: no rows. Not an error, which would confirm the squad
  -- exists to someone guessing ids.
  if not public.is_group_member(p_group) then
    return;
  end if;

  if p_period ~ '^[0-9]{4}$' and p_period::int between 2000 and 2100 then
    -- A whole calendar year. Calendar rather than "season" on purpose: the
    -- Races tab groups by calendar year too, and every regatta in the results
    -- file runs May to July, so for racing the two are the same thing.
    p_since := (p_period || '-01-01')::date;
    p_until := (p_period || '-12-31')::date;
  else
    p_since := case p_period
      when 'month' then date_trunc('month', now())::date
      when 'lastweek' then date_trunc('week', now())::date - 7
      else date_trunc('week', now())::date          -- 'week', and anything unrecognised
    end;
    -- Last week is the one keyword with an end: the Sunday before this Monday.
    p_until := case p_period
      when 'lastweek' then date_trunc('week', now())::date - 1
      else date '9999-12-31'
    end;
  end if;

  return query select * from public.tracker_board_rows(p_group, p_since, p_until);
end;
$$;

-- ---- weekly snapshots ------------------------------------------------
-- Every squad's board for each finished Monday-to-Sunday week, saved once and
-- never recomputed: names and totals as they stood. Someone leaving or being
-- removed, or a session edited months later, does not rewrite a past week.
-- That is the point - "what did the squad do in the week of 6 October" has
-- one answer.
--
-- Safe for the same reason 'lastweek' is: whole weeks with fixed
-- boundaries, the same numbers the live board showed for that week. Nothing
-- finer than a week can be differenced out of it.
--
-- A week is taken on the Tuesday after it ends (00:05 UTC), so a session
-- logged late on Monday morning still counts. Until then "Last week" on the
-- board is live. Deleting an account cascades its rows away; leaving a squad
-- does not.
create table if not exists public.tracker_board_weeks (
  group_id         uuid        not null references public.groups   on delete cascade,
  week_start       date        not null check (extract(isodow from week_start) = 1),
  profile_id       uuid        not null references public.profiles on delete cascade,
  taken_at         timestamptz not null default now(),
  display_name     text,
  sharing          boolean,
  days_trained     int,
  sessions_total   int,
  sessions_weights int,
  sessions_erg     int,
  sessions_water   int,
  sessions_cardio  int,
  sessions_core    int,
  erg_metres       numeric,
  erg_seconds      numeric,
  water_metres     numeric,
  water_seconds    numeric,
  cardio_seconds   numeric,
  races            int,
  races_top3       numeric,
  core_work_s      numeric,
  core_rounds      int,
  weights_sets     int,
  weights_volume   numeric,
  primary key (group_id, week_start, profile_id)
);
create index if not exists tracker_board_weeks_week_idx
  on public.tracker_board_weeks (group_id, week_start desc);

-- Totals only, the same as the live board, so members read them directly.
-- No write policy: only tracker_snapshot_week() writes here.
alter table public.tracker_board_weeks enable row level security;
drop policy if exists "squad reads past weeks" on public.tracker_board_weeks;
create policy "squad reads past weeks" on public.tracker_board_weeks
  for select using (public.is_group_member(group_id));

create or replace function public.tracker_snapshot_week(p_monday date)
returns int
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  g record;
  k int;
  n int := 0;
begin
  if extract(isodow from p_monday) <> 1 then
    raise exception 'Not a Monday: %', p_monday;
  end if;
  if current_date < p_monday + 8 then
    raise exception 'The week of % is not finished and settled yet', p_monday;
  end if;
  for g in select id from public.groups loop
    insert into public.tracker_board_weeks (group_id, week_start, profile_id, display_name, sharing, days_trained, sessions_total, sessions_weights, sessions_erg, sessions_water, sessions_cardio, sessions_core, erg_metres, erg_seconds, water_metres, water_seconds, cardio_seconds, races, races_top3, core_work_s, core_rounds, weights_sets, weights_volume)
    select g.id, p_monday, b.profile_id, b.display_name, b.sharing, b.days_trained, b.sessions_total, b.sessions_weights, b.sessions_erg, b.sessions_water, b.sessions_cardio, b.sessions_core, b.erg_metres, b.erg_seconds, b.water_metres, b.water_seconds, b.cardio_seconds, b.races, b.races_top3, b.core_work_s, b.core_rounds, b.weights_sets, b.weights_volume
    from public.tracker_board_rows(g.id, p_monday, p_monday + 6) b
    on conflict do nothing;
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end;
$$;

-- Backfill: every finished week since the oldest squad, a year at most. It
-- uses today's members, the best that can be known now; from here on each
-- week is taken as it ends. ON CONFLICT DO NOTHING keeps re-runs harmless and
-- never overwrites a week already saved.
do $$
declare
  m date;
begin
  select greatest(date_trunc('week', min(created_at))::date,
                  date_trunc('week', now())::date - 7 * 52)
    into m from public.groups;
  while m is not null and current_date >= m + 8 loop
    perform public.tracker_snapshot_week(m);
    m := m + 7;
  end loop;
end;
$$;

-- The weekly job. Needs the pg_cron extension: Supabase dashboard >
-- Database > Extensions > pg_cron, then re-run this file. Without it nothing
-- breaks - "Last week" stays live and no new weeks are added to history -
-- and the report says so.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('tracker-board-weeks', '5 0 * * 2',
      $job$select public.tracker_snapshot_week(date_trunc('week', now())::date - 7)$job$);
  end if;
end;
$$;

-- ---- a hard erg's ranking ------------------------------------------
-- One row per current member who has tagged at least one session as this
-- hard erg: their fastest average split, and the time and distance of the
-- session it came from. Only tagged sessions are read, and only the three
-- numbers that make the result - never the date, the notes or the splits
-- table. A session edited out of the window drops off by itself.
--
-- The split is the stored average where there is one, else time over
-- distance, so a session typed in as just a time and a distance still
-- ranks.
--
-- While a hard erg is open, and for a week after it closes (late entries),
-- the ranking is live. Then it is FROZEN: the final ranking is saved to
-- tracker_hard_erg_results and read from there for good, so someone leaving
-- the squad or untagging later does not rewrite the result. The screen link
-- on a frozen row only shows while that session is still tagged with its
-- photo - a photo is never kept past its owner's say-so.

-- The live query. Not callable by any app role; the board and the freeze are
-- its only callers. Security invoker.
drop function if exists public.tracker_hard_erg_rows(uuid);
create or replace function public.tracker_hard_erg_rows(p_hard_erg uuid)
returns table (
  athlete_id      uuid,
  athlete_name    text,
  best_split_s    numeric,
  best_time_s     numeric,
  best_distance_m int,
  attempts        int,
  best_screen     text,
  best_session_id uuid
)
language plpgsql stable set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_group uuid;
  v_from  date;
  v_to    date;
begin
  select h.group_id, h.starts_on, h.ends_on into v_group, v_from, v_to
  from public.tracker_hard_ergs h where h.id = p_hard_erg;
  if v_group is null then return; end if;

  return query
  with tagged as (
    select e.profile_id as pid,
           s.id as sid,
           s.total_time_s as t_s,
           s.distance_m as d_m,
           s.screen_path as shot,
           coalesce(s.avg_split_s,
             case when s.distance_m > 0 and s.total_time_s > 0
                  then s.total_time_s / (s.distance_m / 500.0) end) as split
    from public.tracker_hard_erg_entries e
    join public.tracker_erg_sessions s
      on s.id = e.erg_session_id and s.profile_id = e.profile_id
    join public.group_members gm
      on gm.group_id = v_group and gm.profile_id = e.profile_id
    where e.hard_erg_id = p_hard_erg
      and s.date between v_from and v_to
  ),
  best as (
    select distinct on (pid) pid, sid, split, t_s, d_m, shot,
           count(*) over (partition by pid) as n
    from tagged
    where split is not null
    order by pid, split asc
  )
  select b.pid, coalesce(p.display_name, 'Athlete'), round(b.split, 1),
         b.t_s, b.d_m, b.n::int, b.shot, b.sid
  from best b
  left join public.profiles p on p.id = b.pid;
end;
$$;

create table if not exists public.tracker_hard_erg_results (
  hard_erg_id     uuid        not null references public.tracker_hard_ergs on delete cascade,
  athlete_id      uuid        not null references public.profiles          on delete cascade,
  athlete_name    text,
  best_split_s    numeric,
  best_time_s     numeric,
  best_distance_m int,
  attempts        int,
  best_session_id uuid,
  taken_at        timestamptz not null default now(),
  primary key (hard_erg_id, athlete_id)
);
-- Read only through tracker_hard_erg_board(); no policies, so no direct access.
alter table public.tracker_hard_erg_results enable row level security;

-- Freezes every hard erg that closed more than a week ago and has not been
-- frozen yet. Run daily by pg_cron, and once when this file runs.
create or replace function public.tracker_freeze_hard_ergs()
returns int
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  h record;
  n int := 0;
begin
  for h in select x.id from public.tracker_hard_ergs x
            where x.frozen_at is null and x.ends_on + 7 < current_date loop
    insert into public.tracker_hard_erg_results
      (hard_erg_id, athlete_id, athlete_name, best_split_s, best_time_s, best_distance_m, attempts, best_session_id)
    select h.id, r.athlete_id, r.athlete_name, r.best_split_s, r.best_time_s, r.best_distance_m,
           r.attempts, r.best_session_id
    from public.tracker_hard_erg_rows(h.id) r
    on conflict do nothing;
    update public.tracker_hard_ergs set frozen_at = now() where id = h.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- The ranking as the app reads it: frozen if it has been, live otherwise.
-- best_screen was added after the first version, and CREATE OR REPLACE cannot
-- change a function's OUT columns.
drop function if exists public.tracker_hard_erg_board(uuid);
create or replace function public.tracker_hard_erg_board(p_hard_erg uuid)
returns table (
  athlete_id      uuid,
  athlete_name    text,
  best_split_s    numeric,
  best_time_s     numeric,
  best_distance_m int,
  attempts        int,
  best_screen     text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_group  uuid;
  v_frozen timestamptz;
begin
  select h.group_id, h.frozen_at into v_group, v_frozen
  from public.tracker_hard_ergs h where h.id = p_hard_erg;
  -- Unknown, or not your squad: no rows, the same answer either way.
  if v_group is null or not public.is_group_member(v_group) then
    return;
  end if;

  if v_frozen is null then
    return query
    select r.athlete_id, r.athlete_name, r.best_split_s, r.best_time_s,
           r.best_distance_m, r.attempts, r.best_screen
    from public.tracker_hard_erg_rows(p_hard_erg) r;
  else
    return query
    select r.athlete_id, r.athlete_name, r.best_split_s, r.best_time_s,
           r.best_distance_m, r.attempts,
           -- the photo only while its owner still has it tagged here
           (select s.screen_path from public.tracker_erg_sessions s
              join public.tracker_hard_erg_entries e
                on e.erg_session_id = s.id and e.hard_erg_id = p_hard_erg
             where s.id = r.best_session_id)
    from public.tracker_hard_erg_results r
    where r.hard_erg_id = p_hard_erg;
  end if;
end;
$$;

-- Freeze anything already due, then schedule the daily run.
select public.tracker_freeze_hard_ergs();
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('tracker-freeze-hard-ergs', '10 0 * * *',
      $job$select public.tracker_freeze_hard_ergs()$job$);
  end if;
end;
$$;

-- ---- erg screens ----------------------------------------------------
-- The monitor photo behind a hard erg attempt, kept only when the athlete
-- ticked "show my erg screen" while logging it. Private bucket, one file per
-- session at <owner uuid>/<session uuid>.jpg. The app deletes the file once
-- the session has no hard erg tags left.
--
-- Read: the owner, or a member of a squad whose hard erg the session is
-- tagged to. The tag rows are owner-only under RLS, so a policy cannot look
-- through them as the reader - this SECURITY DEFINER helper does, and answers
-- only yes or no.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('erg-screens', 'erg-screens', false, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];

create or replace function public.tracker_can_see_screen(p_name text)
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.tracker_hard_erg_entries e
    join public.tracker_hard_ergs h on h.id = e.hard_erg_id
    where public.tracker_is_uuid(split_part(p_name, '/', 1))
      and public.tracker_is_uuid(split_part(split_part(p_name, '/', 2), '.', 1))
      and e.profile_id::text     = split_part(p_name, '/', 1)
      and e.erg_session_id::text = split_part(split_part(p_name, '/', 2), '.', 1)
      and public.is_group_member(h.group_id)
  );
$$;
revoke execute on function public.tracker_can_see_screen(text) from public, anon;
grant  execute on function public.tracker_can_see_screen(text) to authenticated, service_role;

drop policy if exists "erg screens: read own or tagged" on storage.objects;
create policy "erg screens: read own or tagged" on storage.objects
  for select to authenticated using (
    bucket_id = 'erg-screens'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.tracker_can_see_screen(name))
  );

drop policy if exists "erg screens: upload own" on storage.objects;
create policy "erg screens: upload own" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'erg-screens' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- upsert on upload needs UPDATE as well as INSERT
drop policy if exists "erg screens: replace own" on storage.objects;
create policy "erg screens: replace own" on storage.objects
  for update to authenticated using (
    bucket_id = 'erg-screens' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "erg screens: delete own" on storage.objects;
create policy "erg screens: delete own" on storage.objects
  for delete to authenticated using (
    bucket_id = 'erg-screens' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- EXECUTE: revoke from PUBLIC first, then grant.
--
-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, so a
-- plain `grant ... to authenticated` changes nothing and quietly implies
-- a restriction that is not there. Verified against the live database: a
-- signed-out caller holding only the publishable key could reach every
-- one of these. Nothing leaked - each function's auth.uid() guard held -
-- but a SECURITY DEFINER function runs as its owner, so "the guard
-- happened to hold" is not the posture to settle for.
-- Only the four functions this file owns. is_group_member/is_group_admin
-- are inherited, and RLS policies on the older tables still call them: a
-- policy is evaluated as the querying role, so revoking PUBLIC there
-- would turn a signed-out read of those tables from "no rows" into
-- "permission denied for function". They return false to anon anyway.
-- from PUBLIC *and* from anon. Supabase ships
--   alter default privileges in schema public
--     grant all on functions to anon, authenticated, service_role;
-- so a new function is granted to anon DIRECTLY, not only through
-- PUBLIC. Revoking PUBLIC alone leaves that grant in place and looks
-- like it worked. Verified by probing the live database with the
-- publishable key: after a PUBLIC-only revoke, anon could still execute
-- all four.
revoke execute on function public.tracker_create_group(text)       from public, anon;
revoke execute on function public.tracker_join_group(text)         from public, anon;
revoke execute on function public.tracker_leave_group(uuid)        from public, anon;
revoke execute on function public.tracker_admin_remove_member(uuid, uuid) from public, anon;
revoke execute on function public.tracker_rotate_code(uuid)       from public, anon;
revoke execute on function public.tracker_new_join_code()         from public, anon;
revoke execute on function public.tracker_squad_board(uuid, text)  from public, anon;
revoke execute on function public.tracker_hard_erg_board(uuid)     from public, anon;
-- Not even authenticated: these take a raw window (see their comments).
revoke execute on function public.tracker_board_rows(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.tracker_snapshot_week(date)      from public, anon, authenticated;
revoke execute on function public.tracker_hard_erg_rows(uuid)      from public, anon, authenticated;
revoke execute on function public.tracker_freeze_hard_ergs()       from public, anon, authenticated;

grant execute on function public.tracker_create_group(text)        to authenticated, service_role;
grant execute on function public.tracker_join_group(text)          to authenticated, service_role;
grant execute on function public.tracker_leave_group(uuid)         to authenticated, service_role;
grant execute on function public.tracker_admin_remove_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.tracker_rotate_code(uuid)         to authenticated, service_role;
-- tracker_new_join_code stays service_role only: it is an implementation
-- detail of the two functions above, and nothing in the app calls it.
grant execute on function public.tracker_new_join_code()           to service_role;
grant execute on function public.tracker_squad_board(uuid, text)   to authenticated, service_role;
grant execute on function public.tracker_hard_erg_board(uuid)      to authenticated, service_role;
grant execute on function public.tracker_board_rows(uuid, date, date) to service_role;
grant execute on function public.tracker_snapshot_week(date)       to service_role;
grant execute on function public.tracker_hard_erg_rows(uuid)       to service_role;
grant execute on function public.tracker_freeze_hard_ergs()        to service_role;
-- tracker_num / tracker_is_uuid are pure helpers with no data access, so
-- the PUBLIC default is fine for them.


-- ================================================================
-- PART 4 - profiles column grants. READ BEFORE RUNNING.
--
-- RLS cannot express "every column except these two", so the blanket
-- UPDATE on profiles is revoked and granted back column by column. That
-- is what stops a user setting tracker_plan = 'paid' with one REST call.
--
-- Left commented because re-running it would silently revoke any
-- user-writable profiles column added since. The report prints the
-- current grants FIRST - check that list, add anything missing to the
-- grant, then run this.
-- ================================================================
-- revoke update on public.profiles from authenticated;
-- grant  update (display_name, email, terms_accepted_at, terms_version) on public.profiles to authenticated;

-- ================================================================
-- REPORT - one query, because the SQL editor only shows the result of
-- the LAST statement. Nothing below changes anything.
--
-- Read it top to bottom. Anything not saying "ok" wants attention.
-- ================================================================
with expected(tbl, col) as (values
  ('tracker_exercises','session_groups'), ('tracker_exercises','pattern'),
  ('tracker_exercises','unit'), ('tracker_exercises','per_side'),
  ('tracker_exercises','bodyweight'), ('tracker_exercises','note'),
  ('tracker_exercises','position'), ('tracker_exercises','retired'),
  ('tracker_workouts','date'), ('tracker_workouts','at'),
  ('tracker_workouts','sets'), ('tracker_workouts','notes'),
  ('tracker_erg_sessions','source'), ('tracker_erg_sessions','erg_type'),
  ('tracker_erg_sessions','session_type'), ('tracker_erg_sessions','total_time_s'),
  ('tracker_erg_sessions','distance_m'), ('tracker_erg_sessions','avg_split_s'),
  ('tracker_erg_sessions','avg_rate'), ('tracker_erg_sessions','avg_hr'),
  ('tracker_erg_sessions','intervals'), ('tracker_erg_sessions','notes'),
  ('tracker_erg_sessions','screen_path'),
  ('tracker_core_routines','name'), ('tracker_core_routines','steps'),
  ('tracker_core_routines','position'), ('tracker_core_routines','retired'),
  ('tracker_core_sessions','routine_id'), ('tracker_core_sessions','routine_name'),
  ('tracker_core_sessions','steps'), ('tracker_core_sessions','notes'),
  ('tracker_water_sessions','distance_m'), ('tracker_water_sessions','total_time_s'),
  ('tracker_water_sessions','boat'), ('tracker_water_sessions','notes'),
  ('tracker_cardio_sessions','activity'), ('tracker_cardio_sessions','total_time_s'),
  ('tracker_cardio_sessions','notes'),
  ('tracker_races','race_key'), ('tracker_races','comp'), ('tracker_races','comp_title'),
  ('tracker_races','date'), ('tracker_races','club'), ('tracker_races','crew'),
  ('tracker_races','event'), ('tracker_races','round'), ('tracker_races','boat'),
  ('tracker_races','time'), ('tracker_races','clock'), ('tracker_races','pct'),
  ('tracker_races','venue'), ('tracker_races','place'), ('tracker_races','field'),
  ('tracker_sharing','group_id'), ('tracker_shared_templates','payload'),
  ('groups','join_code'),
  ('profiles','tracker_plan'), ('profiles','tracker_trial_ends_at'),
  ('profiles','terms_accepted_at'), ('profiles','terms_version')
),
cols as (
  select e.tbl, e.col, (c.column_name is not null) as present
  from expected e
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = e.tbl and c.column_name = e.col
)
select section, item, result from (

  -- 1. THE PRIVACY INVARIANT. Each of these must have exactly ONE policy.
  --    More than one means someone widened SELECT and squad-mates may be
  --    able to read raw sessions.
  select 1 as ord, '1 tracker tables owner-only' as section, t.tbl as item,
    (select count(*) from pg_policies p
      where p.schemaname='public' and p.tablename=t.tbl)::text || ' policy(ies)' ||
    case when (select count(*) from pg_policies p
                where p.schemaname='public' and p.tablename=t.tbl) = 1
         then ' - ok' else ' - ** CHECK THIS **' end as result
  from (values ('tracker_exercises'), ('tracker_workouts'), ('tracker_erg_sessions'),
               ('tracker_core_routines'), ('tracker_core_sessions'),
               ('tracker_water_sessions'), ('tracker_cardio_sessions'),
               ('tracker_races')) as t(tbl)

  -- 2. Tables present, and RLS actually on.
  union all
  select 2, '2 tables', t.tbl,
    case when to_regclass('public.' || t.tbl) is null then '** MISSING **'
         else 'ok - rls ' ||
              case when (select c.relrowsecurity from pg_class c
                         join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname='public' and c.relname=t.tbl)
                   then 'on' else '** OFF **' end end
  from (values ('tracker_exercises'), ('tracker_workouts'), ('tracker_erg_sessions'),
               ('tracker_core_routines'), ('tracker_core_sessions'),
               ('tracker_water_sessions'), ('tracker_cardio_sessions'),
               ('tracker_races'), ('tracker_erg_parses'),
               ('groups'), ('group_members'), ('tracker_sharing'),
               ('tracker_shared_templates'), ('tracker_hard_ergs'),
               ('tracker_hard_erg_entries'), ('tracker_board_weeks'),
               ('tracker_hard_erg_results')) as t(tbl)

  -- 3. Every column the app writes.
  union all
  select 3, '3 columns', 'columns the app writes',
    (select count(*) filter (where present) from cols)::text || ' of ' ||
    (select count(*) from cols)::text || ' present' ||
    case when (select count(*) filter (where not present) from cols) = 0
         then ' - ok' else ' - ** SEE BELOW **' end
  union all
  select 3, '3 columns', tbl || '.' || col, '** MISSING - saves will fail **'
  from cols where not present

  -- 4. Functions.
  union all
  select 4, '4 functions', f.item,
         case when f.present then 'ok' else '** MISSING or wrong signature **' end
  from (
    select 'is_group_member(uuid)' as item, to_regprocedure('public.is_group_member(uuid)') is not null as present
    union all select 'tracker_create_group(text)', to_regprocedure('public.tracker_create_group(text)') is not null
    union all select 'tracker_join_group(text)',   to_regprocedure('public.tracker_join_group(text)') is not null
    union all select 'tracker_leave_group(uuid)',  to_regprocedure('public.tracker_leave_group(uuid)') is not null
    union all select 'tracker_admin_remove_member(uuid,uuid)', to_regprocedure('public.tracker_admin_remove_member(uuid,uuid)') is not null
    union all select 'tracker_rotate_code(uuid)',  to_regprocedure('public.tracker_rotate_code(uuid)') is not null
    union all select 'tracker_new_join_code()',    to_regprocedure('public.tracker_new_join_code()') is not null
    union all select 'tracker_squad_board(uuid,text)', to_regprocedure('public.tracker_squad_board(uuid,text)') is not null
    union all select 'tracker_hard_erg_board(uuid)', to_regprocedure('public.tracker_hard_erg_board(uuid)') is not null
    union all select 'tracker_board_rows(uuid,date,date)', to_regprocedure('public.tracker_board_rows(uuid,date,date)') is not null
    union all select 'tracker_hard_erg_rows(uuid)', to_regprocedure('public.tracker_hard_erg_rows(uuid)') is not null
    union all select 'tracker_freeze_hard_ergs()', to_regprocedure('public.tracker_freeze_hard_ergs()') is not null
    union all select 'tracker_snapshot_week(date)', to_regprocedure('public.tracker_snapshot_week(date)') is not null
    union all select 'tracker_can_see_screen(text)', to_regprocedure('public.tracker_can_see_screen(text)') is not null
    union all select 'erg-screens bucket (private)',
      exists (select 1 from storage.buckets b where b.id = 'erg-screens' and not b.public)
  ) f
  -- The date-taking board is the differencing hole. It must NOT exist.
  union all
  select 4, '4 functions', 'tracker_squad_board(uuid,DATE) is gone',
         case when to_regprocedure('public.tracker_squad_board(uuid,date)') is null
              then 'ok - absent' else '** STILL PRESENT - DROP IT **' end

  -- 5. Who can execute the definer functions. Want authenticated, and
  --    NOT public/anon - PostgreSQL grants EXECUTE to PUBLIC by default.
  union all
  select 5, '5 execute grants', p.proname::text,
    coalesce((select string_agg(distinct coalesce(r.rolname, 'PUBLIC'), ', ')
              from aclexplode(p.proacl) x
              left join pg_roles r on r.oid = x.grantee
              where x.privilege_type = 'EXECUTE'),
             '** PUBLIC - everyone, including signed-out **')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public'
    and p.proname in ('tracker_create_group','tracker_join_group',
                      'tracker_leave_group','tracker_squad_board','tracker_hard_erg_board',
                      'tracker_can_see_screen','tracker_board_rows','tracker_snapshot_week',
                      'tracker_hard_erg_rows','tracker_freeze_hard_ergs',
                      'tracker_admin_remove_member','tracker_rotate_code',
                      'tracker_new_join_code')

  -- 4b. Past weeks: how many are saved, and whether the weekly job exists.
  union all
  select 4, '4 past weeks', 'weeks saved',
    (select count(distinct (group_id, week_start)) from public.tracker_board_weeks)::text ||
    ' squad-weeks, latest ' ||
    coalesce((select max(week_start)::text from public.tracker_board_weeks), 'none')
  union all
  select 4, '4 past weeks', 'hard ergs with a final ranking',
    (select count(*) from public.tracker_hard_ergs where frozen_at is not null)::text || ' of ' ||
    (select count(*) from public.tracker_hard_ergs)::text
  union all
  select 4, '4 past weeks', 'weekly snapshot job',
    case when not exists (select 1 from pg_extension where extname = 'pg_cron')
         then '** pg_cron not enabled - Database > Extensions > pg_cron, then re-run **'
         else 'ok - pg_cron on (weekly boards Tue 00:05, hard erg results daily 00:10 UTC)' end

  -- 6. The join model depends on group_members having SELECT only.
  union all
  select 6, '6 group tables (want: SELECT only)', t.tbl,
    coalesce((select string_agg(distinct p.cmd, ', ' order by p.cmd) from pg_policies p
               where p.schemaname='public' and p.tablename=t.tbl), '(no policies)')
  from (values ('groups'), ('group_members')) as t(tbl)

  -- 6b. Sharing and templates. tracker_shared_templates wants SELECT (any
  --     member reads), INSERT (post your own) and DELETE (yours, or an
  --     admin's clear-out). Miss the SELECT and a template someone posted
  --     is invisible to everyone else, with nothing on screen to say why.
  union all
  select 6, '6 group tables (want: SELECT only)', t.tbl || ' (want: ' || t.want || ')',
    coalesce((select string_agg(distinct p.cmd, ', ' order by p.cmd) from pg_policies p
               where p.schemaname='public' and p.tablename=t.tbl), '** NO POLICIES - nothing is readable **')
  from (values ('tracker_sharing', 'ALL, SELECT'),
               ('tracker_shared_templates', 'DELETE, INSERT, SELECT')) as t(tbl, want)

  -- 8. What is actually in each squad, read as the owner so RLS cannot
  --    hide the answer from you. If a template someone posted is missing
  --    from the app, look here first: a count of 0 means the post never
  --    landed, and a count above 0 means the reader's SELECT is the
  --    problem, not the write.
  union all
  select 8, '8 squads', coalesce(g.name, '(unnamed)') || ' ' ||
    case when g.join_code is null then '[NO CODE]' else '[' || g.join_code || ']' end,
    (select count(*) from public.group_members m where m.group_id = g.id)::text || ' members, ' ||
    (select count(*) from public.tracker_sharing sh where sh.group_id = g.id)::text || ' on the board, ' ||
    (select count(*) from public.tracker_shared_templates t where t.group_id = g.id)::text || ' templates' ||
    case when g.join_code is null
         then ' - ** no invite code: use Board > Create an invite code **' else '' end
  from public.groups g

  -- 9. What the erg photo reader has actually cost. Every call is logged
  --    here, successes and failures, so this is the honest answer to "is
  --    anyone burning my key" - and the only place it is visible, because
  --    the users who can see their own rows cannot see each other's.
  union all
  select 9, '9 erg photo spend', 'calls in the last 24 hours',
    (select count(*) from public.tracker_erg_parses
      where created_at >= now() - interval '24 hours')::text ||
    ' by ' || (select count(distinct profile_id) from public.tracker_erg_parses
      where created_at >= now() - interval '24 hours')::text || ' user(s)'
  union all
  select 9, '9 erg photo spend', 'calls in the last 30 days',
    (select count(*) from public.tracker_erg_parses
      where created_at >= now() - interval '30 days')::text ||
    ' by ' || (select count(distinct profile_id) from public.tracker_erg_parses
      where created_at >= now() - interval '30 days')::text || ' user(s)'
  -- Who has which allowance. Under the two-plan model everyone can read
  -- photos, so the question is no longer "who is entitled" but "how many
  -- accounts are on 20 a day rather than 2". A non-zero 'free' count means
  -- rows predating the default change were missed - nothing assigns it now.
  union all
  select 9, '9 erg photo spend', 'accounts by plan',
    (select count(*) from public.profiles where tracker_plan = 'paid')::text  || ' paid (20/day), ' ||
    (select count(*) from public.profiles where tracker_plan = 'trial')::text || ' trial (2/day)' ||
    case when (select count(*) from public.profiles where tracker_plan = 'free') > 0
         then ', ** ' || (select count(*) from public.profiles where tracker_plan = 'free')::text ||
              ' still on free - no photos at all, should be zero **'
         else '' end
  union all
  select 9, '9 erg photo spend', 'paid accounts',
    coalesce((select string_agg(coalesce(display_name, id::text), ', ')
              from public.profiles where tracker_plan = 'paid'),
             'none yet - everyone is on the free 2/day')

  -- 7. Which profiles columns a signed-in user may write. tracker_plan
  --    must NOT be here, or anyone can grant themselves the paid reader.
  union all
  select 7, '7 entitlement', 'authenticated may UPDATE profiles',
    coalesce((select string_agg(column_name, ', ' order by column_name)
              from information_schema.column_privileges
              where table_schema='public' and table_name='profiles'
                and grantee='authenticated' and privilege_type='UPDATE'),
             '(nothing - blanket update already revoked)')
  union all
  select 7, '7 entitlement', 'tracker_plan is user-writable',
    case when exists (select 1 from information_schema.column_privileges
                      where table_schema='public' and table_name='profiles'
                        and grantee='authenticated' and privilege_type='UPDATE'
                        and column_name='tracker_plan')
         then '** YES - run PART 4 **' else 'no - ok' end

) report
order by ord, item;
