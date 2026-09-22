-- 0053: LAF HOPE Transport pick-ups (Phase C). Before LAF's own vehicle leaves
-- for NCH, the social worker builds the trip's MANIFEST from NCH's list (the
-- names on the Occupancy Tracker who are not in the house yet). At pick-up the
-- driver ticks each passenger on board from a phone; departure and arrival are
-- stamped as the trip moves. At the house, check-in links the stay to the
-- trip, so every LAF HOPE arrival says which trip brought it.
--
--   * module 'transport' (Settings -> Roles & Access, menu "LAF HOPE
--     Transport"): social workers and drivers edit, house staff view. Trips
--     are also House Operations' (its Trips log), so either module opens them.
--   * ops.trip_manifest: who the trip is for -- a sheet row (and its patient
--     once known), name and carer as the sheet had them, boarded_at / _by.
--   * ops.create_pickup: the trip and its manifest in one transaction.
--   * ops.trips gains departed_at / arrived_at, stamped by the status change.
--   * ops.record_arrival gains p_trip_id: a LAF HOPE arrival names its trip.
-- Rollback: supabase/rollbacks/0053_down.sql.

-- ---------------------------------------------------------------------
-- 1. The module
-- ---------------------------------------------------------------------

alter table shared.module_access drop constraint module_access_module_check;
alter table shared.module_access add constraint module_access_module_check check (module in (
  'executive', 'dashboard', 'calendar', 'staff', 'hr', 'patients', 'house_ops', 'donors',
  'inventory', 'finance', 'compliance', 'analytics', 'reports', 'settings', 'transport'));
insert into shared.module_access (role, module, level) values
  ('admin', 'transport', 'edit'),
  ('social_worker', 'transport', 'edit'),
  ('driver', 'transport', 'edit'),
  ('house_staff', 'transport', 'view');

-- ---------------------------------------------------------------------
-- 2. Trips move, and either module opens them
-- ---------------------------------------------------------------------

alter table ops.trips
  add column departed_at timestamptz,
  add column arrived_at timestamptz;

create or replace function ops.stamp_trip_progress()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'in_progress' and old.status = 'scheduled' then
    new.departed_at := coalesce(new.departed_at, now());
  elsif new.status = 'completed' and old.status <> 'completed' then
    new.departed_at := coalesce(new.departed_at, now());
    new.arrived_at := coalesce(new.arrived_at, now());
  elsif new.status = 'scheduled' then
    new.departed_at := null;
    new.arrived_at := null;
  end if;
  return new;
end;
$$;
create trigger stamp_trip_progress
  before update of status on ops.trips
  for each row execute function ops.stamp_trip_progress();

do $$
declare
  t text;
begin
  foreach t in array array['trips', 'trip_passengers'] loop
    execute format('drop policy "module read" on ops.%I', t);
    execute format('drop policy "module insert" on ops.%I', t);
    execute format('drop policy "module update" on ops.%I', t);
    execute format('drop policy "module delete" on ops.%I', t);
    execute format($p$create policy "module read" on ops.%I for select to authenticated
      using ((select shared.module_viewable('house_ops', 'transport', 'patients')))$p$, t);
    execute format($p$create policy "module insert" on ops.%I for insert to authenticated
      with check ((select shared.module_editable('house_ops')) or (select shared.module_editable('transport')))$p$, t);
    execute format($p$create policy "module update" on ops.%I for update to authenticated
      using ((select shared.module_editable('house_ops')) or (select shared.module_editable('transport')))
      with check ((select shared.module_editable('house_ops')) or (select shared.module_editable('transport')))$p$, t);
    execute format($p$create policy "module delete" on ops.%I for delete to authenticated
      using ((select shared.module_editable('house_ops')) or (select shared.module_editable('transport')))$p$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. The manifest
-- ---------------------------------------------------------------------

create table ops.trip_manifest (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references ops.trips (id) on delete cascade,
  house_sheet_person_id uuid references ops.house_sheet_people (id) on delete set null,
  patient_id uuid references ops.patients (id) on delete set null,
  -- as NCH's sheet had them when the manifest was made
  name text not null check (btrim(name) <> ''),
  carer_name text,
  boarded_at timestamptz,
  boarded_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  unique (trip_id, house_sheet_person_id)
);
create index trip_manifest_trip_idx on ops.trip_manifest (trip_id);
create index trip_manifest_sheet_idx on ops.trip_manifest (house_sheet_person_id);

-- Boarding is stamped by the database; a finished trip's manifest is closed;
-- only someone not yet on board comes off it.
create or replace function ops.guard_trip_manifest()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from ops.trips where id = coalesce(new.trip_id, old.trip_id);
  if tg_op = 'DELETE' then
    if old.boarded_at is not null then
      raise exception '% is already on board -- untick them first', old.name using errcode = '23514';
    end if;
    if v_status = 'completed' then
      raise exception 'The trip has arrived; its manifest is closed' using errcode = '23514';
    end if;
    return old;
  end if;
  if v_status = 'completed' and (tg_op = 'INSERT' or new.boarded_at is distinct from old.boarded_at) then
    raise exception 'The trip has arrived; its manifest is closed' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and current_user = 'authenticated'
     and (new.trip_id, new.house_sheet_person_id, new.name, new.carer_name, new.created_at)
         is distinct from (old.trip_id, old.house_sheet_person_id, old.name, old.carer_name, old.created_at) then
    raise exception 'Only boarding changes on a manifest row' using errcode = '42501';
  end if;
  if new.boarded_at is null then
    new.boarded_by := null;
  elsif tg_op = 'INSERT' or old.boarded_at is null then
    new.boarded_at := now();
    new.boarded_by := auth.uid();
  else
    new.boarded_at := old.boarded_at;
    new.boarded_by := old.boarded_by;
  end if;
  return new;
end;
$$;
create trigger guard_trip_manifest
  before insert or update or delete on ops.trip_manifest
  for each row execute function ops.guard_trip_manifest();

alter table ops.trip_manifest enable row level security;
create policy "module read" on ops.trip_manifest for select to authenticated
  using ((select shared.module_viewable('transport', 'house_ops', 'patients')));
create policy "transport editors add" on ops.trip_manifest for insert to authenticated
  with check ((select shared.module_editable('transport')));
create policy "transport editors board" on ops.trip_manifest for update to authenticated
  using ((select shared.module_editable('transport'))) with check ((select shared.module_editable('transport')));
create policy "transport editors remove" on ops.trip_manifest for delete to authenticated
  using ((select shared.module_editable('transport')));
revoke all on ops.trip_manifest from authenticated;
grant select, insert, delete on ops.trip_manifest to authenticated;
grant update (boarded_at) on ops.trip_manifest to authenticated;
alter publication supabase_realtime add table ops.trip_manifest;

-- ---------------------------------------------------------------------
-- 4. A pick-up in one step
-- ---------------------------------------------------------------------

-- The names come from NCH's sheet: each row's name, carer and (when the row
-- is settled) patient are copied onto the manifest.
create or replace function ops.create_pickup(
  p_date date,
  p_departure_time text,
  p_driver_id uuid,
  p_sheet_row_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_trip_id uuid;
begin
  if not shared.module_editable('transport') then
    raise exception 'Your access to LAF HOPE Transport is view only' using errcode = '42501';
  end if;
  if p_date is null or nullif(btrim(p_departure_time), '') is null then
    raise exception 'Give the day and the departure time' using errcode = '22023';
  end if;
  if p_sheet_row_ids is null or cardinality(p_sheet_row_ids) = 0 then
    raise exception 'Pick who to pick up' using errcode = '22023';
  end if;
  if p_driver_id is not null and not exists (select 1 from shared.staff where id = p_driver_id and active) then
    raise exception 'No such driver' using errcode = 'P0002';
  end if;
  if (select count(*) from ops.house_sheet_people where id = any (p_sheet_row_ids)) <> cardinality(p_sheet_row_ids) then
    raise exception 'A name is no longer on the house sheet' using errcode = 'P0002';
  end if;

  insert into ops.trips (date, direction, driver_staff_id, vehicle, departure_time, status)
    values (p_date, 'from_hospital', p_driver_id, 'LAF HOPE Transport', btrim(p_departure_time), 'scheduled')
    returning id into v_trip_id;

  insert into ops.trip_manifest (trip_id, house_sheet_person_id, patient_id, name, carer_name)
    select v_trip_id, h.id,
           case when h.match_status in ('auto_matched', 'confirmed') then h.matched_patient_id
                else (select r.admitted_patient_id from ops.referrals r where r.id = h.referral_id) end,
           h.patient_name, h.carer_name
    from ops.house_sheet_people h
    where h.id = any (p_sheet_row_ids);

  return v_trip_id;
end;
$$;

revoke execute on function ops.create_pickup(date, text, uuid, uuid[]) from public;
grant execute on function ops.create_pickup(date, text, uuid, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. A LAF HOPE arrival names its trip
-- ---------------------------------------------------------------------

drop function ops.record_arrival(uuid, text, text, uuid, numeric);

create or replace function ops.record_arrival(
  p_stay_id uuid,
  p_mode text,
  p_app text default null,
  p_ride_id uuid default null,
  p_fare numeric default null,
  p_trip_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_stay ops.stays%rowtype;
  v_ride ops.arrival_rides%rowtype;
  v_ride_id uuid;
  v_old_ride uuid;
begin
  if not shared.module_editable('patients') then
    raise exception 'Your access to Patients is view only' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('laf_hope', 'ride_app', 'own_transport', 'hospital_vehicle') then
    raise exception 'Say how they arrived' using errcode = '22023';
  end if;
  select * into v_stay from ops.stays where id = p_stay_id for update;
  if not found then
    raise exception 'No such stay' using errcode = 'P0002';
  end if;
  v_old_ride := v_stay.arrival_ride_id;

  if p_trip_id is not null then
    if p_mode <> 'laf_hope' then
      raise exception 'Only a LAF HOPE arrival has a trip' using errcode = '22023';
    end if;
    if not exists (select 1 from ops.trips where id = p_trip_id) then
      raise exception 'No such trip' using errcode = 'P0002';
    end if;
  end if;

  if p_mode = 'ride_app' then
    if p_ride_id is not null then
      select * into v_ride from ops.arrival_rides where id = p_ride_id for update;
      if not found then
        raise exception 'No such ride' using errcode = 'P0002';
      end if;
      if v_ride.reimbursed_at is not null and v_ride.id is distinct from v_old_ride then
        raise exception 'That ride has already been paid back; start a new one' using errcode = '23514';
      end if;
      v_ride_id := v_ride.id;
    else
      if p_app is null or p_app not in ('grab', 'joyride', 'indrive', 'moveit', 'angkas') then
        raise exception 'Say which app' using errcode = '22023';
      end if;
      insert into ops.arrival_rides (ride_date, app, fare)
        values (v_stay.check_in_at, p_app, p_fare)
        returning id into v_ride_id;
    end if;
  end if;

  update ops.stays
    set arrival_mode = p_mode,
        arrival_ride_id = v_ride_id,
        arrival_trip_id = case when p_mode = 'laf_hope' then p_trip_id end
    where id = v_stay.id;

  -- The trip's manifest learns the patient behind the name.
  if p_trip_id is not null then
    update ops.trip_manifest m set patient_id = v_stay.patient_id
      where m.trip_id = p_trip_id and m.patient_id is null
        and m.house_sheet_person_id in (
          select h.id from ops.house_sheet_people h
          left join ops.referrals r on r.id = h.referral_id
          where h.matched_patient_id = v_stay.patient_id or r.admitted_patient_id = v_stay.patient_id);
  end if;

  if v_old_ride is not null and v_old_ride is distinct from v_ride_id then
    delete from ops.arrival_rides r
      where r.id = v_old_ride and r.reimbursed_at is null
        and not exists (select 1 from ops.stays s where s.arrival_ride_id = r.id);
  end if;

  return jsonb_build_object('stay_id', v_stay.id, 'arrival_mode', p_mode, 'ride_id', v_ride_id, 'trip_id', p_trip_id);
end;
$$;

revoke execute on function ops.record_arrival(uuid, text, text, uuid, numeric, uuid) from public;
grant execute on function ops.record_arrival(uuid, text, text, uuid, numeric, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
