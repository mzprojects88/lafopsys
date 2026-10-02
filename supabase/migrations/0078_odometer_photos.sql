-- 0078: Fuel Monitoring, phase C -- odometer photos and the usual km per route (2026-10-03).
--
--   * ops.odometer_photos: a photo of a vehicle's odometer, with what the AI
--     read from it. The server (app/api/transport/odometer-photo) files it:
--     it checks the caller may edit Transport, stores the JPEG in B2, asks
--     the model, then writes the row with the service role -- so no one can
--     write an AI reading, or point a row at someone else's file, by hand.
--   * A tracked vehicle's first departure of the day needs a photo of the
--     odometer that day (decided by the user, 2026-10-02): the AI reads it,
--     the driver confirms. The trip keeps which photo backed each reading
--     (start_photo_id / end_photo_id); Fuel Monitoring flags a confirmed
--     reading that differs from what the AI read (phase D).
--   * ops.route_key + ops.v_route_km: the usual km of a route, learned from
--     the last 20 arrived trips on it (the median). The Arrive drums start
--     there and an unusual reading is questioned.
-- Rollback: supabase/rollbacks/0078_down.sql.

-- ---------------------------------------------------------------------
-- 1. Photos
-- ---------------------------------------------------------------------

create table ops.odometer_photos (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references ops.vehicles (id),
  stage text not null check (stage in ('depart', 'arrive', 'pump', 'other')),
  taken_by uuid not null references shared.staff (id),
  taken_at timestamptz not null default now(),
  taken_on date not null default ((now() at time zone 'Asia/Manila')::date),
  object_key text not null unique check (object_key like 'Transport/%'),
  bytes integer not null check (bytes > 0),
  ai_reading integer check (ai_reading >= 0),
  ai_confidence numeric(3, 2) check (ai_confidence between 0 and 1),
  ai_note text
);
create index odometer_photos_vehicle_day_idx on ops.odometer_photos (vehicle_id, taken_on);

alter table ops.odometer_photos enable row level security;
create policy "module read" on ops.odometer_photos for select to authenticated
  using ((select shared.module_viewable('transport', 'house_ops', 'finance')));
-- Written only by the server route (service role); read by Transport, House Ops and Finance.
revoke all on ops.odometer_photos from anon, authenticated;
grant select on ops.odometer_photos to authenticated;
alter publication supabase_realtime add table ops.odometer_photos;

alter table ops.trips
  add column start_photo_id uuid references ops.odometer_photos (id),
  add column end_photo_id uuid references ops.odometer_photos (id);

-- ---------------------------------------------------------------------
-- 2. The guard learns the daily photo
-- ---------------------------------------------------------------------

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

  -- A vehicle is on one trip at a time (also the unique index; this says it in words).
  if new.status = 'in_progress' and v.id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'in_progress' or new.vehicle_id is distinct from old.vehicle_id)
     and exists (select 1 from ops.trips o where o.vehicle_id = v.id and o.status = 'in_progress' and o.id <> new.id) then
    raise exception '% is still on another trip; mark that one arrived first', v.name using errcode = '23505';
  end if;

  -- "Not left yet": the reading goes back with the departure.
  if tg_op = 'UPDATE' and new.status = 'scheduled' and old.status <> 'scheduled' then
    new.odometer_start := null;
    new.odometer_end := null;
    new.start_photo_id := null;
    new.end_photo_id := null;
  end if;

  -- A photo backs a reading of this vehicle, not another.
  if (new.start_photo_id is not null and not exists (select 1 from ops.odometer_photos p where p.id = new.start_photo_id and p.vehicle_id = new.vehicle_id))
     or (new.end_photo_id is not null and not exists (select 1 from ops.odometer_photos p where p.id = new.end_photo_id and p.vehicle_id = new.vehicle_id)) then
    raise exception 'That odometer photo is of another vehicle' using errcode = '22023';
  end if;

  if v.id is null or v.start_odometer is null then
    return new; -- this vehicle isn't tracked yet
  end if;

  if tg_op = 'UPDATE' and old.status = 'completed' and not v_correcting
     and (new.status is distinct from old.status
          or new.odometer_start is distinct from old.odometer_start
          or new.odometer_end is distinct from old.odometer_end
          or new.vehicle_id is distinct from old.vehicle_id
          or new.start_photo_id is distinct from old.start_photo_id
          or new.end_photo_id is distinct from old.end_photo_id) then
    raise exception 'This trip has arrived; only the Super Admin can correct its odometer' using errcode = '42501';
  end if;
  if new.status in ('in_progress', 'completed') and new.odometer_start is null then
    raise exception 'Enter the odometer reading before leaving' using errcode = '22023';
  end if;
  -- The day's first departure is backed by a photo of the odometer (0078).
  if new.status = 'in_progress' and not v_correcting
     and (tg_op = 'INSERT' or old.status is distinct from 'in_progress')
     and not exists (select 1 from ops.odometer_photos p
                     where p.vehicle_id = v.id and p.taken_on = (now() at time zone 'Asia/Manila')::date) then
    raise exception 'Take a photo of the odometer: the first departure of the day needs one' using errcode = '22023';
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

-- ---------------------------------------------------------------------
-- 3. The usual km of a route
-- ---------------------------------------------------------------------

-- Mirrored by routeKey() in lib/utils/odometer.ts: an NCH pick-up, or the
-- purpose plus the destination as typed, in lower case with spaces tidied.
create or replace function ops.route_key(p_direction text, p_destination text)
returns text
language sql
immutable
as $$
  select case
    when p_direction = 'from_hospital' and nullif(btrim(p_destination), '') is null then 'pickup'
    else p_direction || ':' || lower(regexp_replace(btrim(coalesce(p_destination, '')), '\s+', ' ', 'g'))
  end;
$$;
grant execute on function ops.route_key(text, text) to authenticated;

create or replace view ops.v_route_km
with (security_invoker = true) as
with done as (
  select ops.route_key(t.direction, t.destination) as route_key,
         t.odometer_end - t.odometer_start as km,
         row_number() over (partition by ops.route_key(t.direction, t.destination) order by t.arrived_at desc nulls last) as n
  from ops.trips t
  where t.status = 'completed' and t.odometer_start is not null and t.odometer_end is not null
)
select route_key,
       count(*)::integer as trips,
       percentile_cont(0.5) within group (order by km) as median_km
from done
where n <= 20
group by route_key;
grant select on ops.v_route_km to authenticated;

notify pgrst, 'reload schema';
