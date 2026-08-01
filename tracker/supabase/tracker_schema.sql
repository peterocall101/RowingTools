-- ================================================================
-- RowingTools athlete workout tracker - database schema (ADDITIVE)
-- Run in: Supabase dashboard > SQL Editor on the existing RowingTools
-- project (ref tbhujqdflswhgxtioznb) - the same project as the coach
-- dashboard. Requires the dashboard schema's public.profiles table and
-- handle_new_user() trigger to already be applied (they are, live).
--
-- When the dashboard branch merges, fold this file into
-- dashboard/supabase/schema.sql (single source of truth).
--
-- Model: strictly personal data. Every table is keyed by profile_id
-- and RLS is owner-only (profile_id = auth.uid()). No squad linkage;
-- coach visibility can come later without schema changes here.
-- ================================================================

-- ----------------------------------------------------------------
-- Exercise library - user-defined, replaces the hardcoded programme
-- ----------------------------------------------------------------
-- session_groups = the user's own session labels ("Session 1", "Gym A"...).
--            An array, because the same lift often appears in more than one
--            session. It stays ONE exercise with one id, so history, last-time
--            prefill and bests never get split across the groups it sits in.
-- pattern  = movement type used to section the log page. Free text so
--            users aren't boxed in; the UI suggests the common ones.
-- retired  = soft delete. Old workouts reference exercises by id, so a
--            deleted-but-used exercise is retired instead, keeping
--            history and summaries classifying correctly.
create table public.tracker_exercises (
  id          uuid        primary key default gen_random_uuid(),
  profile_id  uuid        not null references public.profiles on delete cascade,
  name        text        not null,
  session_groups text[]      not null default '{"Session 1"}',
  pattern     text        not null default 'other',
  unit        text        not null default 'reps' check (unit in ('reps', 'secs')),
  per_side    boolean     not null default false,   -- reps are each side
  bodyweight  boolean     not null default false,   -- weight field = added load ("+kg")
  note        text,                                  -- coaching cue shown under the name
  position    int         not null default 0,
  retired     boolean     not null default false,
  created_at  timestamptz not null default now()
);
create index tracker_exercises_profile_idx on public.tracker_exercises (profile_id);

-- ----------------------------------------------------------------
-- Weights sessions
-- ----------------------------------------------------------------
-- sets = { "<exercise_id>": [ {"r": "8", "w": "60"}, ... ] }
-- Never overwritten by date: every save is a new row (at = HH:MM),
-- multiple entries per day are normal.
create table public.tracker_workouts (
  id          uuid        primary key default gen_random_uuid(),
  profile_id  uuid        not null references public.profiles on delete cascade,
  date        date        not null,
  at          text,
  sets        jsonb       not null default '{}'::jsonb,
  notes       text,
  created_at  timestamptz not null default now()
);
create index tracker_workouts_profile_date_idx on public.tracker_workouts (profile_id, date desc);

-- ----------------------------------------------------------------
-- Erg sessions - pure logging of what was actually done
-- ----------------------------------------------------------------
-- source: photo = parsed from a monitor photo by the parse-erg Edge
-- Function; manual = typed in; c2-logbook = future Concept2 API sync.
-- intervals = [ {"time_s": 112.4, "distance_m": 500, "split_s": 112.4,
--               "rate": 28, "hr": 165}, ... ]  (any field may be null)
create table public.tracker_erg_sessions (
  id           uuid        primary key default gen_random_uuid(),
  profile_id   uuid        not null references public.profiles on delete cascade,
  date         date        not null,
  at           text,
  source       text        not null default 'manual' check (source in ('photo', 'manual', 'c2-logbook')),
  erg_type     text        check (erg_type in ('concept2', 'rowperfect') or erg_type is null),
  session_type text,                               -- "2k test", "8x500m", "60' UT2"...
  total_time_s numeric,
  distance_m   int,
  avg_split_s  numeric,                            -- seconds per 500m
  avg_rate     int,
  avg_hr       int,
  intervals    jsonb,
  notes        text,
  created_at   timestamptz not null default now()
);
create index tracker_erg_profile_date_idx on public.tracker_erg_sessions (profile_id, date desc);

