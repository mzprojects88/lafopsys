-- Undo 0091 (manage users). Per-person overrides and the account event log are dropped; the
-- role grid decides again for everyone, as in 0073.
drop function if exists shared.delete_unused_staff(uuid);
drop table if exists shared.staff_events;

create or replace function shared.module_level(p_module text)
returns text language sql stable security definer set search_path = shared, pg_temp
as $$
  select case
    when rs is null then 'none'
    when 'admin' = any (rs) then 'edit'
    else coalesce((
      select case max(case a.level when 'edit' then 2 when 'view' then 1 else 0 end) when 2 then 'edit' when 1 then 'view' end
      from shared.module_access a
      where a.role = any (rs) and a.module = p_module
    ), 'none')
  end
  from (select shared.current_staff_roles() as rs) s;
$$;

alter publication supabase_realtime drop table shared.staff_module_access;
drop table if exists shared.staff_module_access;
drop function if exists shared.guard_staff_module_access();
