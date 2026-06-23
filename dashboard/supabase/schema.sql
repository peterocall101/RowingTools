-- ================================================================
-- RowingTools dashboard - database schema
-- Run in: Supabase dashboard > SQL Editor > New query (NEW project,
-- separate from the Condit gallery project).
--
-- Adapted from the Condit multi-tenant template, with one structural
-- change: a user can belong to MANY groups (squads), so membership and
-- role live in a join table (group_members) rather than on the profile.
--
-- Scope: MVP only. No billing/subscriptions yet (per-user £5/mo Stripe
-- comes later). Erg world-record benchmarks live as static JSON in the
-- frontend, not in this database.
-- ================================================================

-- ----------------------------------------------------------------
-- Core / platform tables
-- ----------------------------------------------------------------

-- Groups = squads, e.g. "Vesta Senior Men's Squad".
-- club_id/club_name optionally link a group to a public RowingTools club
-- identity (the name used in data/all_results.json). Kept as plain text +
-- optional id so a group can attach to a club without a hard FK into the
-- static dataset.
create table public.groups (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  club_id     text,                       -- optional: public club slug/key
  club_name   text,                       -- optional: display name of attached club
  created_by  uuid        not null references auth.users on delete restrict,
  created_at  timestamptz not null default now()
);

-- One row per auth user. NO group_id / role here - those are per-membership.
create table public.profiles (
  id                uuid        primary key references auth.users on delete cascade,
  display_name      text,
  email             text,                 -- mirror of auth.users.email (auth schema is not client-readable)
  terms_accepted_at timestamptz,          -- set when the user accepts Terms/Privacy at signup
  created_at        timestamptz not null default now()
);

-- Membership join table: a user belongs to many groups, each with its own role.
create table public.group_members (
  group_id    uuid        not null references public.groups on delete cascade,
  profile_id  uuid        not null references public.profiles on delete cascade,
  role        text        not null default 'member' check (role in ('admin', 'member')),
  accepted_at timestamptz,                -- null until first sign-in for an invited member
  joined_at   timestamptz not null default now(),
  primary key (group_id, profile_id)
);
create index group_members_profile_idx on public.group_members (profile_id);

-- Pre-registered invites. PK (email, group_id) so the same person can be
-- invited to several groups at once. handle_new_user() consumes these on signup.
create table public.pending_members (
  email      text        not null,
  group_id   uuid        not null references public.groups on delete cascade,
  role       text        not null default 'member' check (role in ('admin', 'member')),
  invited_by uuid        references public.profiles(id),
  invited_at timestamptz not null default now(),
  primary key (email, group_id)
);

-- ----------------------------------------------------------------
-- Domain tables (the rowing data)
-- ----------------------------------------------------------------

-- Roster entries. An athlete is a name on a squad sheet; they may never log
-- in. Optionally linked to a profile later via profile_id.
create table public.athletes (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references public.groups on delete cascade,
  profile_id  uuid        references public.profiles on delete set null,  -- optional link to a login
  name        text        not null,
  sex         text        check (sex in ('M', 'F') or sex is null),
  dob         date,
  notes       text,
  created_by  uuid        not null references public.profiles on delete cascade,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz                          -- soft delete
);
create index athletes_group_idx on public.athletes (group_id);

