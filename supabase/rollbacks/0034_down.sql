-- Reverses 0034: stops the scheduled sync, drops the run log, restores the
-- original uniqueness on calendar_events, and drops the sync columns.
--
-- DESTRUCTIVE in two ways. Every sheet-sourced event that the sync has hidden
-- (sheet_removed_at set) becomes visible again -- there is nowhere left to
-- record that it was hidden. And the run history is gone. Export first:
--
--   select * from ops.calendar_sync_runs order by started_at;
--   select id, date, title, sheet_removed_at from ops.calendar_events where sheet_removed_at is not null;
--
-- Restoring the original (date, title, time) constraint can FAIL if the sync
-- has left two sheet rows with the same date, title and time text (a hidden
-- row and its replacement). Resolve those by hand before running this.
--
-- The pg_cron and pg_net extensions are left installed; they are harmless
-- idle and something else may come to rely on them. The Vault secret is
-- left in place for the same reason.

select cron.unschedule('calendar-sheet-sync');

alter publication supabase_realtime drop table ops.calendar_sync_runs;
drop table ops.calendar_sync_runs;

alter table shared.app_settings drop column calendar_sheet_sync_enabled;

drop index ops.calendar_events_source_removed_idx;
drop index ops.calendar_events_sheet_key_idx;
drop index ops.calendar_events_natural_key_untimed;
drop index ops.calendar_events_natural_key;

alter table ops.calendar_events
  add constraint calendar_events_natural_key unique (date, title, time);
create unique index calendar_events_natural_key_untimed
  on ops.calendar_events (date, title) where time is null;

alter table ops.calendar_events
  drop column sheet_removed_at,
  drop column sheet_synced_at,
  drop column time_key,
  drop column sheet_key,
  drop column source;
