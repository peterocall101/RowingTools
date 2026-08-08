-- ================================================================
-- RowingTools tracker - squads (groups, board, shared templates)
--
-- Run in: Supabase dashboard > SQL Editor, project ref tbhujqdflswhgxtioznb.
-- Additive and idempotent. Safe to run more than once.
--
-- THE ONE THING TO UNDERSTAND BEFORE READING ON
-- The existing tracker tables stay OWNER-ONLY. Not one of their RLS
-- policies is modified by this file. A squad-mate never gains SELECT on
-- your tracker_workouts rows.
--
-- Sharing happens entirely through public.tracker_squad_board(), a
-- SECURITY DEFINER function that returns COUNTS AND TOTALS ONLY. It
-- cannot leak a note, an individual lift or a session date, because it
-- never selects them. Row-level security cannot hide a column; a
-- function that never reads the column can.
--
-- Consequence worth stating plainly: session notes, per-exercise loads
-- and anything else personal never leave the owner's account, by
-- construction rather than by policy.
-- ================================================================

begin;

-- ----------------------------------------------------------------
-- 0. The group model. These four objects belong to the COACH DASHBOARD
--    schema (dashboard/supabase/schema.sql) and are almost certainly
--    already live - handle_new_user() references group_members, and
--    tracker signup works, so they must exist.
--
--    They are repeated here VERBATIM so this file stands alone on a
--    fresh project. If they already exist every statement is a no-op.
--    Do not "improve" these definitions: they must stay byte-compatible
--    with the dashboard schema or whichever file runs second will skip
--    a table that is missing columns the other app needs.
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
-- 2. Sharing consent - one row per (athlete, squad).
--
--    Membership alone shares NOTHING. A training log is personal, so
--    appearing on a squad board is a separate, explicit, revocable act.
--    No row means not sharing.
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

-- Squad-mates may see WHO is sharing (so the board can show who has
-- opted out). That is a name, not training data.
drop policy if exists "squad reads sharing roster" on public.tracker_sharing;
create policy "squad reads sharing roster" on public.tracker_sharing
  for select using (public.is_group_member(group_id));

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
  v_try  int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Give the squad a name';
  end if;

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

  insert into public.groups (name, created_by, join_code)
  values (trim(p_name), auth.uid(), v_code)
  returning id into v_id;

  insert into public.group_members (group_id, profile_id, role, accepted_at)
  values (v_id, auth.uid(), 'admin', now());

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

  insert into public.group_members (group_id, profile_id, role, accepted_at)
  values (v_id, auth.uid(), 'member', now())
  on conflict (group_id, profile_id) do nothing;

  return query select v_id, v_name;
end;
$$;

-- ---- leave a squad -----------------------------------------------
-- Sharing consent goes with it, via the FK cascade on tracker_sharing.
create or replace function public.tracker_leave_group(p_group uuid)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  delete from public.tracker_sharing
   where profile_id = auth.uid() and group_id = p_group;
  delete from public.group_members
   where profile_id = auth.uid() and group_id = p_group;
end;
$$;

-- ---- the board ---------------------------------------------------
-- Returns one row per squad member, counts and totals only. Everything
-- personal is absent by construction: this function never reads notes,
-- per-exercise loads, or session dates.
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
-- dates reconstructs the whole calendar. Four fixed windows, computed
-- server-side, leave nothing to difference.
drop function if exists public.tracker_squad_board(uuid, date);

create or replace function public.tracker_squad_board(p_group uuid, p_period text)
returns table (
  profile_id       uuid,
  display_name     text,
  sharing          boolean,
  days_trained     int,
  sessions_total   int,
  sessions_weights int,
  sessions_erg     int,
  sessions_core    int,
  erg_metres       numeric,
  erg_seconds      numeric,
  core_work_s      numeric,
  core_rounds      int,
  weights_sets     int,
  weights_volume   numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p_since date;
begin
  -- Not a member: no rows. Not an error, which would confirm the squad
  -- exists to someone guessing ids.
  if not public.is_group_member(p_group) then
    return;
  end if;

  p_since := case p_period
    when 'week' then date_trunc('week', now())::date
    when '4w'   then date_trunc('week', now())::date - 21
    when '12w'  then date_trunc('week', now())::date - 77
    when 'all'  then date '2000-01-01'
    else date_trunc('week', now())::date - 21      -- anything unrecognised
  end;

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
    where tw.date >= p_since
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
    where tw.date >= p_since
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
    where te2.date >= p_since
    group by te2.profile_id
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
    where tc.date >= p_since
    group by tc.profile_id
  )
  select
    r.pid,
    coalesce(p.display_name, 'Athlete'),
    r.opted_in,
    case when r.opted_in then (
      select count(distinct d)::int from unnest(
        coalesce(w.dates, '{}'::date[]) ||
        coalesce(e.dates, '{}'::date[]) ||
        coalesce(c.dates, '{}'::date[])
      ) as d
    ) end,
    case when r.opted_in then coalesce(w.sessions, 0) + coalesce(e.sessions, 0) + coalesce(c.sessions, 0) end,
    case when r.opted_in then coalesce(w.sessions, 0) end,
    case when r.opted_in then coalesce(e.sessions, 0) end,
    case when r.opted_in then coalesce(c.sessions, 0) end,
    case when r.opted_in then coalesce(e.metres, 0) end,
    case when r.opted_in then coalesce(e.secs, 0) end,
    case when r.opted_in then coalesce(c.work_s, 0) end,
    case when r.opted_in then coalesce(c.rounds, 0) end,
    case when r.opted_in then coalesce(wsets.n_sets, 0) end,
    case when r.opted_in then coalesce(wsets.volume, 0) end
  from roster r
  left join public.profiles p on p.id = r.pid
  left join w     on w.pid     = r.pid
  left join wsets on wsets.pid = r.pid
  left join e     on e.pid     = r.pid
  left join c     on c.pid     = r.pid;
