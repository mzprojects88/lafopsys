-- DTR plan phase 2 (user 2026-09-24): admins and HR decide the correction
-- requests staff file through ops.report_missed_clock_out (0061).
--
-- Approving adds the missing clock-out as an ADJUSTMENT punch at the time
-- the person gave, signed by the approver (0029's rule: nothing edits a
-- punch), and marks the request approved -- both in one transaction, so a
-- punch never exists without its approval or the reverse. The app checks
-- first that the time closes that day's own session (lib/utils/dtr.ts
-- planClockOut) and afterwards recomputes the day's totals.
--
-- Rejecting needs a note, which the person sees; the day stays a missed
-- clock-out and they can ask again.
--
-- Nobody decides their own request: an admin or HR person's own forgotten
-- day is decided by someone else.

create or replace function ops.approve_correction_request(p_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ops, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_req ops.dtr_correction_requests;
  v_punch uuid;
begin
  if not hr.is_hr_staff() then
    raise exception 'Only admins and HR decide correction requests.' using errcode = '42501';
  end if;
  select * into v_req from ops.dtr_correction_requests where id = p_id for update;
  if not found then
    raise exception 'No such request.' using errcode = '22023';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request was already %.', v_req.status using errcode = '22023';
  end if;
  if v_req.staff_id = v_uid then
    raise exception 'Someone else has to decide your own request.' using errcode = '42501';
  end if;
  if v_req.punch_type <> 'clock_out' then
    raise exception 'Only missed clock-outs can be approved here yet.' using errcode = '22023';
  end if;
  if exists (select 1 from ops.time_entries where id = v_req.time_entry_id and clock_out is not null) then
    raise exception 'That day already has a clock-out.' using errcode = '22023';
  end if;

  insert into ops.time_punches (time_entry_id, staff_id, punch_type, punched_at, location_status, device_type, source, adjustment_reason, adjusted_by)
  values (v_req.time_entry_id, v_req.staff_id, 'clock_out', v_req.requested_at, 'unavailable', 'unknown', 'adjustment',
          'Approved request: ' || v_req.reason, v_uid)
  returning id into v_punch;

  update ops.dtr_correction_requests
  set status = 'approved', decided_by = v_uid, decided_at = now(), decision_note = nullif(btrim(p_note), ''), adjustment_punch_id = v_punch
  where id = p_id;
  return v_punch;
end;
$$;

create or replace function ops.reject_correction_request(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ops, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_req ops.dtr_correction_requests;
begin
  if not hr.is_hr_staff() then
    raise exception 'Only admins and HR decide correction requests.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say why it is rejected; the person sees it.' using errcode = '22023';
  end if;
  select * into v_req from ops.dtr_correction_requests where id = p_id for update;
  if not found then
    raise exception 'No such request.' using errcode = '22023';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request was already %.', v_req.status using errcode = '22023';
  end if;
  if v_req.staff_id = v_uid then
    raise exception 'Someone else has to decide your own request.' using errcode = '42501';
  end if;

  update ops.dtr_correction_requests
  set status = 'rejected', decided_by = v_uid, decided_at = now(), decision_note = btrim(p_note)
  where id = p_id;
end;
$$;

revoke all on function ops.approve_correction_request(uuid, text) from public, anon;
revoke all on function ops.reject_correction_request(uuid, text) from public, anon;
grant execute on function ops.approve_correction_request(uuid, text) to authenticated;
grant execute on function ops.reject_correction_request(uuid, text) to authenticated;

notify pgrst, 'reload schema';
