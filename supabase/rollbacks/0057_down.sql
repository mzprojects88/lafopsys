-- Undo 0057. check_in goes back to inventing CNs only if 0051's check_in body
-- is re-applied (create-or-replace from 0051, then 0050's gate step): do that
-- before letting anyone admit a new child. Patients created while 0057 was in
-- place have no CN; give them one before restoring the not-null.
select cron.unschedule('master-sheet-sync');
alter table shared.app_settings drop column if exists master_sheet_sync_enabled;
alter publication supabase_realtime drop table ops.master_sheet_sync_runs;
drop table if exists ops.master_sheet_sync_runs;
drop trigger if exists guard_case_number on ops.patients;
drop function if exists ops.guard_case_number();
drop trigger if exists fill_case_number on ops.patients;
drop function if exists ops.fill_case_number();
drop function if exists ops.next_case_number(integer);
alter table ops.patients
  drop column if exists sheet_synced_at, drop column if exists intake_links, drop column if exists housing_type,
  drop column if exists parent_employment, drop column if exists household_income, drop column if exists parent_occupation,
  drop column if exists parent_education, drop column if exists attending_physician, drop column if exists mss_name,
  drop column if exists consent_authorized_at, drop column if exists distance_km, drop column if exists priority,
  drop column if exists illness_code, drop column if exists legacy_code, drop column if exists case_number;
-- alter table ops.patients alter column patient_number set not null;  -- only once every row has a CN
notify pgrst, 'reload schema';
