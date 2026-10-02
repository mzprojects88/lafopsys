-- 0073: a person can hold more than one role; new roles Office Admin and CEO.
--
-- Asked 2026-10-02 ("properly segregate the roles"). Some people do two jobs
-- -- Office Admin and Inventory Lead; Inventory Staff and Driver -- and the
-- CEO is to see and edit everything, as the Super Admin does, under his own
-- title. Phase 1 of 4: the foundation only. NOBODY'S ACCESS CHANGES HERE:
-- everyone has exactly one role today and every check below gives a one-role
-- person the same answer as before (the matrices assert it).
--
--   1. shared.staff.extra_roles: additional roles beside the main `role`
--      (which still gives the title and home page). What a person may do is
--      everything any of their roles allows. Only an admin can change it --
--      it is on guard_staff_privileged_columns' list, or anyone able to edit
--      their own row could hand themselves 'admin'.
--   2. New roles 'office_admin' and 'ceo' (both CHECK lists). 'admin' stays the
--      database name of the Super Admin. The CEO gets admin powers by holding
--      'admin' as an additional role (phase 4), not by special-casing 'ceo'.
--   3. shared.current_staff_roles() and shared.has_role(...): the one place a
--      role is checked from now on. current_staff_role() is unchanged and keeps
--      meaning the main role.
--   4. Every lafopsys role check moves onto has_role(): module_level (the
--      highest level across a person's roles), hr.is_hr_staff (Office Admin
--      runs HR, as decided), bed and floor-plan guards, the staff/privileged
--      guard, and 21 policies. The 7 reference lists (provinces, cities,
--      hospitals, ...) become readable by any active staff -- they listed 7
--      roles by hand, so inventory roles saw empty dropdowns.
--
-- laf-inventory's helpers follow in its own migration (0057), after this one.

-- ---- 1, 2. the roles ----
alter table shared.staff drop constraint staff_role_check;
alter table shared.staff add constraint staff_role_check check (role = any (array[
  'admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer',
  'inventory_staff', 'chef', 'nutritionist', 'inventory_lead', 'office_admin', 'ceo']));

alter table shared.staff
  add column extra_roles text[] not null default '{}';
alter table shared.staff add constraint staff_extra_roles_check check (
  extra_roles <@ array[
    'admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer',
    'inventory_staff', 'chef', 'nutritionist', 'inventory_lead', 'office_admin', 'ceo']
  and not (role = any (extra_roles))
  and cardinality(extra_roles) <= 3);
comment on column shared.staff.extra_roles is
  'Additional roles beside the main role (0073). Access is the union of all roles; the main role gives the title and home page.';

alter table shared.module_access drop constraint module_access_role_check;
alter table shared.module_access add constraint module_access_role_check check (role = any (array[
  'admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer',
  'inventory_staff', 'chef', 'nutritionist', 'inventory_lead', 'office_admin', 'ceo']));

-- ---- 3. the one place a role is checked ----
create or replace function shared.current_staff_roles()
returns text[] language sql stable security definer
set search_path to 'shared', 'pg_temp' as $$
  select array[role] || extra_roles from shared.staff where id = auth.uid() and active;
$$;
revoke all on function shared.current_staff_roles() from public;
grant execute on function shared.current_staff_roles() to anon, authenticated, service_role;

create or replace function shared.has_role(variadic p_roles text[])
returns boolean language sql stable security definer
set search_path to 'shared', 'pg_temp' as $$
  select coalesce(shared.current_staff_roles() && p_roles, false);
$$;
revoke all on function shared.has_role(text[]) from public;
grant execute on function shared.has_role(text[]) to anon, authenticated, service_role;

-- ---- 4. lafopsys checks onto has_role ----
create or replace function shared.module_level(p_module text)
returns text language sql stable security definer
set search_path to 'shared', 'pg_temp' as $$
  -- The highest level any of the person's roles has for the module.
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

create or replace function hr.is_hr_staff()
returns boolean language sql stable security definer
set search_path to 'shared', 'pg_temp' as $$
  -- The Super Admin and the Office Admin run HR (2026-10-02), plus anyone flagged is_hr.
  select exists (
    select 1
    from shared.staff
    where id = auth.uid()
      and active
      and (role in ('admin', 'office_admin') or extra_roles && array['admin', 'office_admin'] or is_hr)
  );
