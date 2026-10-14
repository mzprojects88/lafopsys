-- Undo 0093 (roles, pages, powers). Move anyone holding a custom role to a built-in one FIRST:
-- the role CHECK below refuses to come back while a custom key is in use. module_access keeps the
-- menu levels the pages last gave it.
drop function if exists shared.create_role(text, text, text);

create or replace function ops.retire_bed(p_unit_id text) returns void language plpgsql security definer set search_path = ops, shared, pg_temp as $$
begin
  if not shared.has_role('admin') then raise exception 'Only admins can retire beds' using errcode = '42501'; end if;
  if exists (select 1 from ops.stays s join ops.bed_positions bp on bp.id = s.bed_position_id where bp.unit_id = p_unit_id and s.status in ('in_house', 'overdue')) then
    raise exception 'This bed still has a patient checked in -- transfer or discharge them first' using errcode = '23514';
  end if;
  update ops.units set active = false, retired_at = now(), status = 'available', lock_reason = null where id = p_unit_id and active;
  if not found then raise exception 'No active bed %', p_unit_id using errcode = 'P0002'; end if;
end;
$$;

create or replace function ops.create_bed(p_code text, p_room_id text, p_x numeric, p_y numeric, p_rotation_deg integer default 0) returns text language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare v_id text; v_existing ops.units%rowtype;
begin
  if not shared.has_role('admin') then raise exception 'Only admins can add beds' using errcode = '42501'; end if;
  if p_code !~ '^B[0-9]{1,3}$' then raise exception 'A bed code looks like B14' using errcode = '23514'; end if;
  if p_room_id is not null and not exists (select 1 from ops.rooms where id = p_room_id) then raise exception 'Unknown room %', p_room_id using errcode = '23503'; end if;
  select * into v_existing from ops.units where code = p_code;
  if found then
    if v_existing.active then raise exception 'Bed % already exists', p_code using errcode = '23505'; end if;
    update ops.units set active = true, retired_at = null, room_id = p_room_id, x = p_x, y = p_y, rotation_deg = coalesce(p_rotation_deg, 0), status = 'available', lock_reason = null where id = v_existing.id;
    return v_existing.id;
  end if;
  v_id := 'unit-' || p_code;
  insert into ops.units (id, code, room_id, status, shared_unit, x, y, rotation_deg, capacity, active) values (v_id, p_code, p_room_id, 'available', false, p_x, p_y, coalesce(p_rotation_deg, 0), 1, true);
  insert into ops.bed_positions (id, unit_id, label) select v_id || '-' || l, v_id, l from unnest(array['A', 'B', 'C', 'D']) as l;
  return v_id;
end;
$$;

create or replace function ops.guard_room_columns() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and not shared.has_role('admin') then raise exception 'Only admins can change rooms' using errcode = '42501'; end if;
  return new;
end;
$$;
-- guard_unit_columns: re-run its 0073 definition (supabase/migrations/0073_staff_roles.sql) after this file.

drop policy if exists "layout editors add floor plan labels" on ops.floor_plan_labels;
drop policy if exists "layout editors edit floor plan labels" on ops.floor_plan_labels;
drop policy if exists "layout editors delete floor plan labels" on ops.floor_plan_labels;
create policy "admin adds floor plan labels" on ops.floor_plan_labels for insert to authenticated with check (shared.has_role('admin'));
create policy "admin edits floor plan labels" on ops.floor_plan_labels for update to authenticated using (shared.has_role('admin')) with check (shared.has_role('admin'));
create policy "admin deletes floor plan labels" on ops.floor_plan_labels for delete to authenticated using (shared.has_role('admin'));

drop policy if exists "finance work reads all punches" on ops.time_punches;
create policy "admin and finance read all punches" on ops.time_punches for select to authenticated using (shared.has_role('admin', 'finance'));
drop policy if exists "finance work manages donor accounts" on shared.donor_accounts;
create policy "lafopsys staff manage donor accounts" on shared.donor_accounts for all to authenticated using (shared.has_role('admin', 'finance')) with check (shared.has_role('admin', 'finance'));

create or replace function ops.can_allow_bed_exception() returns boolean language sql stable security definer set search_path = '' as $$
  select shared.has_role('admin', 'social_worker', 'inventory_lead');
$$;
create or replace function hr.is_hr_staff() returns boolean language sql stable security definer set search_path = shared, pg_temp as $$
  select exists (select 1 from shared.staff where id = auth.uid() and active
    and (role in ('admin', 'office_admin') or extra_roles && array['admin', 'office_admin'] or is_hr));
$$;

alter publication supabase_realtime drop table shared.role_powers;
alter publication supabase_realtime drop table shared.role_page_access;
alter publication supabase_realtime drop table shared.roles;
drop function if exists shared.has_power(text);
drop table if exists shared.role_powers;
drop function if exists shared.guard_role_powers();
drop table if exists shared.role_page_access;
drop function if exists shared.sync_module_from_pages();
drop function if exists shared.guard_role_page_access();

drop trigger if exists guard_staff_roles on shared.staff;
drop function if exists shared.guard_staff_roles();
alter table shared.module_access drop constraint if exists module_access_role_fkey;
alter table shared.module_access add constraint module_access_role_check check (role = any (array['admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer', 'inventory_staff', 'chef', 'nutritionist', 'inventory_lead', 'office_admin', 'ceo', 'partner_viewer']));
alter table shared.staff drop constraint if exists staff_extra_roles_shape;
alter table shared.staff add constraint staff_extra_roles_check check (extra_roles <@ array['admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer', 'inventory_staff', 'chef', 'nutritionist', 'inventory_lead', 'office_admin', 'ceo'] and not (role = any (extra_roles)) and cardinality(extra_roles) <= 3);
alter table shared.staff drop constraint if exists staff_role_fkey;
alter table shared.staff add constraint staff_role_check check (role = any (array['admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer', 'inventory_staff', 'chef', 'nutritionist', 'inventory_lead', 'office_admin', 'ceo', 'partner_viewer']));
drop table if exists shared.roles;
drop function if exists shared.guard_role();
