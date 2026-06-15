-- =========================================================================
-- set_session_status — atomic, RLS-respecting session-status transitions.
--
-- Marking a session "done" is two writes (update plan_sessions.status, then
-- upsert session_logs); skipping/resetting is an update plus a log delete. The
-- codebase forbids service-role clients, so the only way to make these
-- multi-write transitions atomic is a SECURITY INVOKER function that runs them
-- in its single implicit transaction under the caller's RLS session.
--
-- Ownership is enforced by RLS, not by an explicit user check: an update to a
-- session the caller doesn't own (or that doesn't exist) matches 0 rows, which
-- we detect and raise as P0002 so the API route can answer 404 rather than
-- silently succeeding. The session_logs CHECK constraints remain the
-- storage-level trust boundary for the log values.
-- =========================================================================

create function public.set_session_status(
  p_session_id uuid,
  p_status public.session_status,
  p_actual_duration_min smallint default null,
  p_rating smallint default null,
  p_km_ridden numeric default null
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare v_rows int;
begin
  update public.plan_sessions set status = p_status where id = p_session_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if p_status = 'done' then
    insert into public.session_logs (plan_session_id, actual_duration_min, rating, km_ridden)
    values (p_session_id, p_actual_duration_min, p_rating, p_km_ridden)
    on conflict (plan_session_id) do update
      set actual_duration_min = excluded.actual_duration_min,
          rating = excluded.rating,
          km_ridden = excluded.km_ridden,
          logged_at = pg_catalog.now();
  else
    delete from public.session_logs where plan_session_id = p_session_id;
  end if;
end;
$$;

revoke execute on function public.set_session_status(uuid, public.session_status, smallint, smallint, numeric) from public, anon;
grant execute on function public.set_session_status(uuid, public.session_status, smallint, smallint, numeric) to authenticated;