$$;

create or replace function shared.guard_staff_privileged_columns()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated'
     and (
       new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.extra_roles is distinct from old.extra_roles
       or new.active is distinct from old.active
       or new.staff_code is distinct from old.staff_code
       or new.position is distinct from old.position
       or new.hire_date is distinct from old.hire_date
       or new.clock_in_exempt is distinct from old.clock_in_exempt
       or new.landing_path is distinct from old.landing_path
       or new.is_hr is distinct from old.is_hr
     )
     and not shared.has_role('admin') then
    raise exception 'Only admins can change staff role, status, code, or access settings'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function ops.can_allow_bed_exception()
returns boolean language sql stable security definer
set search_path to '' as $$
  select shared.has_role('admin', 'social_worker', 'inventory_lead');
$$;

create or replace function ops.create_bed(p_code text, p_room_id text, p_x numeric, p_y numeric, p_rotation_deg integer default 0)
returns text language plpgsql security definer
set search_path to 'ops', 'shared', 'pg_temp' as $$
declare
  v_id text;
  v_existing ops.units%rowtype;
begin
  if not shared.has_role('admin') then
    raise exception 'Only admins can add beds' using errcode = '42501';
  end if;
  if p_code !~ '^B[0-9]{1,3}$' then
    raise exception 'A bed code looks like B14' using errcode = '23514';
  end if;
  if p_room_id is not null and not exists (select 1 from ops.rooms where id = p_room_id) then
    raise exception 'Unknown room %', p_room_id using errcode = '23503';
  end if;

  select * into v_existing from ops.units where code = p_code;
  if found then
    if v_existing.active then
      raise exception 'Bed % already exists', p_code using errcode = '23505';
    end if;
    update ops.units
      set active = true, retired_at = null, room_id = p_room_id, x = p_x, y = p_y,
          rotation_deg = coalesce(p_rotation_deg, 0), status = 'available', lock_reason = null
      where id = v_existing.id;
    return v_existing.id;
  end if;

  v_id := 'unit-' || p_code;
  insert into ops.units (id, code, room_id, status, shared_unit, x, y, rotation_deg, capacity, active)
    values (v_id, p_code, p_room_id, 'available', false, p_x, p_y, coalesce(p_rotation_deg, 0), 1, true);
  insert into ops.bed_positions (id, unit_id, label)
    select v_id || '-' || l, v_id, l from unnest(array['A', 'B', 'C', 'D']) as l;
  return v_id;
end;
$$;

create or replace function ops.guard_room_columns()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and not shared.has_role('admin') then
    raise exception 'Only admins can change rooms' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function ops.guard_unit_columns()
returns trigger language plpgsql as $$
declare
  is_admin boolean := shared.has_role('admin');
  geometry_changed boolean :=
       new.code is distinct from old.code
    or new.room_id is distinct from old.room_id
    or new.x is distinct from old.x
    or new.y is distinct from old.y
    or new.w is distinct from old.w
    or new.h is distinct from old.h
    or new.rotation_deg is distinct from old.rotation_deg
    or new.capacity is distinct from old.capacity
    or new.active is distinct from old.active
    or new.retired_at is distinct from old.retired_at
    or new.shared_unit is distinct from old.shared_unit;
  lock_changed boolean :=
       new.status is distinct from old.status
    or new.lock_reason is distinct from old.lock_reason;
begin
  if old.active and not new.active and exists (
    select 1 from ops.stays s
    join ops.bed_positions bp on bp.id = s.bed_position_id
    where bp.unit_id = old.id and s.status in ('in_house', 'overdue')
  ) then
    raise exception 'Bed % still has a patient checked in -- transfer or discharge them first', old.code
      using errcode = '23514';
  end if;
  if new.status = 'available' then
    new.lock_reason := null;
  end if;

  if current_user <> 'authenticated' then
    return new;
  end if;

  if not shared.module_editable('patients') then
    raise exception 'This role cannot change beds' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
     or new.status_changed_at is distinct from old.status_changed_at
     or new.status_changed_by is distinct from old.status_changed_by then
    raise exception 'Bed identity and the lock stamp are set by the database' using errcode = '42501';
  end if;
  if geometry_changed and not is_admin then
    raise exception 'Only admins can change the floor plan' using errcode = '42501';
  end if;
  if lock_changed then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function ops.retire_bed(p_unit_id text)
