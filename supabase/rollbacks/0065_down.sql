-- Undo 0065. Reservations and group talks are lost; stays are untouched.
alter publication supabase_realtime drop table ops.group_orientations;
alter publication supabase_realtime drop table ops.bed_reservations;
drop table if exists ops.group_orientations;
drop table if exists ops.bed_reservations;
notify pgrst, 'reload schema';
