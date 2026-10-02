-- Undo 0076: vehicles and the odometer guard. Trip readings already taken stay
-- in ops.trips.odometer_start / _end (columns from 0008); the vehicle link,
-- destinations and the correction log go.
drop view if exists ops.v_vehicle_odometer;
drop function if exists ops.correct_odometer(uuid, integer, integer, text);
alter publication supabase_realtime drop table ops.odometer_corrections;
drop table if exists ops.odometer_corrections;
drop trigger if exists guard_trip_odometer on ops.trips;
drop function if exists ops.guard_trip_odometer();
drop index if exists ops.trips_one_on_the_road;
drop index if exists ops.trips_vehicle_idx;
alter table ops.trips
  drop constraint if exists trips_odometer_order,
  drop constraint if exists trips_odometer_not_negative,
  drop column if exists destination,
  drop column if exists vehicle_id;
alter publication supabase_realtime drop table ops.vehicles;
drop table if exists ops.vehicles;
drop function if exists ops.guard_vehicle();
notify pgrst, 'reload schema';