-- ----------------------------------------------------------------
-- Core routines - a timed circuit of named holds
-- ----------------------------------------------------------------
-- steps is an ORDERED list: [{"name": "Plank", "target_s": 60}, ...]. Order is
-- the round order and repeats are expected - the same hold commonly appears as
-- round 1 and round 4 - so this is a list, never a set keyed by name.
create table public.tracker_core_routines (
  id         uuid        primary key default gen_random_uuid(),
  profile_id uuid        not null references public.profiles on delete cascade,
  name       text        not null,
  steps      jsonb       not null default '[]'::jsonb,
  position   int         not null default 0,
  retired    boolean     not null default false,
  created_at timestamptz not null default now()
);
create index tracker_core_routines_profile_idx on public.tracker_core_routines (profile_id);

-- One run through a routine. steps carries the target alongside the actual
-- time, and routine_name is a snapshot, so a session stays readable after the
-- routine it came from is renamed or deleted.
-- steps: [{"name": "Plank", "target_s": 60, "actual_s": 72}, ...]
create table public.tracker_core_sessions (
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
create index tracker_core_sessions_profile_date_idx
  on public.tracker_core_sessions (profile_id, date desc);

-- ----------------------------------------------------------------
-- Plan / entitlement
-- ----------------------------------------------------------------
-- Everything in the tracker is free and unlimited EXCEPT reading erg photos,
-- which spends real money on the owner's Anthropic key. These two columns are
-- the whole entitlement model until Stripe exists; the Edge Function is the
-- only thing that enforces them, so a user editing their own profile row
-- cannot grant themselves access (see the RLS note below).
alter table public.profiles
  add column if not exists tracker_plan text not null default 'free'
    check (tracker_plan in ('free', 'trial', 'paid')),
  add column if not exists tracker_trial_ends_at timestamptz;

-- CRITICAL: the dashboard's "update own profile" RLS policy lets a user write
-- their own profile row, which would let anyone set tracker_plan = 'paid' with
-- one REST call. RLS cannot express "all columns except these two", so drop the
-- blanket table-level UPDATE and grant it back column by column. Only the
-- service role (used by the Edge Function and, later, the Stripe webhook) can
-- write the plan columns. Add any future user-writable profile column here.
revoke update on public.profiles from authenticated;
grant  update (display_name, email, terms_accepted_at) on public.profiles to authenticated;

-- ----------------------------------------------------------------
-- Erg photo parse log - quota enforcement + cost visibility
-- ----------------------------------------------------------------
-- One row per call to the parse-erg Edge Function. Written by the function
-- using the service role, so a user cannot tamper with their own quota.
-- Rows are kept even when the parse fails, because a failed call still costs
-- money. Purge anything older than the longest quota window if it ever grows.
create table public.tracker_erg_parses (
  id            uuid        primary key default gen_random_uuid(),
  profile_id    uuid        not null references public.profiles on delete cascade,
  created_at    timestamptz not null default now(),
  model         text,
  input_tokens  int,
  output_tokens int,
  ok            boolean     not null default true
);
create index tracker_erg_parses_profile_time_idx
  on public.tracker_erg_parses (profile_id, created_at desc);

-- ----------------------------------------------------------------
-- RLS - owner-only on everything
-- ----------------------------------------------------------------
alter table public.tracker_exercises    enable row level security;
alter table public.tracker_workouts     enable row level security;
alter table public.tracker_erg_sessions enable row level security;
alter table public.tracker_erg_parses    enable row level security;
alter table public.tracker_core_routines enable row level security;
alter table public.tracker_core_sessions enable row level security;

create policy "own core routines" on public.tracker_core_routines
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "own core sessions" on public.tracker_core_sessions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Read-only to the owner (so the UI can show "12 of 20 photos left today").
-- No insert/update/delete policy at all: only the service role writes here,
-- which is what stops a user from clearing their own quota.
create policy "read own parse log" on public.tracker_erg_parses
  for select using (profile_id = auth.uid());

create policy "own exercises" on public.tracker_exercises
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "own workouts" on public.tracker_workouts
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "own erg sessions" on public.tracker_erg_sessions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
