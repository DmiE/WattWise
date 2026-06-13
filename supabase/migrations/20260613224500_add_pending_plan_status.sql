-- Add a transient 'pending' state to plan_status so plan generation can persist
-- parent-first crash-safely: insert the plan as 'pending', insert its sessions,
-- then flip to 'active' as the last step. A crash (or a failed cleanup) at any
-- point leaves a non-'active' row that getActivePlan (status='active' only)
-- ignores and the one_active_plan_per_user partial index never counts -- so no
-- sessionless active plan can ever be served to the user.
-- (first-plan-generation review finding F1.)
alter type public.plan_status add value if not exists 'pending';
