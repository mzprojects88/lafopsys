-- Undo 0089 (daily admission reset). Stays already closed with check_out_reason 'daily_reset'
-- stay closed; reopen them by hand if the reset is withdrawn mid-day.
select cron.unschedule(jobid) from cron.job where jobname = 'admission-reset';
drop function if exists ops.readmit_for_tonight(uuid, text, text);
drop function if exists ops.daily_admission_reset();
drop table if exists ops.admission_resets;
drop index if exists ops.stays_one_active_per_patient;
drop trigger if exists stay_visit_default on ops.stays;
drop function if exists ops.stay_visit_default();
drop index if exists ops.stays_visit_id;
alter table ops.stays drop column if exists visit_id;
alter table shared.app_settings drop column if exists admission_reset_at, drop column if exists admission_finalize_by;
notify pgrst, 'reload schema';