end;
$$;

-- The functions are the only sanctioned path to another athlete's
-- numbers, so make sure they are callable and the base tables are not
-- reachable any other way (their own owner-only policies already see to
-- that; this is belt and braces on EXECUTE).
grant execute on function public.tracker_create_group(text)        to authenticated;
grant execute on function public.tracker_join_group(text)          to authenticated;
grant execute on function public.tracker_leave_group(uuid)         to authenticated;
grant execute on function public.tracker_squad_board(uuid, text)   to authenticated;
grant execute on function public.tracker_is_uuid(text)              to authenticated;
grant execute on function public.tracker_num(text)                 to authenticated;

-- ================================================================
-- REPORT - one query; the SQL editor only shows the last result.
-- ================================================================
select section, item, result from (
  select 1 as ord, '1 objects' as section, o.item,
         case when o.present then 'ok' else '** MISSING **' end as result
  from (
    select 'table groups'                    as item, to_regclass('public.groups')                    is not null as present
    union all select 'table group_members',        to_regclass('public.group_members')                is not null
    union all select 'table tracker_sharing',      to_regclass('public.tracker_sharing')              is not null
    union all select 'table tracker_shared_templates', to_regclass('public.tracker_shared_templates') is not null
    union all select 'column groups.join_code',   exists (select 1 from information_schema.columns
                                                    where table_schema='public' and table_name='groups'
                                                      and column_name='join_code')
    union all select 'fn is_group_member',        to_regprocedure('public.is_group_member(uuid)')     is not null
    union all select 'fn tracker_create_group',   to_regprocedure('public.tracker_create_group(text)') is not null
    union all select 'fn tracker_join_group',     to_regprocedure('public.tracker_join_group(text)')  is not null
    union all select 'fn tracker_leave_group',    to_regprocedure('public.tracker_leave_group(uuid)') is not null
    union all select 'fn tracker_squad_board',    to_regprocedure('public.tracker_squad_board(uuid,text)') is not null
  ) o

  -- The whole privacy claim rests on these staying owner-only. If a
  -- policy count here ever exceeds 1, someone has widened SELECT and
  -- squad-mates may be able to read raw sessions.
  union all
  select 2, '2 tracker tables still owner-only', t.tbl,
    (select count(*) from pg_policies p
      where p.schemaname='public' and p.tablename=t.tbl)::text || ' policy(ies)' ||
    case when (select count(*) from pg_policies p
                where p.schemaname='public' and p.tablename=t.tbl) = 1
         then ' · ok' else ' · ** CHECK THIS **' end
  from (values ('tracker_workouts'), ('tracker_erg_sessions'),
               ('tracker_core_sessions'), ('tracker_exercises')) as t(tbl)

  -- The "nobody can add themselves to a squad" guarantee depends on
  -- group_members having NO insert/update/delete policy. Those tables come
  -- from the dashboard schema, which is not in this repo, so the claim is
  -- unproven until this row is read on the live database.
  union all
  select 3, '3 group tables (want: select only)', t.tbl,
    coalesce((select string_agg(distinct p.cmd, ', ' order by p.cmd) from pg_policies p
               where p.schemaname='public' and p.tablename=t.tbl), '(no policies)')
  from (values ('groups'), ('group_members')) as t(tbl)

  union all
  select 4, '4 your squads', coalesce(g.name, '(none yet)'),
         coalesce('code ' || g.join_code, '-')
  from public.group_members gm
  join public.groups g on g.id = gm.group_id
  where gm.profile_id = auth.uid()
) report
order by ord, item;
