-- Reverses 0047: bed geometry, locks and the create/retire RPCs go; units
-- return to the 5/4/4 room split 0004 seeded and to the stored-'occupied'
-- status check.
--
-- DESTRUCTIVE: bed placements, lock reasons and retirements are lost. A bed
-- added after 0047 (code beyond B13) keeps its row (the backfill below gives
-- it Room 3 so NOT NULL can come back) but loses its position. Export first:
--
--   select id, code, room_id, x, y, w, h, rotation_deg, capacity, active, retired_at,
--          status, lock_reason, status_changed_at, status_changed_by
--   from ops.units order by code;
--   select id, bounds, sort_order from ops.rooms;

drop trigger if exists guard_unit_columns on ops.units;
drop function if exists ops.guard_unit_columns();
drop trigger if exists guard_room_columns on ops.rooms;
drop function if exists ops.guard_room_columns();
drop function if exists ops.create_bed(text, text, numeric, numeric, integer);
drop function if exists ops.retire_bed(text);

-- room_id was not null before 0047: restore the seeded mapping before re-adding it.
update ops.units set room_id = coalesce(room_id, case
  when code in ('B1', 'B2', 'B3', 'B4', 'B5') then 'room-1'
  when code in ('B6', 'B7', 'B8', 'B9') then 'room-2'
  else 'room-3' end);

alter table ops.units
  drop constraint if exists units_x_range,
  drop constraint if exists units_y_range,
  drop constraint if exists units_xy_together,
  drop constraint if exists units_size_range,
  drop constraint if exists units_rotation_range,
  drop constraint if exists units_capacity_range,
  drop constraint if exists units_lock_has_reason;

alter table ops.units
  drop column x, drop column y, drop column w, drop column h,
  drop column rotation_deg, drop column capacity, drop column active,
  drop column retired_at, drop column lock_reason,
  drop column status_changed_at, drop column status_changed_by;

alter table ops.units alter column room_id set not null;

alter table ops.units drop constraint units_status_check;
alter table ops.units add constraint units_status_check
  check (status in ('available', 'occupied', 'maintenance', 'blocked'));

alter table ops.rooms drop constraint if exists rooms_bounds_is_polygon;
alter table ops.rooms drop column bounds, drop column sort_order;

-- back to 0003's table-wide privileges
grant insert, update, delete on ops.units to authenticated;
grant insert, update, delete on ops.bed_positions to authenticated;
grant insert, update, delete on ops.rooms to authenticated;

notify pgrst, 'reload schema';
