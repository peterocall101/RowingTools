-- RUN THIS in the Supabase SQL editor (project tbhujqdflswhgxtioznb).
-- Additive snippet for the erg-parse quota. Already folded into
-- tracker_schema.sql, which is the single source of truth - this file is just
-- the delta for a database that has the earlier version applied.
-- Safe to delete once it has been run.

create table if not exists public.tracker_erg_parses (
  id            uuid        primary key default gen_random_uuid(),
  profile_id    uuid        not null references public.profiles on delete cascade,
  created_at    timestamptz not null default now(),
  model         text,
  input_tokens  int,
  output_tokens int,
  ok            boolean     not null default true
);

create index if not exists tracker_erg_parses_profile_time_idx
  on public.tracker_erg_parses (profile_id, created_at desc);

alter table public.tracker_erg_parses enable row level security;

-- Owner can read their own usage; nobody but the service role can write.
drop policy if exists "read own parse log" on public.tracker_erg_parses;
create policy "read own parse log" on public.tracker_erg_parses
  for select using (profile_id = auth.uid());

-- ---- entitlement: everything is free except reading erg photos ----
alter table public.profiles
  add column if not exists tracker_plan text not null default 'free'
    check (tracker_plan in ('free', 'trial', 'paid')),
  add column if not exists tracker_trial_ends_at timestamptz;

-- CRITICAL. Without this, the dashboard's "update own profile" RLS policy lets
-- any user set their own tracker_plan to 'paid' with a single REST call. RLS
-- can't say "every column except these", so remove the table-wide UPDATE grant
-- and hand back only the columns a user may legitimately edit.
revoke update on public.profiles from authenticated;
grant  update (display_name, email, terms_accepted_at) on public.profiles to authenticated;

-- Give yourself access (replace with your own email):
--   update public.profiles set tracker_plan = 'paid'
--   where email = 'ocallaghanpeter10@gmail.com';
