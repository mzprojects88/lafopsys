-- 0096: trips with passengers both ways (user, 2026-10-15).
--
-- Until now only a pick-up from NCH had passengers, made from NCH's sheet, and the Transport page
-- found pick-ups by the vehicle's NAME ('LAF HOPE Transport'). Production renamed the van
-- 'HOPE in Transit', so a new pick-up was no longer linked to the van (no odometer) and a linked
-- one dropped off the page once it departed (the trip takes the vehicle's new name).
--
--   1. ops.trips.carries_passengers: a pick-up to LAF House or a delivery to the hospital. The page
--      finds them by this, never by a name. Every pick-up so far carries passengers.
--   2. ops.create_trip(...): either direction, on a chosen vehicle (default: the first active one),
--      passengers from NCH's sheet and/or patients on file. create_pickup now calls it.
--   3. The manifest: the driver adds passengers (a patient on file or a typed name); name, carer,
--      patient and a note can be corrected until the trip arrives. Transport or Patients editors.

-- ---- 1. trips that carry passengers ----
alter table ops.trips add column if not exists carries_passengers boolean not null default false;
comment on column ops.trips.carries_passengers is 'A pick-up to LAF House (from_hospital) or a delivery to the hospital (to_hospital) with a passenger list (0096).';
update ops.trips set carries_passengers = true where direction = 'from_hospital' and not carries_passengers;
create index if not exists trips_passengers_idx on ops.trips (date) where carries_passengers;

-- ---- 2. one way to make a trip with passengers ----
create or replace function ops.create_trip(
  p_date date,
  p_departure_time text,
  p_driver_id uuid,
  p_direction text,
  p_destination text default null,
  p_vehicle_id uuid default null,
  p_sheet_row_ids uuid[] default '{}',
  p_patient_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_trip_id uuid;
  v_vehicle ops.vehicles%rowtype;
  v_sheet uuid[] := coalesce(p_sheet_row_ids, '{}');
  v_patients uuid[] := coalesce(p_patient_ids, '{}');
begin
  if not (shared.module_editable('transport') or shared.module_editable('patients')) then
    raise exception 'Making a trip needs Transport or Patients edit' using errcode = '42501';
  end if;
  if p_direction is null or p_direction not in ('from_hospital', 'to_hospital') then
    raise exception 'A trip with passengers is a pick-up to LAF House or a delivery to the hospital' using errcode = '22023';
  end if;
  if p_date is null or nullif(btrim(p_departure_time), '') is null then
    raise exception 'Give the day and the departure time' using errcode = '22023';
  end if;
  if cardinality(v_sheet) + cardinality(v_patients) = 0 then
    raise exception 'Pick who rides' using errcode = '22023';
  end if;
  if p_driver_id is not null and not exists (select 1 from shared.staff where id = p_driver_id and active) then
    raise exception 'No such driver' using errcode = 'P0002';
  end if;
  if (select count(*) from ops.house_sheet_people where id = any (v_sheet)) <> cardinality(v_sheet) then
    raise exception 'A name is no longer on the house sheet' using errcode = 'P0002';
  end if;
  if (select count(*) from ops.patients where id = any (v_patients)) <> cardinality(v_patients) then
    raise exception 'A patient is no longer on file' using errcode = 'P0002';
  end if;

  if p_vehicle_id is not null then
    select * into v_vehicle from ops.vehicles where id = p_vehicle_id and active;
    if v_vehicle.id is null then
      raise exception 'No such vehicle' using errcode = 'P0002';
    end if;
  else
    select * into v_vehicle from ops.vehicles where active order by created_at, id limit 1;
  end if;

  insert into ops.trips (date, direction, driver_staff_id, vehicle_id, vehicle, destination, departure_time, status, carries_passengers)
    values (p_date, p_direction, p_driver_id, v_vehicle.id, coalesce(v_vehicle.name, 'LAF HOPE Transport'),
            nullif(btrim(p_destination), ''), btrim(p_departure_time), 'scheduled', true)
    returning id into v_trip_id;

  insert into ops.trip_manifest (trip_id, house_sheet_person_id, patient_id, name, carer_name)
    select v_trip_id, h.id,
           case when h.match_status in ('auto_matched', 'confirmed') then h.matched_patient_id
                else (select r.admitted_patient_id from ops.referrals r where r.id = h.referral_id) end,
           h.patient_name, h.carer_name
    from ops.house_sheet_people h
    where h.id = any (v_sheet);

  -- Patients on file (e.g. families going to a check-up): name as the record has it, current carer.
  insert into ops.trip_manifest (trip_id, patient_id, name, carer_name)
    select v_trip_id, p.id, btrim(concat_ws(', ', p.last_name, p.first_name)),
           (select c.name from ops.carers c where c.patient_id = p.id and (c.effective_to is null or c.effective_to >= p_date)
             order by c.effective_from desc limit 1)
    from ops.patients p
    where p.id = any (v_patients)
      and not exists (select 1 from ops.trip_manifest m where m.trip_id = v_trip_id and m.patient_id = p.id);

  return v_trip_id;
end;
$$;
revoke execute on function ops.create_trip(date, text, uuid, text, text, uuid, uuid[], uuid[]) from public;
grant execute on function ops.create_trip(date, text, uuid, text, text, uuid, uuid[], uuid[]) to authenticated, service_role;

-- The pick-up made from NCH's sheet, as before, now on the van itself.
create or replace function ops.create_pickup(p_date date, p_departure_time text, p_driver_id uuid, p_sheet_row_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
begin
  if not shared.module_editable('transport') then
    raise exception 'Your access to LAF HOPE Transport is view only' using errcode = '42501';
  end if;
  if p_sheet_row_ids is null or cardinality(p_sheet_row_ids) = 0 then
    raise exception 'Pick who to pick up' using errcode = '22023';
  end if;
  return ops.create_trip(p_date, p_departure_time, p_driver_id, 'from_hospital', null, null, p_sheet_row_ids, '{}');
end;
$$;

-- ---- 3. the manifest ----
alter table ops.trip_manifest
  add column if not exists note text check (note is null or char_length(note) <= 200),
  add column if not exists added_by uuid references shared.staff (id);
create unique index if not exists trip_manifest_patient_once on ops.trip_manifest (trip_id, patient_id) where patient_id is not null;

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
  -- After arrival only check-in may still fill in a passenger's patient (record_arrival, 0053).
  if v_status = 'completed' and (tg_op = 'INSERT'
       or (new.boarded_at, new.name, new.carer_name, new.note) is distinct from (old.boarded_at, old.name, old.carer_name, old.note)
       or (old.patient_id is not null and new.patient_id is distinct from old.patient_id)) then
    raise exception 'The trip has arrived; its manifest is closed' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.added_by := auth.uid();
  elsif current_user = 'authenticated'
     and (new.trip_id, new.house_sheet_person_id, new.created_at, new.added_by)
         is distinct from (old.trip_id, old.house_sheet_person_id, old.created_at, old.added_by) then
    raise exception 'A manifest row stays on its trip' using errcode = '42501';
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

-- The driver (Transport) and the social worker or Office Admin (Patients) build and correct it.
drop policy if exists "transport editors add" on ops.trip_manifest;
drop policy if exists "transport editors board" on ops.trip_manifest;
drop policy if exists "transport editors remove" on ops.trip_manifest;
drop policy if exists "transport or patients editors add" on ops.trip_manifest;
drop policy if exists "transport or patients editors change" on ops.trip_manifest;
drop policy if exists "transport or patients editors remove" on ops.trip_manifest;
create policy "transport or patients editors add" on ops.trip_manifest for insert to authenticated
  with check ((select shared.module_editable('transport')) or (select shared.module_editable('patients')));
create policy "transport or patients editors change" on ops.trip_manifest for update to authenticated
  using ((select shared.module_editable('transport')) or (select shared.module_editable('patients')))
  with check ((select shared.module_editable('transport')) or (select shared.module_editable('patients')));
create policy "transport or patients editors remove" on ops.trip_manifest for delete to authenticated
  using ((select shared.module_editable('transport')) or (select shared.module_editable('patients')));
grant update (boarded_at, name, carer_name, patient_id, note) on ops.trip_manifest to authenticated;

notify pgrst, 'reload schema';
