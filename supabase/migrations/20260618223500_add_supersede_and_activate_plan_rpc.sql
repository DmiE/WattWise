-- =========================================================================
-- supersede_and_activate_plan — atomic plan renewal in one transaction.
--
-- Renewal must retire the caller's current active plan AND activate a freshly
-- persisted pending plan together. The one_active_plan_per_user partial unique
-- index is non-deferrable, so the two writes cannot be split across statements
-- without risking a transient two-active-plans state. A SECURITY INVOKER
-- function runs both updates in its single implicit transaction under the
-- caller's RLS session (mirroring set_session_status), so it can only touch the
-- caller's own rows.
--
-- Ordering is load-bearing: flip the old active plan -> 'superseded' FIRST, then
-- the new pending plan -> 'active'. Reversing it would momentarily leave two
-- 'active' rows and violate one_active_plan_per_user. auth.uid()-scoped WHERE
-- clauses keep the function from acting on another user's plans even if the id
-- is guessed; if no pending row is activated we raise so the API route treats
-- it as a failure rather than silently succeeding.
-- =========================================================================

create function public.supersede_and_activate_plan(
  p_new_plan_id uuid
) returns public.plans
language plpgsql
security invoker
set search_path = ''
as $$
declare v_plan public.plans;
begin
  update public.plans
    set status = 'superseded', updated_at = pg_catalog.now()
    where user_id = auth.uid() and status = 'active';

  update public.plans
    set status = 'active', updated_at = pg_catalog.now()
    where id = p_new_plan_id and user_id = auth.uid() and status = 'pending'
    returning * into v_plan;

  if v_plan.id is null then
    raise exception 'pending plan not found or not owned by caller';
  end if;

  return v_plan;
end;
$$;

revoke execute on function public.supersede_and_activate_plan(uuid) from public, anon;
grant execute on function public.supersede_and_activate_plan(uuid) to authenticated;
