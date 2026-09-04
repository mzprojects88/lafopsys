-- Reverses 0026: current_staff_role() ignores `active` again (0001 definition).
create or replace function shared.current_staff_role()
returns text
language sql
security definer
set search_path = shared, pg_temp
stable
as $$
  select role from shared.staff where id = auth.uid();
$$;