-- Named crews, e.g. "Senior 8+ A".
create table public.crews (
  id          uuid        primary key default gen_random_uuid(),
  group_id    uuid        not null references public.groups on delete cascade,
  name        text        not null,
  boat_class  text,                                -- '8+', '4-', '2x', '1x', etc.
  created_by  uuid        not null references public.profiles on delete cascade,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index crews_group_idx on public.crews (group_id);

-- Who sat in a crew (the line-up).
create table public.crew_members (
  crew_id    uuid not null references public.crews on delete cascade,
  athlete_id uuid not null references public.athletes on delete cascade,
  seat       integer,                              -- optional seat number; bow = 1
  primary key (crew_id, athlete_id)
);

-- A recorded piece. Either a manual training/test piece (source='manual') or a
-- public regatta result imported from the main site (source='public'). Manual
-- pieces have a distance and yield a /500m split; public race results carry a
-- GMT % and boat class instead. Optionally tagged to a crew, optionally
-- geo-tagged with start/finish pins whose weather is cached into weather (jsonb).
create table public.results (
  id           uuid        primary key default gen_random_uuid(),
  group_id     uuid        not null references public.groups on delete cascade,
  crew_id      uuid        references public.crews on delete set null,
  source       text        not null default 'manual' check (source in ('manual', 'public')),
  piece_type   text        not null default 'water' check (piece_type in ('erg', 'water')),
  distance_m   integer,                             -- null for imported public race results
  time_ms      integer     not null,               -- elapsed time in milliseconds
  rate         integer,                             -- stroke rate (spm), optional
  performed_at date        not null,
  -- Public-result fields (from data/all_results.json on the main site):
  pct          numeric,                             -- GMT %
  event        text,                                -- e.g. "Ch 4+"
  regatta      text,                                -- e.g. "Marlow Regatta 2026"
  boat_class   text,                                -- e.g. "M4+"
  crew_label   text,                                -- public crew name as shown on the site
  public_ref   text,                                -- stable id of the source row (dedupe imports)
  -- Geo + weather (reuses the conditions.js / courses.py weather logic on the
  -- client; the fetched result is cached here so it never needs refetching).
  start_lat    double precision,
  start_lng    double precision,
  finish_lat   double precision,
  finish_lng   double precision,
  weather      jsonb,                               -- { wind_ms, wind_dir, temp_c, ... }
  notes        text,
  created_by   uuid        not null references public.profiles on delete cascade,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index results_group_idx on public.results (group_id, performed_at);
create index results_crew_idx  on public.results (crew_id);
-- A given public result can be imported into a squad at most once. Plain
-- (non-partial) unique index so upsert ON CONFLICT (group_id, public_ref)
-- can use it. Manual rows have public_ref = null, and NULLs are distinct, so
-- they never collide here.
create unique index results_public_ref_uniq
  on public.results (group_id, public_ref);

-- Individuals tagged on a result (enables the per-athlete progress view).
create table public.result_athletes (
  result_id  uuid not null references public.results on delete cascade,
  athlete_id uuid not null references public.athletes on delete cascade,
  primary key (result_id, athlete_id)
);

-- ================================================================
-- Row-level security
-- ================================================================

alter table public.groups          enable row level security;
alter table public.profiles        enable row level security;
alter table public.group_members   enable row level security;
alter table public.pending_members enable row level security;
alter table public.athletes        enable row level security;
alter table public.crews           enable row level security;
alter table public.crew_members    enable row level security;
alter table public.results         enable row level security;
alter table public.result_athletes enable row level security;

-- Helper functions. SECURITY DEFINER so they bypass RLS when reading
-- group_members - this is what prevents infinite recursion in the
-- group_members / domain-table policies that need a membership check.
create or replace function public.is_group_member(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where group_id = g and profile_id = auth.uid()
  );
$$;

create or replace function public.is_group_admin(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where group_id = g and profile_id = auth.uid() and role = 'admin'
  );
$$;

-- Resolve the owning group of a crew / result (used by the join-table
-- policies). SECURITY DEFINER so the lookup itself isn't re-filtered by RLS.
create or replace function public.group_of_crew(c uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from public.crews where id = c;
$$;

create or replace function public.group_of_result(r uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from public.results where id = r;
$$;

-- ---- groups ----
-- No direct insert: groups are created via create_group() so the creator
-- atomically becomes an admin member (avoids a chicken-and-egg with the
-- group_members admin check).
create policy "members read their groups" on public.groups
  for select using (public.is_group_member(id));

create policy "admins update their group" on public.groups
  for update using (public.is_group_admin(id));

-- ---- profiles ----
create policy "read own profile" on public.profiles
  for select using (id = auth.uid());

-- Read co-members' profiles (so a roster/members list can show names).
create policy "read co-member profiles" on public.profiles
  for select using (
    exists (
      select 1
      from public.group_members me
      join public.group_members them on them.group_id = me.group_id
      where me.profile_id = auth.uid() and them.profile_id = profiles.id
    )
  );

create policy "insert own profile" on public.profiles
  for insert with check (id = auth.uid());

create policy "update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ---- group_members ----
-- Members can see the membership of groups they belong to. Writes go through
-- security-definer RPCs (create_group / admin_* / the signup trigger), so
-- there are no direct insert/update/delete policies here.
create policy "read memberships of my groups" on public.group_members
  for select using (public.is_group_member(group_id));

-- ---- pending_members ----
create policy "admins manage pending members" on public.pending_members
  for all
  using  (public.is_group_admin(group_id))
  with check (public.is_group_admin(group_id));

-- ---- domain tables ----
-- Shared shape: members of the owning group read; members insert their own
-- rows; members update; only an admin OR the creator may delete.

-- athletes
create policy "athletes_select" on public.athletes
  for select using (public.is_group_member(group_id));
create policy "athletes_insert" on public.athletes
  for insert with check (public.is_group_member(group_id) and created_by = auth.uid());
create policy "athletes_update" on public.athletes
  for update using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
create policy "athletes_delete" on public.athletes
  for delete using (public.is_group_admin(group_id) or created_by = auth.uid());

-- crews
create policy "crews_select" on public.crews
  for select using (public.is_group_member(group_id));
create policy "crews_insert" on public.crews
  for insert with check (public.is_group_member(group_id) and created_by = auth.uid());
create policy "crews_update" on public.crews
  for update using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
create policy "crews_delete" on public.crews
  for delete using (public.is_group_admin(group_id) or created_by = auth.uid());

-- crew_members (scoped through the parent crew's group)
create policy "crew_members_select" on public.crew_members
  for select using (public.is_group_member(public.group_of_crew(crew_id)));
create policy "crew_members_write" on public.crew_members
  for all
  using  (public.is_group_member(public.group_of_crew(crew_id)))
  with check (public.is_group_member(public.group_of_crew(crew_id)));

-- results
create policy "results_select" on public.results
  for select using (public.is_group_member(group_id));
create policy "results_insert" on public.results
  for insert with check (public.is_group_member(group_id) and created_by = auth.uid());
create policy "results_update" on public.results
  for update using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
create policy "results_delete" on public.results
  for delete using (public.is_group_admin(group_id) or created_by = auth.uid());

-- result_athletes (scoped through the parent result's group)
create policy "result_athletes_select" on public.result_athletes
  for select using (public.is_group_member(public.group_of_result(result_id)));
create policy "result_athletes_write" on public.result_athletes
  for all
  using  (public.is_group_member(public.group_of_result(result_id)))
  with check (public.is_group_member(public.group_of_result(result_id)));

-- ================================================================
-- RPCs
-- ================================================================

-- Create a group and make the caller its first admin, atomically.
create or replace function public.create_group(p_name text, p_club_id text default null, p_club_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_group_id uuid;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Group name is required.';
  end if;

  insert into public.groups (name, club_id, club_name, created_by)
  values (trim(p_name), p_club_id, p_club_name, auth.uid())
  returning id into v_group_id;

  insert into public.group_members (group_id, profile_id, role, accepted_at)
  values (v_group_id, auth.uid(), 'admin', now());

  return v_group_id;
end; $$;
grant execute on function public.create_group(text, text, text) to authenticated;

-- Remove a member from a group (admins only; cannot remove yourself here).
create or replace function public.admin_remove_member(p_group_id uuid, p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'Only a group admin can remove members.';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Use "leave group" to remove yourself.';
  end if;
  delete from public.group_members where group_id = p_group_id and profile_id = p_profile_id;
end; $$;
grant execute on function public.admin_remove_member(uuid, uuid) to authenticated;

-- Change a member's role within a group (admins only).
create or replace function public.admin_set_member_role(p_group_id uuid, p_profile_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_role not in ('admin', 'member') then raise exception 'Invalid role.'; end if;
  if not public.is_group_admin(p_group_id) then
    raise exception 'Only a group admin can change roles.';
  end if;
  update public.group_members set role = p_role
  where group_id = p_group_id and profile_id = p_profile_id;
end; $$;
grant execute on function public.admin_set_member_role(uuid, uuid, text) to authenticated;

-- ================================================================
-- Auto-create profile + consume invites on signup
-- ================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.email
  );

  -- Honour every group this email was invited to.
  insert into public.group_members (group_id, profile_id, role, accepted_at)
  select pm.group_id, new.id, pm.role, now()
  from public.pending_members pm
  where pm.email = new.email;

  delete from public.pending_members where email = new.email;

  return new;
end; $$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ================================================================
-- Edge Function: invite-member (supabase/functions/invite-member/)
-- ================================================================
-- Port of Condit's invite-member, adapted to per-group invites: the caller
-- must be an admin OF THE TARGET GROUP, and pending_members is keyed by
-- (email, group_id). No seat cap in the MVP (billing comes later).

-- ================================================================
-- Scheduled jobs (pg_cron) - hard-delete soft-deleted rows after 48h
-- ================================================================
create extension if not exists pg_cron;

select cron.schedule('purge-deleted-results', '0 3 * * *',
  $$ delete from public.results  where deleted_at is not null and deleted_at < now() - interval '48 hours' $$);
select cron.schedule('purge-deleted-crews',   '5 3 * * *',
  $$ delete from public.crews    where deleted_at is not null and deleted_at < now() - interval '48 hours' $$);
select cron.schedule('purge-deleted-athletes','10 3 * * *',
  $$ delete from public.athletes where deleted_at is not null and deleted_at < now() - interval '48 hours' $$);

-- ================================================================
-- Setup after running this schema
-- ================================================================
-- 1. Sign up via the dashboard login page (creates your auth user + profile).
-- 2. Create your first squad from the UI (calls create_group(), which makes
--    you its admin). For a manual bootstrap instead:
--      select public.create_group('Vesta Senior Men''s Squad');
--    -- run while authenticated as your user, or insert rows by hand.
-- ================================================================
