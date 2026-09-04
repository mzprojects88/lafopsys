-- Reverses 0028: drops the persisted totals. The punch history in
-- ops.time_punches is untouched, so the columns can be rebuilt by re-running
-- the 0028 backfill. The app must be rolled back alongside (the route writes
-- these columns on every punch).
alter table ops.time_entries
  drop column if exists total_minutes,
  drop column if exists session_count;
