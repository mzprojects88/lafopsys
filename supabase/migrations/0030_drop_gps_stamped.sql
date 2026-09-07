-- Removes the last of ops.time_entries' columns that nothing ever wrote.
--
-- gps_stamped is a boolean from 0013 meaning "this day's punches had a
-- location". 0017 replaced it with ops.time_punches.location_status, which
-- records WHY a location is missing -- permission refused, no fix available,
-- coordinates captured but not resolvable to an address -- instead of only
-- that it is. That header said the column was being left in place because
-- lib/types/staff.ts and the timesheets hook still mapped it, and that nothing
-- new should write to it. Nothing ever did: all 7 production rows are false,
-- and no screen has ever read the mapped value.
--
-- So it goes the same way break_minutes and overtime_minutes went in 0029,
-- and for the same reason -- a column that is always the same value is not
-- data, it is something that looks like data. What it was meant to convey is
-- already on /staff/dtr, per punch and with the reason attached.

alter table ops.time_entries drop column gps_stamped;
