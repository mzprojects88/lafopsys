-- Undo 0078: odometer photos and the usual km per route. The guard goes back to 0076's;
-- photo objects stay in B2.
drop view if exists ops.v_route_km;
drop function if exists ops.route_key(text, text);
alter table ops.trips drop column if exists end_photo_id, drop column if exists start_photo_id;

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

alter publication supabase_realtime drop table ops.odometer_photos;
drop table if exists ops.odometer_photos;
notify pgrst, 'reload schema';
