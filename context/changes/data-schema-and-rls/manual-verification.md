# Manual RLS Verification — F-01 (data-schema-and-rls)

> Two-account cross-user isolation smoke test against the linked Supabase remote project (`yfigasipwpqrzakwxcxl`). Confirms the PRD privacy guardrail (`context/foundation/prd.md:111` — "A user's training data … is never visible to or accessible by any other user account") at the database layer. Re-run this whenever the schema or RLS policies change.
>
> **How to impersonate a user in Studio SQL Editor:** open the SQL Editor, click the role selector (top right of the query pane), choose **authenticated** with **Impersonate user**, paste the user's UUID, then run the query. The editor sets `request.jwt.claims` so `auth.uid()` resolves to that user inside RLS policies. Alternatively, sign in the user via the app, copy the access token from devtools, and run queries via `curl` against `/rest/v1/...`.

## 1. Setup

- [ ] 1.1 Sign up **User A** via `/auth/signup` against the linked project; confirm the email if required.
- [ ] 1.2 Sign up **User B** via the same flow.
- [ ] 1.3 In Studio → Authentication → Users, capture each user's UUID. Record below:
  - User A id: `e2a5e861-f841-4cc2-b337-40f2ad21d858`
  - User B id: `156f3be8-b14e-487d-8eb1-171e52e7084d`

## 2. Direct ownership checks (`profiles`, `plans`)

Run **impersonated as User A** in the Studio SQL Editor:

```sql
insert into public.profiles (
  user_id, equipment_type, goal, age, weight_kg, ftp_watts, ftp_source,
  available_days, max_workday_minutes, max_weekend_minutes
) values (
  '<USER_A_ID>', 'power_meter', 'endurance', 35, 75.0, 220, 'measured',
  array['mon','wed','sat'], 60, 120
);

insert into public.plans (
  user_id, start_date, end_date, goal_at_generation,
  ftp_at_generation, equipment_at_generation
) values (
  '<USER_A_ID>', current_date, current_date + 27, 'endurance',
  220, 'power_meter'
);
```

- [x] 2.1 Both inserts succeed for User A.

Now switch impersonation to **User B** and run:

```sql
select * from public.profiles;   -- expect 0 rows
select * from public.plans;      -- expect 0 rows

update public.profiles set goal = 'endurance' where user_id = '<USER_A_ID>';  -- expect 0 rows affected
delete from public.plans where user_id = '<USER_A_ID>';                       -- expect 0 rows affected
```

- [x] 2.2 SELECT on `profiles` returns 0 rows as User B.
- [x] 2.3 SELECT on `plans` returns 0 rows as User B.
- [x] 2.4 UPDATE on `profiles` reports 0 rows affected as User B.
- [x] 2.5 DELETE on `plans` reports 0 rows affected as User B.

## 3. Chained ownership checks (`plan_sessions`, `session_logs`)

Run **as User A**. First capture A's plan id:

```sql
select id from public.plans where user_id = '<USER_A_ID>';
-- copy the result into <PLAN_A_ID> below
```

Then create a session and a log against it (still as User A):

```sql
insert into public.plan_sessions (
  plan_id, scheduled_date, day_index, session_type,
  planned_duration_min, title, structure
) values (
  '<PLAN_A_ID>', current_date, 1, 'endurance',
  60, 'Z2 endurance', '{"segments":[{"min":60,"zone":2}]}'::jsonb
) returning id;
-- copy the returned id into <SESSION_A_ID> below

insert into public.session_logs (
  plan_session_id, actual_duration_min, rating, km_ridden
) values (
  '<SESSION_A_ID>', 58, 4, 28.5
);
```

- [x] 3.1 Session + log inserts succeed for User A.

Switch impersonation to **User B** and run:

```sql
select * from public.plan_sessions;  -- expect 0 rows
select * from public.session_logs;   -- expect 0 rows

update public.plan_sessions set status = 'skipped' where id = '<SESSION_A_ID>';  -- expect 0 rows affected
delete from public.session_logs where plan_session_id = '<SESSION_A_ID>';         -- expect 0 rows affected
```

- [x] 3.2 SELECT on `plan_sessions` returns 0 rows as User B.
- [x] 3.3 SELECT on `session_logs` returns 0 rows as User B.
- [x] 3.4 UPDATE on `plan_sessions` reports 0 rows affected as User B.
- [x] 3.5 DELETE on `session_logs` reports 0 rows affected as User B.

## 4. Constraint sanity checks

Run **as User A**.

```sql
-- (a) Partial unique on active plans — second active plan must fail
insert into public.plans (
  user_id, start_date, end_date, goal_at_generation,
  ftp_at_generation, equipment_at_generation
) values (
  '<USER_A_ID>', current_date + 28, current_date + 55, 'endurance',
  220, 'power_meter'
);
-- expect: unique_violation on one_active_plan_per_user
```

- [x] 4.1 Second `status='active'` plan rejected with `one_active_plan_per_user` unique violation.

```sql
-- (b) power_meter requires ftp_watts + ftp_source
insert into public.profiles (
  user_id, equipment_type, goal, age, weight_kg,
  available_days, max_workday_minutes, max_weekend_minutes
) values (
  gen_random_uuid(), 'power_meter', 'endurance', 30, 70,
  array['mon'], 60, 120
);
-- expect: check_violation on power_meter_requires_ftp
```

- [x] 4.2 power-meter profile without `ftp_watts` rejected with `power_meter_requires_ftp` CHECK violation.

```sql
-- (c) fitness_level must be null iff ftp_source='measured'
insert into public.profiles (
  user_id, equipment_type, goal, age, weight_kg, ftp_watts, ftp_source,
  fitness_level, available_days, max_workday_minutes, max_weekend_minutes
) values (
  gen_random_uuid(), 'power_meter', 'endurance', 30, 70, 220, 'measured',
  'advanced', array['mon'], 60, 120
);
-- expect: check_violation on fitness_level_matches_ftp_source
```

- [x] 4.3 `ftp_source='measured'` paired with non-null `fitness_level` rejected with `fitness_level_matches_ftp_source` CHECK violation.

## 5. Anon role check

In Studio SQL Editor, switch the role selector to **anon** (no impersonation), then run:

```sql
select * from public.profiles;       -- expect 0 rows
select * from public.plans;          -- expect 0 rows
select * from public.plan_sessions;  -- expect 0 rows
select * from public.session_logs;   -- expect 0 rows
```

- [x] 5.1 All four SELECTs return 0 rows as `anon` (RLS default-deny on tables with no `anon` policies).

## 6. Cleanup

- [x] 6.1 Studio → Authentication → Users: delete User A and User B (cascades remove all rows they created).
- [x] 6.2 Confirm `public.profiles`, `public.plans`, `public.plan_sessions`, `public.session_logs` are empty:
  ```sql
  select
    (select count(*) from public.profiles)      as profiles,
    (select count(*) from public.plans)         as plans,
    (select count(*) from public.plan_sessions) as plan_sessions,
    (select count(*) from public.session_logs)  as session_logs;
  ```
  Expect all zeros.

## Sign-off

Checked off by **DM** on **2026-06-02** — outcomes match expectations.
