-- 0047: the Floor Plan becomes real. A unit IS a physical bed, drawn over the
-- architectural plan (public/floor-plan/actual-floor-plan.png, 1087 x 1447);
-- admins place, rotate, add and retire beds, and the drawn beds are what the
-- Confirm Arrival and Transfer Bed dialogs offer.
--
-- Geometry is stored NORMALISED against the plan image (0..1 on each axis,
-- so a re-exported image at another resolution changes nothing). x, y is the
-- bed's CENTRE, w, h its size, rotation_deg its rotation about that centre.
-- x/y null = not yet placed: every existing bed starts unplaced, in the
-- admin's "Unplaced" tray (the org chose to draw the layout itself rather
-- than take a guessed one). room_id becomes nullable for the same reason;
-- the app sets it on drop from whichever room polygon contains the centre.
--
-- 'occupied' leaves the stored status. It is derived from ops.stays
-- (in_house / overdue on any of the unit's positions, counted against
-- capacity), which 0004's header already named as the only honest source.
-- The stored status is the lock: available / maintenance / blocked, with a
-- reason and a signed stamp. One bed = one admission slot (capacity 1, per
-- the house: a single bed shared by the child and their carer); the A-D
-- positions stay because ops.stays points at them, and the lowest free
-- label is the one an admission takes.
--
-- Rooms get a polygon per the plan (normalised, same axes): Room 1 = the
-- plan's area "ROOM1 8" (bottom-middle, beside T&B1) -- the second area also
-- labelled ROOM1 (11, bottom-left) is deliberately NOT modelled; Room 2 =
-- area 13 (right-middle, minus the T&B2 notch); Room 3 = area 15 (top).
-- Measured off the image; admin-only to refine.
--
-- Who may change what (guard triggers -- the second line of defence behind
-- the column grants, same shape as 0025's guard_staff_privileged_columns):
--   geometry / room / capacity / code / active   -> admin
--   status / lock_reason                          -> admin, social_worker, house_staff
--   anyone else                                   -> no update at all
-- insert and delete leave `authenticated` entirely: beds are created and
-- retired only through ops.create_bed / ops.retire_bed (security definer,
-- admin-only), so a unit always comes with its four positions and never
-- disappears from under a stay.
-- Rollback: supabase/rollbacks/0047_down.sql.

-- ---------------------------------------------------------------------
-- 1. Rooms: polygon + order
-- ---------------------------------------------------------------------

alter table ops.rooms
  add column bounds jsonb,               -- [[x,y],...] normalised, >= 3 points
  add column sort_order smallint not null default 0;

alter table ops.rooms add constraint rooms_bounds_is_polygon
  check (bounds is null or (jsonb_typeof(bounds) = 'array' and jsonb_array_length(bounds) >= 3));

update ops.rooms set sort_order = 1,
  bounds = '[[0.340,0.750],[0.906,0.750],[0.906,0.840],[0.685,0.840],[0.685,0.940],[0.340,0.940]]'
  where id = 'room-1';
update ops.rooms set sort_order = 2,
  bounds = '[[0.529,0.477],[0.906,0.477],[0.906,0.674],[0.681,0.674],[0.681,0.743],[0.529,0.743]]'
  where id = 'room-2';
update ops.rooms set sort_order = 3,
  bounds = '[[0.184,0.300],[0.704,0.300],[0.704,0.470],[0.184,0.470]]'
  where id = 'room-3';

-- ---------------------------------------------------------------------
-- 2. Units: geometry, capacity, lifecycle, lock audit
-- ---------------------------------------------------------------------

alter table ops.units
  alter column room_id drop not null,
  add column x numeric(6, 5),
  add column y numeric(6, 5),
  add column w numeric(6, 5) not null default 0.08,
  add column h numeric(6, 5) not null default 0.12,
  add column rotation_deg smallint not null default 0,
  add column capacity smallint not null default 1,
  add column active boolean not null default true,
  add column retired_at timestamptz,
  add column lock_reason text,
  add column status_changed_at timestamptz,
  add column status_changed_by uuid references shared.staff (id);

alter table ops.units
  add constraint units_x_range check (x is null or (x >= 0 and x <= 1)),
  add constraint units_y_range check (y is null or (y >= 0 and y <= 1)),
  add constraint units_xy_together check ((x is null) = (y is null)),
  add constraint units_size_range check (w > 0 and w <= 1 and h > 0 and h <= 1),
  add constraint units_rotation_range check (rotation_deg >= 0 and rotation_deg < 360),
  add constraint units_capacity_range check (capacity between 1 and 4),
  add constraint units_lock_has_reason
    check (status = 'available' or nullif(btrim(lock_reason), '') is not null);

-- Nothing is placed yet; every bed starts in the tray, its room decided on drop.
update ops.units set room_id = null;

-- 'occupied' is no longer storable (production only ever held 'available';
-- the update is defensive).
update ops.units set status = 'available' where status = 'occupied';
alter table ops.units drop constraint units_status_check;
alter table ops.units add constraint units_status_check
  check (status in ('available', 'maintenance', 'blocked'));

-- ---------------------------------------------------------------------
-- 3. Grants: the browser may only PATCH, and only these columns
-- ---------------------------------------------------------------------

revoke insert, update, delete on ops.units from authenticated;
grant update (code, room_id, x, y, w, h, rotation_deg, capacity, active, retired_at,
              shared_unit, status, lock_reason)
  on ops.units to authenticated;

revoke insert, update, delete on ops.bed_positions from authenticated;

revoke insert, update, delete on ops.rooms from authenticated;
grant update (name, bounds, sort_order) on ops.rooms to authenticated;

-- ---------------------------------------------------------------------
-- 4. Guard triggers
-- ---------------------------------------------------------------------

-- Deliberately security INVOKER (0025's reasoning): it must see the
-- PostgREST role in current_user ('authenticated') and let service_role,
-- postgres and the definer RPCs below through untouched -- but the
-- invariants in (a) hold for everyone.
create or replace function ops.guard_unit_columns()
returns trigger
language plpgsql
as $$
declare
  r text := coalesce(shared.current_staff_role(), '');
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
  -- (a) invariants for every writer, ops.retire_bed included
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

  -- (b) service role / postgres / the definer RPCs pass untouched
  if current_user <> 'authenticated' then
    return new;
  end if;

  -- (c) role gating for PostgREST sessions
  if r not in ('admin', 'social_worker', 'house_staff') then
    raise exception 'This role cannot change beds' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
     or new.status_changed_at is distinct from old.status_changed_at
     or new.status_changed_by is distinct from old.status_changed_by then
    raise exception 'Bed identity and the lock stamp are set by the database' using errcode = '42501';
  end if;
  if geometry_changed and r <> 'admin' then
    raise exception 'Only admins can change the floor plan' using errcode = '42501';
  end if;
  if lock_changed then
    new.status_changed_at := now();
    new.status_changed_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger guard_unit_columns
  before update on ops.units
  for each row execute function ops.guard_unit_columns();

create or replace function ops.guard_room_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' and coalesce(shared.current_staff_role(), '') <> 'admin' then
    raise exception 'Only admins can change rooms' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_room_columns
  before update on ops.rooms
  for each row execute function ops.guard_room_columns();

-- ---------------------------------------------------------------------
-- 5. Create / retire: the only way a bed row appears or goes away
-- ---------------------------------------------------------------------

-- Inserts the unit and its four positions atomically. A code that belongs to
-- a RETIRED bed is brought back in place (its stay history stays attached);
-- a code that belongs to a live bed is an error.
create or replace function ops.create_bed(
  p_code text,
  p_room_id text,
  p_x numeric,
  p_y numeric,
  p_rotation_deg integer default 0
)
returns text
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_id text;
  v_existing ops.units%rowtype;
begin
  if coalesce(shared.current_staff_role(), '') <> 'admin' then
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

-- Keeps the row (stays reference its positions) but takes it off the plan
-- and out of every admission list. Refuses while anyone is checked in.
create or replace function ops.retire_bed(p_unit_id text)
returns void
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
begin
  if coalesce(shared.current_staff_role(), '') <> 'admin' then
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

revoke execute on function ops.create_bed(text, text, numeric, numeric, integer) from public;
grant execute on function ops.create_bed(text, text, numeric, numeric, integer) to authenticated, service_role;
revoke execute on function ops.retire_bed(text) from public;
grant execute on function ops.retire_bed(text) to authenticated, service_role;

-- rooms / units / bed_positions are already in supabase_realtime (0027).
notify pgrst, 'reload schema';
