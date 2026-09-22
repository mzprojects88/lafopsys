-- Undo 0052. Delete any 'ride' receipts first (their objects too), or the
-- restored check constraints refuse the table.
alter table shared.files drop constraint files_check;
alter table shared.files add constraint files_check
  check (
    (record_type, module) in (
      ('employee', 'hr'), ('compliance_item', 'compliance'), ('patient', 'patients'),
      ('donor', 'donors'), ('bank_statement_import', 'finance'), ('general', 'reports')
    )
  );
alter table shared.files drop constraint files_record_type_check;
alter table shared.files add constraint files_record_type_check
  check (record_type in ('employee', 'compliance_item', 'patient', 'donor', 'bank_statement_import', 'general'));

drop function if exists ops.record_arrival(uuid, text, text, uuid, numeric);
drop view if exists ops.v_arrival_rides;
alter table ops.stays
  drop constraint if exists stays_trip_is_laf_hope,
  drop constraint if exists stays_ride_is_ride_app,
  drop column if exists arrival_trip_id,
  drop column if exists arrival_ride_id,
  drop column if exists arrival_mode;
alter publication supabase_realtime drop table ops.arrival_rides;
drop table if exists ops.arrival_rides;
drop function if exists ops.guard_arrival_ride();
notify pgrst, 'reload schema';
