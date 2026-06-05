-- =========================================================================
-- Pin search_path on set_updated_at() trigger function.
--
-- The original definition (20260602182721_init_mvp_schema.sql) omitted a
-- search_path clause, which trips the Supabase advisor warning
-- `function_search_path_mutable`. Re-create the function with an empty
-- search_path and a fully-qualified now() so name resolution no longer
-- depends on the caller's search_path. No behavior change.
-- =========================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;
