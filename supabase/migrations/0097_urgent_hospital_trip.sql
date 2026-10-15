-- 0097: the doctor's urgent call (user, 2026-10-15).
--
-- A child in the house is called in by the doctor: the family rides HOPE in Transit to the hospital
-- now, the child is admitted there, and the family counts as checked out of LAF. One function does
-- both, so the trip and the check-out never happen one without the other:
--   * a delivery to the hospital leaving now, marked urgent, with the child (and carer) on board
--     the manifest -- on the first active vehicle; if it is out on another trip, this one waits;
--   * the stay checked out today, reason 'admitted_to_hospital', the hospital as destination;
--   * tonight's bed record removed: the bed is free tonight and the night is not billed.

alter table ops.trips add column if not exists urgent boolean not null default false;
comment on column ops.trips.urgent is 'A doctor''s urgent call: shown first and marked for the driver (0097).';

create or replace function ops.urgent_hospital_trip(p_stay_id uuid, p_destination text, p_driver_id uuid default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_stay ops.stays%rowtype;
  v_now timestamp := now() at time zone 'Asia/Manila';
  v_trip uuid;
  v_hospital text := coalesce(nullif(btrim(p_destination), ''), 'National Children''s Hospital');
begin
  if not shared.module_editable('patients') then
    raise exception 'An urgent trip needs Patients edit' using errcode = '42501';
  end if;
  select * into v_stay from ops.stays where id = p_stay_id for update;
  if v_stay.id is null or v_stay.status not in ('in_house', 'overdue') then
    raise exception 'This family is not in the house' using errcode = 'P0002';
  end if;
  if char_length(coalesce(p_note, '')) > 200 then
    raise exception 'Keep the note under 200 characters' using errcode = '22023';
  end if;

  v_trip := ops.create_trip(v_now::date, to_char(v_now, 'HH24:MI'), p_driver_id, 'to_hospital', v_hospital, null, '{}', array[v_stay.patient_id]);
  update ops.trips set urgent = true where id = v_trip;
  update ops.trip_manifest set note = coalesce(nullif(btrim(p_note), ''), 'Urgent call by the doctor') where trip_id = v_trip;

  update ops.stays
     set status = 'checked_out', check_out_at = v_now::date, check_out_reason = 'admitted_to_hospital', destination = v_hospital
   where id = p_stay_id;
  delete from ops.bed_nights where stay_id = p_stay_id and night = v_now::date;

  return v_trip;
end;
$$;
revoke execute on function ops.urgent_hospital_trip(uuid, text, uuid, text) from public;
grant execute on function ops.urgent_hospital_trip(uuid, text, uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