returns void language plpgsql security definer
set search_path to 'ops', 'shared', 'pg_temp' as $$
begin
  if not shared.has_role('admin') then
    raise exception 'Only admins can retire beds' using errcode = '42501';
  end if;
  if exists (
    select 1 from ops.stays s
    join ops.bed_positions bp on bp.id = s.bed_position_id
    where bp.unit_id = p_unit_id and s.status in ('in_house', 'overdue')
  ) then
    raise exception 'This bed still has a patient checked in -- transfer or discharge them first'
      using errcode = '23514';
  end if;
  update ops.units set active = false, retired_at = now(), status = 'available', lock_reason = null
    where id = p_unit_id and active;
  if not found then
    raise exception 'No active bed %', p_unit_id using errcode = 'P0002';
  end if;
end;
$$;

-- Reference lists: any active staff member (they named 7 roles by hand).
do $$
declare t text;
begin
  foreach t in array array['provinces', 'cities', 'diagnoses', 'treatment_phases', 'hospitals', 'hospital_nurses', 'programs'] loop
    execute format('drop policy "module read" on ops.%I', t);
    execute format('create policy "module read" on ops.%I for select to authenticated using ((select shared.current_staff_role()) is not null)', t);
  end loop;
end;
$$;

drop policy "inventory roles insert donations" on ops.donations;
create policy "inventory roles insert donations" on ops.donations for insert to authenticated
  with check (shared.has_role('chef', 'inventory_staff', 'nutritionist', 'inventory_lead'));
drop policy "inventory roles insert donors" on ops.donors;
create policy "inventory roles insert donors" on ops.donors for insert to authenticated
  with check (shared.has_role('chef', 'inventory_staff', 'nutritionist', 'inventory_lead'));
drop policy "inventory roles read and add donors" on ops.donors;
create policy "inventory roles read and add donors" on ops.donors for select to authenticated
  using (shared.has_role('chef', 'inventory_staff', 'nutritionist', 'inventory_lead'));

drop policy "admin adds floor plan labels" on ops.floor_plan_labels;
create policy "admin adds floor plan labels" on ops.floor_plan_labels for insert to authenticated
  with check (shared.has_role('admin'));
drop policy "admin deletes floor plan labels" on ops.floor_plan_labels;
create policy "admin deletes floor plan labels" on ops.floor_plan_labels for delete to authenticated
  using (shared.has_role('admin'));
drop policy "admin edits floor plan labels" on ops.floor_plan_labels;
create policy "admin edits floor plan labels" on ops.floor_plan_labels for update to authenticated
  using (shared.has_role('admin')) with check (shared.has_role('admin'));

drop policy "admins update any time entry" on ops.time_entries;
create policy "admins update any time entry" on ops.time_entries for update to authenticated
  using (shared.has_role('admin')) with check (shared.has_role('admin'));
drop policy "admin and finance read all punches" on ops.time_punches;
create policy "admin and finance read all punches" on ops.time_punches for select to authenticated
  using (shared.has_role('admin', 'finance'));
drop policy "admins insert adjustment punches" on ops.time_punches;
create policy "admins insert adjustment punches" on ops.time_punches for insert to authenticated
  with check (source = 'adjustment' and adjusted_by = auth.uid() and shared.has_role('admin'));

drop policy "admins manage app settings" on shared.app_settings;
create policy "admins manage app settings" on shared.app_settings for update to authenticated
  using (shared.has_role('admin')) with check (shared.has_role('admin'));
drop policy "lafopsys staff manage donor accounts" on shared.donor_accounts;
create policy "lafopsys staff manage donor accounts" on shared.donor_accounts for all to authenticated
  using (shared.has_role('admin', 'finance')) with check (shared.has_role('admin', 'finance'));
drop policy "admins change module access" on shared.module_access;
create policy "admins change module access" on shared.module_access for update to authenticated
  using ((select shared.has_role('admin'))) with check ((select shared.has_role('admin')));
drop policy "admins set module access" on shared.module_access;
create policy "admins set module access" on shared.module_access for insert to authenticated
  with check ((select shared.has_role('admin')));
drop policy "admins manage staff" on shared.staff;
create policy "admins manage staff" on shared.staff for all to authenticated
  using (shared.has_role('admin')) with check (shared.has_role('admin'));

notify pgrst, 'reload schema';
