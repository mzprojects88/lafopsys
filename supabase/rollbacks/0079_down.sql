-- Undo 0079: service intervals, the efficiency alert and the driver's gauge readings.
alter publication supabase_realtime drop table ops.fuel_level_checks;
drop table if exists ops.fuel_level_checks;
drop function if exists ops.stamp_fuel_level_check();
alter publication supabase_realtime drop table ops.vehicle_service_rules;
drop table if exists ops.vehicle_service_rules;
alter table ops.vehicles drop column if exists efficiency_alert_pct;
notify pgrst, 'reload schema';
