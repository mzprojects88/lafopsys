-- 0076: Fuel Monitoring, phase A -- vehicles and the odometer on every trip (2026-10-02).
--
--   * ops.vehicles: LAF's vehicles (LAF HOPE Transport to start). The Super
--     Admin keeps the list in Settings: plate, fuel, tank, fuel-door side, a
--     starting km/L until one is measured, and the STARTING ODOMETER.
--   * Tracking starts per vehicle when the Super Admin types its starting
--     odometer. Until then trips behave exactly as before, so this migration
--     changes nothing on the road by itself.
--   * Once a vehicle is tracked: Depart needs the odometer, Arrive needs it
--     too; a reading may not go back below the vehicle's last one; one trip
--     per vehicle on the road at a time; an arrived trip's reading is frozen,
--     and only the Super Admin corrects it (ops.correct_odometer, with a
--     reason, logged in ops.odometer_corrections, which nobody can edit).
--   * ops.trips gains vehicle_id (the old text column stays, kept in step, so
--     every existing reader still works) and destination (errands).
--   * "Not left yet" clears the departure reading with the departure time.
-- Rollback: supabase/rollbacks/0076_down.sql.

-- ---------------------------------------------------------------------
-- 1. Vehicles
-- ---------------------------------------------------------------------

create table ops.vehicles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  plate_no text,
  fuel_type text not null default 'diesel' check (fuel_type in ('diesel', 'gasoline')),
  tank_litres numeric(6, 1) check (tank_litres > 0),
  fuel_door_side text check (fuel_door_side in ('left', 'right')),
  -- until LAF has measured one from two full-tank fills (phase D)
  default_km_per_litre numeric(5, 2) check (default_km_per_litre > 0),
  -- null = not tracked yet; the reading the record starts from
  start_odometer integer check (start_odometer >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on ops.vehicles
  for each row execute function shared.set_updated_at();

insert into ops.vehicles (name) values ('LAF HOPE Transport');

-- The starting reading is what every later reading is checked against; once
-- trips have readings it would move the ground under them.
create or replace function ops.guard_vehicle()
returns trigger
language plpgsql
as $$
begin
  if new.start_odometer is distinct from old.start_odometer
     and exists (select 1 from ops.trips t where t.vehicle_id = old.id and t.odometer_start is not null) then
    raise exception 'Trips already have odometer readings for %; correct those trips instead', old.name using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger guard_vehicle before update on ops.vehicles
  for each row execute function ops.guard_vehicle();

alter table ops.vehicles enable row level security;
create policy "module read" on ops.vehicles for select to authenticated
  using ((select shared.module_viewable('transport', 'house_ops', 'finance')));
create policy "super admin adds" on ops.vehicles for insert to authenticated
  with check ((select shared.has_role('admin')));
create policy "super admin changes" on ops.vehicles for update to authenticated
  using ((select shared.has_role('admin'))) with check ((select shared.has_role('admin')));
revoke all on ops.vehicles from anon, authenticated;
grant select, insert, update on ops.vehicles to authenticated;
alter publication supabase_realtime add table ops.vehicles;

-- ---------------------------------------------------------------------
-- 2. Trips know their vehicle and where they go
-- ---------------------------------------------------------------------

alter table ops.trips
  add column vehicle_id uuid references ops.vehicles (id),
  add column destination text,
  add constraint trips_odometer_not_negative check (coalesce(odometer_start, 0) >= 0 and coalesce(odometer_end, 0) >= 0),
  add constraint trips_odometer_order check (odometer_end is null or odometer_start is null or odometer_end >= odometer_start);
update ops.trips t set vehicle_id = v.id from ops.vehicles v where v.name = t.vehicle;
create index trips_vehicle_idx on ops.trips (vehicle_id);
-- A vehicle is on one trip at a time: that is what keeps its readings in order.
create unique index trips_one_on_the_road on ops.trips (vehicle_id) where status = 'in_progress';

-- ---------------------------------------------------------------------
-- 3. The odometer guard
-- ---------------------------------------------------------------------

-- ops.correct_odometer sets ops.odometer_correction for its own transaction
-- and runs as the function owner; a signed-in session setting the flag itself
-- is still `authenticated`, so the flag alone opens nothing.
create or replace function ops.guard_trip_odometer()
returns trigger
language plpgsql
as $$
declare
  v ops.vehicles%rowtype;
  v_last integer;
  v_correcting boolean := coalesce(current_setting('ops.odometer_correction', true), '') = 'on'
                          and current_user not in ('authenticated', 'anon');
begin
  if tg_op = 'DELETE' then
    if old.odometer_start is not null then
      raise exception 'A trip with odometer readings can''t be deleted' using errcode = '42501';
    end if;
    return old;
  end if;

  -- The vehicle: create_pickup and older screens still write the name.
  if new.vehicle_id is null then
    select id into new.vehicle_id from ops.vehicles where name = new.vehicle;
  end if;
  if new.vehicle_id is not null then
    select * into v from ops.vehicles where id = new.vehicle_id;
    new.vehicle := v.name;
  end if;

  -- "Not left yet": the reading goes back with the departure.
  if tg_op = 'UPDATE' and new.status = 'scheduled' and old.status <> 'scheduled' then
    new.odometer_start := null;
    new.odometer_end := null;
  end if;

  if v.id is null or v.start_odometer is null then
    return new; -- this vehicle isn't tracked yet
  end if;

  if tg_op = 'UPDATE' and old.status = 'completed' and not v_correcting
     and (new.status is distinct from old.status
          or new.odometer_start is distinct from old.odometer_start
          or new.odometer_end is distinct from old.odometer_end
          or new.vehicle_id is distinct from old.vehicle_id) then
    raise exception 'This trip has arrived; only the Super Admin can correct its odometer' using errcode = '42501';
  end if;
  if new.status in ('in_progress', 'completed') and new.odometer_start is null then
    raise exception 'Enter the odometer reading before leaving' using errcode = '22023';
  end if;
  if new.status = 'completed' and new.odometer_end is null then
    raise exception 'Enter the odometer reading on arrival' using errcode = '22023';
  end if;
  if new.odometer_end < new.odometer_start then
    raise exception 'The arrival reading (% km) is lower than the departure reading (% km)', new.odometer_end, new.odometer_start using errcode = '22023';
  end if;
  if not v_correcting and new.odometer_start is not null
     and (tg_op = 'INSERT' or new.odometer_start is distinct from old.odometer_start or new.vehicle_id is distinct from old.vehicle_id) then
    select greatest(v.start_odometer, max(greatest(t.odometer_start, t.odometer_end)))
      into v_last
      from ops.trips t
      where t.vehicle_id = v.id and t.id <> new.id;
    if new.odometer_start < v_last then
      raise exception 'The odometer can''t go back: % last read % km', v.name, v_last using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_trip_odometer before insert or update or delete on ops.trips
  for each row execute function ops.guard_trip_odometer();

-- ---------------------------------------------------------------------
-- 4. Corrections: the Super Admin only, with a reason, on the record
-- ---------------------------------------------------------------------

create table ops.odometer_corrections (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references ops.trips (id),
  old_start integer,
  old_end integer,
  new_start integer,
  new_end integer,
  reason text not null check (length(btrim(reason)) >= 5),
  corrected_by uuid references shared.staff (id),
  corrected_at timestamptz not null default now()
);
create index odometer_corrections_trip_idx on ops.odometer_corrections (trip_id);
alter table ops.odometer_corrections enable row level security;
create policy "module read" on ops.odometer_corrections for select to authenticated
  using ((select shared.module_viewable('transport', 'house_ops', 'finance')));
revoke all on ops.odometer_corrections from anon, authenticated;
grant select on ops.odometer_corrections to authenticated;
alter publication supabase_realtime add table ops.odometer_corrections;

create or replace function ops.correct_odometer(p_trip_id uuid, p_start integer, p_end integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  t ops.trips%rowtype;
begin
  if not shared.has_role('admin') then
    raise exception 'Only the Super Admin can correct an odometer reading' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Say why the reading is being corrected' using errcode = '22023';
  end if;
  select * into t from ops.trips where id = p_trip_id for update;
  if not found then
    raise exception 'No such trip' using errcode = 'P0002';
  end if;
  if p_start is null or p_start < 0 or (p_end is not null and p_end < p_start) then
    raise exception 'The arrival reading can''t be lower than the departure reading' using errcode = '22023';
  end if;

  insert into ops.odometer_corrections (trip_id, old_start, old_end, new_start, new_end, reason, corrected_by)
    values (t.id, t.odometer_start, t.odometer_end, p_start, p_end, btrim(p_reason), auth.uid());
  perform set_config('ops.odometer_correction', 'on', true);
  update ops.trips set odometer_start = p_start, odometer_end = p_end where id = t.id;
  perform set_config('ops.odometer_correction', 'off', true);
end;
$$;
revoke all on function ops.correct_odometer(uuid, integer, integer, text) from public, anon;
grant execute on function ops.correct_odometer(uuid, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Each vehicle's last reading, for the drums to start from
-- ---------------------------------------------------------------------

create or replace view ops.v_vehicle_odometer
with (security_invoker = true) as
select v.id as vehicle_id,
       greatest(v.start_odometer, max(greatest(t.odometer_start, t.odometer_end))) as last_reading
from ops.vehicles v
left join ops.trips t on t.vehicle_id = v.id
group by v.id, v.start_odometer;
grant select on ops.v_vehicle_odometer to authenticated;

notify pgrst, 'reload schema';
