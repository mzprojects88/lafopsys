-- Undo 0073 (more than one role; office_admin and ceo). Only safe while nobody
-- has extra_roles or the new roles: the CHECKs below refuse otherwise, on purpose.
-- Restores the 0072-era definitions (single-role checks).

create or replace function shared.module_level(p_module text)
returns text language sql stable security definer
set search_path to 'shared', 'pg_temp' as $$
  select case
    when r is null then 'none'
    when r = 'admin' then 'edit'
    else coalesce((select level from shared.module_access where role = r and module = p_module), 'none')
  end
  from (select shared.current_staff_role() as r) s;
$$;

create or replace function hr.is_hr_staff()
returns boolean language sql stable security definer
set search_path to 'shared', 'pg_temp' as $$
  select exists (select 1 from shared.staff where id = auth.uid() and active and (role = 'admin' or is_hr));
$$;

create or replace function shared.guard_staff_privileged_columns()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated'
     and (
       new.id is distinct from old.id or new.role is distinct from old.role or new.active is distinct from old.active
       or new.staff_code is distinct from old.staff_code or new.position is distinct from old.position
       or new.hire_date is distinct from old.hire_date or new.clock_in_exempt is distinct from old.clock_in_exempt
       or new.landing_path is distinct from old.landing_path or new.is_hr is distinct from old.is_hr
     )
     and coalesce(shared.current_staff_role(), '') <> 'admin' then
    raise exception 'Only admins can change staff role, status, code, or access settings' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function ops.can_allow_bed_exception()
returns boolean language sql stable security definer
set search_path to '' as $$
  select coalesce(shared.current_staff_role() in ('admin', 'social_worker', 'inventory_lead'), false);
$$;

create or replace function ops.guard_room_columns()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and coalesce(shared.current_staff_role(), '') <> 'admin' then
    raise exception 'Only admins can change rooms' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- create_bed, retire_bed and guard_unit_columns: re-run their 0047 / 0050 definitions
-- (their only change in 0073 is `not shared.has_role('admin')`, which is equivalent while
-- nobody has extra roles, so leaving them is also safe).

do $$
declare t text;
begin
  foreach t in array array['provinces', 'cities', 'diagnoses', 'treatment_phases', 'hospitals', 'hospital_nurses', 'programs'] loop
    execute format('drop policy "module read" on ops.%I', t);
    execute format($p$create policy "module read" on ops.%I for select to authenticated using ((select shared.current_staff_role()) = any (array['admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer']))$p$, t);
  end loop;
end;
$$;
-- The other 14 policies were rewritten 1:1 onto has_role(); with nobody holding extra roles
-- they answer exactly as before, so they can stay until has_role is dropped (it isn't here).

alter table shared.module_access drop constraint module_access_role_check;
alter table shared.module_access add constraint module_access_role_check check (role = any (array[
  'admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer', 'inventory_staff', 'chef', 'nutritionist', 'inventory_lead']));
alter table shared.staff drop constraint staff_extra_roles_check;
alter table shared.staff drop column extra_roles;
alter table shared.staff drop constraint staff_role_check;
alter table shared.staff add constraint staff_role_check check (role = any (array[
  'admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer', 'inventory_staff', 'chef', 'nutritionist', 'inventory_lead']));
notify pgrst, 'reload schema';
