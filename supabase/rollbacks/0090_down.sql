-- Undo 0090 (outside / partner accounts). Deactivate or re-role every partner account FIRST:
-- the role check below refuses to come back while a 'partner_viewer' row exists, and the moment
-- the two helpers are restored such a row would read as LAF staff.
--   update shared.staff set active = false where role = 'partner_viewer';   -- then re-role or delete them
-- Drop the Inventory side first (laf-inventory 0063 down), which calls shared.partner_can_view.
delete from shared.module_access where role = 'partner_viewer' or module in ('inventory_stock', 'inventory_given_out');
drop function if exists shared.partner_can_view(text);
drop policy if exists "read own row" on shared.staff;
drop function if exists shared.is_partner();
create or replace view hr.v_roster as
  select id as employee_id, staff_id, first_name, last_name, position, status
  from hr.employees
  where status in ('active', 'on_leave');

create or replace function shared.current_staff_role()
returns text language sql stable security definer set search_path = shared, pg_temp
as $$ select role from shared.staff where id = auth.uid() and active; $$;
create or replace function shared.current_staff_roles()
returns text[] language sql stable security definer set search_path = shared, pg_temp
as $$ select array[role] || extra_roles from shared.staff where id = auth.uid() and active; $$;

create or replace function shared.guard_module_access()
returns trigger language plpgsql as $$
begin
  if new.role = 'admin' and new.level <> 'edit' then
    raise exception 'Admins always have full access' using errcode = '23514';
  end if;
  if new.module = 'settings' and new.role <> 'admin' and new.level <> 'none' then
    raise exception 'Settings stays with admins' using errcode = '23514';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

alter table shared.module_access drop constraint module_access_module_check;
alter table shared.module_access add constraint module_access_module_check check (
  module = any (array['executive', 'dashboard', 'calendar', 'staff', 'hr', 'patients', 'house_ops', 'donors', 'inventory', 'finance', 'compliance', 'analytics', 'reports', 'settings', 'transport'])
);
alter table shared.module_access drop constraint module_access_role_check;
alter table shared.module_access add constraint module_access_role_check check (
  role = any (array['admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer', 'inventory_staff', 'chef', 'nutritionist', 'inventory_lead', 'office_admin', 'ceo'])
);
alter table shared.staff drop constraint if exists staff_partner_plain;
alter table shared.staff drop constraint staff_role_check;
alter table shared.staff add constraint staff_role_check check (
  role = any (array['admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer', 'inventory_staff', 'chef', 'nutritionist', 'inventory_lead', 'office_admin', 'ceo'])
);
