-- Hardening after the production test of 2026-09-25.
--
-- 1. Bed reservations, enforced by the database, not only the browser:
--    a hold cannot be placed on a locked, full or already-held bed (the unit
--    row is locked, as ops.check_in does, so two holds cannot race); a hold
--    is closed as soon as its child is checked in, whichever screen did it;
--    an open hold can only be closed, never edited or reopened.
-- 2. The DTR: punches and the day's totals are written by the punch route
--    only (server side, after it has identified the caller), so no one can
--    write their own time entry, punch, "on site" or "photo taken" from a
--    browser console. Reads are unchanged; HR/admin corrections unchanged.

-- ---------------------------------------------------------------------------
-- 1. Bed reservations
-- ---------------------------------------------------------------------------

create function ops.guard_bed_reservation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_unit ops.units;
  v_taken int;
begin
  select * into v_unit from ops.units where id = new.unit_id for update;
  if not found or not v_unit.active then
    raise exception 'No such bed' using errcode = 'P0002';
  end if;
  if v_unit.status <> 'available' then
    raise exception 'Bed % is locked (%)', v_unit.code, v_unit.lock_reason using errcode = '23514';
  end if;
  select (select count(*) from ops.stays s join ops.bed_positions bp on bp.id = s.bed_position_id
          where bp.unit_id = v_unit.id and s.status in ('in_house', 'overdue'))
       + (select count(*) from ops.bed_reservations r where r.unit_id = v_unit.id and r.status = 'active' and r.id <> new.id)
    into v_taken;
  if v_taken >= v_unit.capacity then
    raise exception 'Bed % is already taken or reserved', v_unit.code using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function ops.guard_bed_reservation() from public, anon, authenticated;
create trigger guard_bed_reservation before insert on ops.bed_reservations
  for each row execute function ops.guard_bed_reservation();

-- Closes a child's open hold once they have a stay: "used" on the held bed, "released" otherwise.
create function ops.close_holds_for_stay(p_stay_id uuid, p_patient_id uuid, p_bed_position_id text, p_sheet_person_id uuid)
returns void language sql security definer set search_path = '' as $$
  update ops.bed_reservations r
     set status = case when r.unit_id = (select bp.unit_id from ops.bed_positions bp where bp.id = p_bed_position_id) then 'used' else 'released' end,
         used_stay_id = p_stay_id,
         closed_at = now()
   where r.status = 'active'
     and (r.patient_id = p_patient_id or r.house_sheet_person_id = p_sheet_person_id);
$$;
revoke all on function ops.close_holds_for_stay(uuid, uuid, text, uuid) from public, anon, authenticated;

create function ops.close_holds_on_stay() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform ops.close_holds_for_stay(new.id, new.patient_id, new.bed_position_id, null);
  return null;
end;
$$;
revoke all on function ops.close_holds_on_stay() from public, anon, authenticated;
create trigger close_holds_on_stay after insert on ops.stays
  for each row execute function ops.close_holds_on_stay();

-- A new child admitted from the sheet gets their record (and so the link to
-- the sheet line the hold was placed on) just after the stay exists.
create function ops.close_holds_on_sheet_link() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_patient uuid;
  v_stay ops.stays;
begin
  v_patient := coalesce(new.matched_patient_id, (select r.admitted_patient_id from ops.referrals r where r.id = new.referral_id));
  if v_patient is null then
    return null;
  end if;
  select * into v_stay from ops.stays s where s.patient_id = v_patient and s.status in ('in_house', 'overdue') order by s.check_in_at desc limit 1;
  if found then
    perform ops.close_holds_for_stay(v_stay.id, v_patient, v_stay.bed_position_id, new.id);
  end if;
  return null;
end;
$$;
revoke all on function ops.close_holds_on_sheet_link() from public, anon, authenticated;
create trigger close_holds_on_sheet_link after update of matched_patient_id, referral_id on ops.house_sheet_people
  for each row execute function ops.close_holds_on_sheet_link();

-- An open hold can only be closed; nothing else about it changes.
drop policy "patients editors close reservations" on ops.bed_reservations;
create policy "patients editors close reservations" on ops.bed_reservations
  for update to authenticated
  using (shared.module_editable('patients') and status = 'active')
  with check (shared.module_editable('patients') and status <> 'active');
revoke update on ops.bed_reservations from authenticated;
grant update (status, closed_at, used_stay_id, replaced_by) on ops.bed_reservations to authenticated;

-- A replacement closes the old hold before placing the new one on the same
-- bed (the guard above counts open holds), so the link to the successor is
-- checked at commit.
alter table ops.bed_reservations drop constraint bed_reservations_replaced_by_fkey;
alter table ops.bed_reservations add constraint bed_reservations_replaced_by_fkey
  foreign key (replaced_by) references ops.bed_reservations (id) deferrable initially deferred;

create or replace function ops.replace_bed_reservation(
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
  v_new uuid := gen_random_uuid();
begin
  select * into v_old from ops.bed_reservations where id = p_id and status = 'active' for update;
  if not found then
    raise exception 'This reservation is no longer open.' using errcode = 'P0002';
  end if;
  update ops.bed_reservations set status = 'replaced', replaced_by = v_new, closed_at = now() where id = p_id;
  insert into ops.bed_reservations (id, unit_id, patient_id, house_sheet_person_id, reserved_for, expected_on, note)
  values (v_new, v_old.unit_id, p_patient_id, p_sheet_person_id, p_reserved_for, (now() at time zone 'Asia/Manila')::date,
          coalesce(nullif(btrim(p_note), ''), 'In place of ' || v_old.reserved_for));
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The DTR is written by the punch route only
-- ---------------------------------------------------------------------------

drop policy "insert own punches" on ops.time_punches;
drop policy "own time entry insert" on ops.time_entries;
drop policy "own time entry update" on ops.time_entries;
drop policy "own time entry delete" on ops.time_entries;
drop policy "insert own punch photo" on ops.time_punch_photos;

notify pgrst, 'reload schema';
