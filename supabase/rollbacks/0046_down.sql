-- Reverses 0046: stops the half-hourly check of the Occupancy Tracker and
-- drops the people and run tables and the switch.
--
-- DESTRUCTIVE: every match decision social workers have made on the house
-- sheet is lost, together with the run history. Export first:
--
--   select * from ops.house_sheet_people order by last_seen_on desc;
--   select * from ops.house_sheet_sync_runs order by started_at;
--
-- The pg_cron and pg_net extensions and the Vault secret are left alone;
-- the calendar sync still uses them.

select cron.unschedule('house-sheet-sync');

alter table shared.app_settings drop column house_sheet_sync_enabled;

alter publication supabase_realtime drop table ops.house_sheet_sync_runs;
drop table ops.house_sheet_sync_runs;

alter publication supabase_realtime drop table ops.house_sheet_people;
drop trigger if exists house_sheet_review_guard on ops.house_sheet_people;
drop function if exists ops.house_sheet_review_guard();
drop table ops.house_sheet_people;
