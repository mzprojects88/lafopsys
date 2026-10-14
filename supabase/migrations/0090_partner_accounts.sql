-- 0090: outside (partner) accounts (decided by the user 2026-10-14).
--
-- A representative of a partner (first: NCH Hospital) gets an account that opens the Inventory
-- app to look only. She is an account, not LAF staff: role 'partner_viewer' is a main role that
--
--   1. passes NONE of the staff-wide rules. shared.current_staff_role() and
--      shared.current_staff_roles() answer nothing for a partner role, and every policy, view
--      and function that admits "any staff", a named role or a module level is built on those
--      two -- so the roster, time records, HR, calendar, donors, patients and every Inventory
--      table are closed to her by construction, including rules written later the same way.
--   2. reads only what Settings > Roles & Access gives it: shared.module_access rows for the
--      outside areas ('inventory_stock', 'inventory_given_out'), 'view' at most. The Inventory
--      schema serves those through its own functions (laf-inventory 0063), which return no
--      cost, donor, patient, carer or staff column.
--   3. cannot hold an additional role or the HR flag, and is never an additional role.
--
-- Nothing changes for any existing account: both helpers return what they did for every role
-- that exists today. Rollback: supabase/rollbacks/0090_down.sql

-- ---------------------------------------------------------------------
-- 1. The role key, main role only
-- ---------------------------------------------------------------------
alter table shared.staff drop constraint staff_role_check;
alter table shared.staff add constraint staff_role_check check (
  role = any (array['admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer', 'inventory_staff', 'chef', 'nutritionist', 'inventory_lead', 'office_admin', 'ceo', 'partner_viewer'])
);
-- staff_extra_roles_check keeps its list, so 'partner_viewer' can never be an additional role.
alter table shared.staff add constraint staff_partner_plain check (role <> 'partner_viewer' or (extra_roles = '{}' and not is_hr));

-- ---------------------------------------------------------------------
-- 2. Partner roles are not staff
-- ---------------------------------------------------------------------
create or replace function shared.current_staff_role()
returns text
language sql
stable
security definer
set search_path = shared, pg_temp
as $$
  select role from shared.staff where id = auth.uid() and active and role <> 'partner_viewer';
$$;

create or replace function shared.current_staff_roles()
returns text[]
language sql
stable
security definer
set search_path = shared, pg_temp
as $$
  select array[role] || extra_roles from shared.staff where id = auth.uid() and active and role <> 'partner_viewer';
$$;

create or replace function shared.is_partner()
returns boolean
language sql
stable
security definer
set search_path = shared, pg_temp
as $$
  select exists (select 1 from shared.staff where id = auth.uid() and active and role = 'partner_viewer');
$$;
revoke all on function shared.is_partner() from public;
grant execute on function shared.is_partner() to authenticated;
comment on function shared.is_partner() is 'The caller is an active outside (partner) account (0090). Partner roles are invisible to current_staff_role(s).';

-- A person reads their own row whoever they are: the Inventory app needs it to greet a partner
-- and to clear must_change_pin. (Staff already read every row.)
create policy "read own row" on shared.staff for select to authenticated using (id = (select auth.uid()) and active);

-- hr.v_roster (0041) is the one view written with no gate at all: "readable by everyone on
-- staff" was true only while every account was staff. Same columns, same grants.
create or replace view hr.v_roster as
  select id as employee_id, staff_id, first_name, last_name, position, status
  from hr.employees
  where status in ('active', 'on_leave') and shared.current_staff_role() is not null;

-- ---------------------------------------------------------------------
-- 3. What a partner role may open: the access grid, view at most
-- ---------------------------------------------------------------------
alter table shared.module_access drop constraint module_access_role_check;
alter table shared.module_access add constraint module_access_role_check check (
  role = any (array['admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer', 'inventory_staff', 'chef', 'nutritionist', 'inventory_lead', 'office_admin', 'ceo', 'partner_viewer'])
);
alter table shared.module_access drop constraint module_access_module_check;
alter table shared.module_access add constraint module_access_module_check check (
  module = any (array['executive', 'dashboard', 'calendar', 'staff', 'hr', 'patients', 'house_ops', 'donors', 'inventory', 'finance', 'compliance', 'analytics', 'reports', 'settings', 'transport', 'inventory_stock', 'inventory_given_out'])
);

create or replace function shared.guard_module_access()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'admin' and new.level <> 'edit' then
    raise exception 'Admins always have full access' using errcode = '23514';
  end if;
  -- Settings holds users, roles and this grid: opening it to another role
  -- would let that role make itself admin.
  if new.module = 'settings' and new.role <> 'admin' and new.level <> 'none' then
    raise exception 'Settings stays with admins' using errcode = '23514';
  end if;
  -- Outside accounts (0090): the outside areas only, and never more than looking.
  if new.role = 'partner_viewer' and new.level <> 'none' and (new.level <> 'view' or new.module not in ('inventory_stock', 'inventory_given_out')) then
    raise exception 'Outside accounts can only view the outside areas' using errcode = '23514';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function shared.partner_can_view(p_module text)
returns boolean
language sql
stable
security definer
set search_path = shared, pg_temp
as $$
  select shared.is_partner()
    and exists (select 1 from shared.module_access a where a.role = 'partner_viewer' and a.module = p_module and a.level = 'view');
$$;
revoke all on function shared.partner_can_view(text) from public;
grant execute on function shared.partner_can_view(text) to authenticated;
comment on function shared.partner_can_view(text) is 'The caller is a partner account and the access grid lets partner roles view this outside area (0090).';

insert into shared.module_access (role, module, level) values
  ('partner_viewer', 'inventory_stock', 'view'),
  ('partner_viewer', 'inventory_given_out', 'none')
on conflict (role, module) do nothing;
