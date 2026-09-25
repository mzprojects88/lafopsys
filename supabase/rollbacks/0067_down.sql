-- Undo 0067: back to 0066 behaviour (own-write DTR policies from 0029/0041/0060 restored).
drop trigger if exists close_holds_on_sheet_link on ops.house_sheet_people;
drop trigger if exists close_holds_on_stay on ops.stays;
drop trigger if exists guard_bed_reservation on ops.bed_reservations;
drop function if exists ops.close_holds_on_sheet_link();
drop function if exists ops.close_holds_on_stay();
drop function if exists ops.close_holds_for_stay(uuid, uuid, text, uuid);
drop function if exists ops.guard_bed_reservation();
drop policy "patients editors close reservations" on ops.bed_reservations;
create policy "patients editors close reservations" on ops.bed_reservations
  for update to authenticated using (shared.module_editable('patients')) with check (shared.module_editable('patients'));
grant update on ops.bed_reservations to authenticated;
-- replace_bed_reservation: re-run its definition from 0066 (inserts before it closes).
create policy "insert own punches" on ops.time_punches for insert to authenticated with check (staff_id = auth.uid() and source = 'device');
create policy "own time entry insert" on ops.time_entries for insert to authenticated with check (staff_id = auth.uid());
create policy "own time entry update" on ops.time_entries for update to authenticated using (staff_id = auth.uid()) with check (staff_id = auth.uid());
create policy "own time entry delete" on ops.time_entries for delete to authenticated using (staff_id = auth.uid());
-- insert own punch photo: re-run its definition from 0060.
notify pgrst, 'reload schema';
