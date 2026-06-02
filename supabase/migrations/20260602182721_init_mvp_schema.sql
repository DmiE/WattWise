-- WattWise MVP schema: profiles, plans, plan_sessions, session_logs.
-- Atomic creation of enums, tables, indexes, RLS policies, and updated_at trigger.
-- Per-user isolation enforced via RLS on `authenticated`; `anon` has no policies (default-deny).

-- =========================================================================
-- Enums
-- =========================================================================

create type public.equipment_type as enum ('power_meter', 'hrm', 'none');
create type public.training_goal as enum ('fitness_health', 'endurance', 'speed_racing');
create type public.fitness_level as enum ('beginner', 'intermediate', 'advanced');
create type public.ftp_source as enum ('measured', 'estimated');
create type public.plan_status as enum ('active', 'expired', 'superseded');
create type public.session_status as enum ('pending', 'done', 'skipped');
create type public.session_type as enum ('endurance', 'intervals', 'recovery');

-- =========================================================================
-- updated_at trigger function
-- =========================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- profiles
-- =========================================================================

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  equipment_type public.equipment_type not null,
  goal public.training_goal not null,
  age smallint not null,
  weight_kg numeric(5,2) not null,
  ftp_watts smallint,
  ftp_source public.ftp_source,
  fitness_level public.fitness_level,
  max_hr smallint,
  available_days text[] not null,
  max_workday_minutes smallint not null,
  max_weekend_minutes smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_age_range check (age between 14 and 100),
  constraint profiles_weight_range check (weight_kg between 30 and 200),
  constraint profiles_ftp_range check (ftp_watts is null or ftp_watts between 50 and 600),
  constraint profiles_max_hr_range check (max_hr is null or max_hr between 100 and 230),
  constraint profiles_workday_minutes_range check (max_workday_minutes between 15 and 360),
  constraint profiles_weekend_minutes_range check (max_weekend_minutes between 15 and 600),
  constraint profiles_available_days_valid check (
    available_days <@ array['mon','tue','wed','thu','fri','sat','sun']::text[]
    and array_length(available_days, 1) between 1 and 7
  ),
  constraint power_meter_requires_ftp check (
    equipment_type <> 'power_meter' or (ftp_watts is not null and ftp_source is not null)
  ),
  constraint hrm_requires_max_hr check (
    equipment_type <> 'hrm' or max_hr is not null
  ),
  constraint fitness_level_matches_ftp_source check (
    (ftp_source is not distinct from 'measured' and fitness_level is null)
    or (ftp_source is distinct from 'measured' and fitness_level is not null)
  )
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy profiles_delete_own on public.profiles
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- =========================================================================
-- plans
-- =========================================================================

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  status public.plan_status not null default 'active',
  goal_at_generation public.training_goal not null,
  ftp_at_generation smallint,
  max_hr_at_generation smallint,
  fitness_level_at_generation public.fitness_level,
  equipment_at_generation public.equipment_type not null,
  generation_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_28_day_window check (end_date - start_date = 27)
);

create index plans_user_id_idx on public.plans (user_id);
create unique index one_active_plan_per_user on public.plans (user_id) where status = 'active';

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

alter table public.plans enable row level security;

create policy plans_select_own on public.plans
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy plans_insert_own on public.plans
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy plans_update_own on public.plans
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy plans_delete_own on public.plans
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- =========================================================================
-- plan_sessions
-- =========================================================================

create table public.plan_sessions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  scheduled_date date not null,
  day_index smallint not null,
  session_type public.session_type not null,
  planned_duration_min smallint not null,
  title text not null,
  description text,
  structure jsonb not null,
  status public.session_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_sessions_day_index_range check (day_index between 1 and 28),
  constraint plan_sessions_planned_duration_range check (planned_duration_min between 15 and 360),
  constraint plan_sessions_structure_shape check (
    jsonb_typeof(structure) = 'object' and structure ? 'segments'
  ),
  constraint plan_sessions_plan_day_unique unique (plan_id, day_index)
);

create index plan_sessions_plan_id_idx on public.plan_sessions (plan_id);
create index plan_sessions_plan_scheduled_idx on public.plan_sessions (plan_id, scheduled_date);

create trigger plan_sessions_set_updated_at
  before update on public.plan_sessions
  for each row execute function public.set_updated_at();

alter table public.plan_sessions enable row level security;

create policy plan_sessions_select_own on public.plan_sessions
  for select to authenticated
  using (
    exists (
      select 1 from public.plans
      where plans.id = plan_sessions.plan_id
        and plans.user_id = (select auth.uid())
    )
  );

create policy plan_sessions_insert_own on public.plan_sessions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.plans
      where plans.id = plan_sessions.plan_id
        and plans.user_id = (select auth.uid())
    )
  );

create policy plan_sessions_update_own on public.plan_sessions
  for update to authenticated
  using (
    exists (
      select 1 from public.plans
      where plans.id = plan_sessions.plan_id
        and plans.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.plans
      where plans.id = plan_sessions.plan_id
        and plans.user_id = (select auth.uid())
    )
  );

create policy plan_sessions_delete_own on public.plan_sessions
  for delete to authenticated
  using (
    exists (
      select 1 from public.plans
      where plans.id = plan_sessions.plan_id
        and plans.user_id = (select auth.uid())
    )
  );

-- =========================================================================
-- session_logs
-- =========================================================================

create table public.session_logs (
  plan_session_id uuid primary key references public.plan_sessions(id) on delete cascade,
  actual_duration_min smallint not null,
  rating smallint not null,
  km_ridden numeric(5,2) not null,
  logged_at timestamptz not null default now(),
  constraint session_logs_actual_duration_range check (actual_duration_min between 1 and 600),
  constraint session_logs_rating_range check (rating between 1 and 5),
  constraint session_logs_km_range check (km_ridden > 0 and km_ridden < 500)
);

alter table public.session_logs enable row level security;

create policy session_logs_select_own on public.session_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.plan_sessions
      join public.plans on plans.id = plan_sessions.plan_id
      where plan_sessions.id = session_logs.plan_session_id
        and plans.user_id = (select auth.uid())
    )
  );

create policy session_logs_insert_own on public.session_logs
  for insert to authenticated
  with check (
    exists (
      select 1 from public.plan_sessions
      join public.plans on plans.id = plan_sessions.plan_id
      where plan_sessions.id = session_logs.plan_session_id
        and plans.user_id = (select auth.uid())
    )
  );

create policy session_logs_update_own on public.session_logs
  for update to authenticated
  using (
    exists (
      select 1 from public.plan_sessions
      join public.plans on plans.id = plan_sessions.plan_id
      where plan_sessions.id = session_logs.plan_session_id
        and plans.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.plan_sessions
      join public.plans on plans.id = plan_sessions.plan_id
      where plan_sessions.id = session_logs.plan_session_id
        and plans.user_id = (select auth.uid())
    )
  );

create policy session_logs_delete_own on public.session_logs
  for delete to authenticated
  using (
    exists (
      select 1 from public.plan_sessions
      join public.plans on plans.id = plan_sessions.plan_id
      where plan_sessions.id = session_logs.plan_session_id
        and plans.user_id = (select auth.uid())
    )
  );
