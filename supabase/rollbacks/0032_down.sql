-- Reverses 0032. DESTRUCTIVE: drops the calendar and every event in it.
-- The cleaned import file is reproducible from the workbook, but anything
-- added or edited in the app since is not. Export first:
--
--   select * from ops.calendar_events order by date, time;

alter publication supabase_realtime drop table ops.calendar_events;
drop table ops.calendar_events;
