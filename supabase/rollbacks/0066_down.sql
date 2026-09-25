-- Undo 0066. Replaced holds become released.
drop function if exists ops.replace_bed_reservation(uuid, uuid, uuid, text, text);
update ops.bed_reservations set status = 'released' where status = 'replaced';
alter table ops.bed_reservations drop constraint if exists bed_reservations_replaced_names_successor;
alter table ops.bed_reservations drop column if exists replaced_by;
alter table ops.bed_reservations drop constraint bed_reservations_status_check;
alter table ops.bed_reservations add constraint bed_reservations_status_check check (status in ('active', 'used', 'released'));
notify pgrst, 'reload schema';
