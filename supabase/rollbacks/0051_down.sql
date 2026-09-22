-- Undo 0051. ops.check_in goes back to 0049's body with 0050's gate: re-run
-- the create-or-replace from 0049, then 0050's check_in step (section 5).
drop function if exists ops.sync_sheet_appointments();
drop function if exists ops.confirm_night(uuid, text);
drop function if exists ops.admit_from_sheet(uuid, text, date, uuid, jsonb, uuid, text, text, text, date);
alter publication supabase_realtime drop table ops.bed_nights;
drop table if exists ops.bed_nights;
alter table ops.appointments drop column if exists source;
alter table ops.referrals drop column if exists source;
drop trigger if exists house_sheet_run_default on ops.house_sheet_people;
drop function if exists ops.house_sheet_run_default();
alter table ops.house_sheet_people drop column if exists run_started_on;
notify pgrst, 'reload schema';
