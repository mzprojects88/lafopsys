-- A reserved bed, settled by a social worker when the family arrives
-- (user, 2026-09-25): CONFIRMATION -- the reserved child stays on that bed
-- (closed "used" by their check-in, as in 0065) -- or REPLACEMENT -- the bed
-- goes to another child instead. A replacement closes the hold "replaced",
-- points it at the new hold, and holds the same bed for the other child, who
-- then confirms it at their own check-in. Both are Patients edit (social
-- workers, admin); the function runs with the caller's rights, so the 0065
-- policies decide.

alter table ops.bed_reservations drop constraint bed_reservations_status_check;
alter table ops.bed_reservations add constraint bed_reservations_status_check
  check (status in ('active', 'used', 'released', 'replaced'));
alter table ops.bed_reservations add column replaced_by uuid references ops.bed_reservations (id);
alter table ops.bed_reservations add constraint bed_reservations_replaced_names_successor
  check ((status = 'replaced') = (replaced_by is not null));

create function ops.replace_bed_reservation(
  p_id uuid,
  p_patient_id uuid,
  p_sheet_person_id uuid,
  p_reserved_for text,
  p_note text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old ops.bed_reservations;
  v_new uuid;
begin
  select * into v_old from ops.bed_reservations where id = p_id and status = 'active' for update;
  if not found then
    raise exception 'This reservation is no longer open.' using errcode = 'P0002';
  end if;
  insert into ops.bed_reservations (unit_id, patient_id, house_sheet_person_id, reserved_for, expected_on, note)
  values (v_old.unit_id, p_patient_id, p_sheet_person_id, p_reserved_for, (now() at time zone 'Asia/Manila')::date,
          coalesce(nullif(btrim(p_note), ''), 'In place of ' || v_old.reserved_for))
  returning id into v_new;
  update ops.bed_reservations set status = 'replaced', replaced_by = v_new, closed_at = now() where id = p_id;
  return v_new;
end;
$$;
revoke all on function ops.replace_bed_reservation(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function ops.replace_bed_reservation(uuid, uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
