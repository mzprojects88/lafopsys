-- Reverses 0030 by putting gps_stamped back as the all-false column it always
-- was. Nothing wrote to it before and nothing will after; the location record
-- lives on ops.time_punches.location_status either way, so this restores the
-- shape of the table without restoring any information.

alter table ops.time_entries add column gps_stamped boolean not null default false;
