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
-- session_group = the user's own session label ("Session 1", "Gym A"...).
-- pattern  = movement type used to section the log page. Free text so
--            users aren't boxed in; the UI suggests the common ones.
-- retired  = soft delete. Old workouts reference exercises by id, so a
--            deleted-but-used exercise is retired instead, keeping
--            history and summaries classifying correctly.
create table public.tracker_exercises (
  id          uuid        primary key default gen_random_uuid(),
  profile_id  uuid        not null references public.profiles on delete cascade,
  name        text        not null,
  session_group    text        not null default 'Session 1',
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
-- RLS - owner-only on everything
-- ----------------------------------------------------------------
alter table public.tracker_exercises    enable row level security;
alter table public.tracker_workouts     enable row level security;
alter table public.tracker_erg_sessions enable row level security;

create policy "own exercises" on public.tracker_exercises
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "own workouts" on public.tracker_workouts
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "own erg sessions" on public.tracker_erg_sessions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
