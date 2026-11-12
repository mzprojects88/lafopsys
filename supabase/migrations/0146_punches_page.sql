-- 0146 Staff & Time › Punches (user, 12 Nov 2026).
--
-- Punches get their own page: IN and OUT side by side, every IN closed by an OUT or a request. The people who manage
-- punches (a new power, "Manages punches": Office Admin, the CEO and Finance to start, the Super Admin always, and
-- anyone with HR) see everyone's, add a punch, change a punch's time, delete one, and decide the missed clock-out
-- requests. Nothing is lost: an added punch is marked Added and signed (as since 0029); a changed time keeps the
-- original in the punch log (ops.time_punch_deletions, now every change: 'deleted' or 'edited'), which the person
-- whose punch it is may read too. Like 0141, the add and edit functions are the server's only (service role): the
-- routes check the order of the person's punches and recompute the day's summary.

-- 1. The power.
alter table shared.role_powers drop constraint if exists role_powers_power_check;
alter table shared.role_powers add constraint role_powers_power_check
  check (power in ('runs_hr', 'finance_work', 'bed_exception', 'floor_plan_layout', 'driver', 'clinical_detail', 'caf_billing', 'caf_billing_view', 'confirm_summary', 'finance_setup', 'finance_export', 'manage_punches'));
insert into shared.role_powers (role, power)
select r, 'manage_punches' from unnest(array['office_admin', 'ceo', 'finance']) r
where exists (select 1 from shared.roles where key = r)
on conflict do nothing;

create or replace function ops.manages_punches()
returns boolean language sql stable security definer set search_path = shared, pg_temp as $$
  -- The power (the Super Admin holds every power), or HR (0035/0093).
  select shared.has_power('manage_punches') or hr.is_hr_staff();
$$;
revoke all on function ops.manages_punches() from public, anon;
grant execute on function ops.manages_punches() to authenticated, service_role;

-- 2. They read everyone's punches and requests (everyone else keeps their own).
drop policy if exists "punch managers read all punches" on ops.time_punches;
create policy "punch managers read all punches" on ops.time_punches for select to authenticated using (ops.manages_punches());
drop policy if exists "own or hr read correction requests" on ops.dtr_correction_requests;
create policy "own or punch managers read correction requests" on ops.dtr_correction_requests
  for select to authenticated using (staff_id = auth.uid() or ops.manages_punches());

-- 3. The punch log: every change, read by the managers and by the person whose punch it was.
alter table ops.time_punch_deletions add column if not exists action text not null default 'deleted';
alter table ops.time_punch_deletions drop constraint if exists time_punch_deletions_action_check;
alter table ops.time_punch_deletions add constraint time_punch_deletions_action_check check (action in ('deleted', 'edited'));
alter table ops.time_punch_deletions add column if not exists new_punched_at timestamptz;
alter table ops.time_punch_deletions drop constraint if exists time_punch_deletions_new_time_check;
alter table ops.time_punch_deletions add constraint time_punch_deletions_new_time_check check ((action = 'edited') = (new_punched_at is not null));
comment on table ops.time_punch_deletions is 'Every change to a punch (0141 deletions, 0146 edits): a copy as it was, the reason, who and when. deleted_by/deleted_at = changed by/at.';
drop policy if exists "hr and the super admin read punch deletions" on ops.time_punch_deletions;
drop policy if exists "punch managers and the person read punch changes" on ops.time_punch_deletions;
create policy "punch managers and the person read punch changes" on ops.time_punch_deletions
  for select to authenticated using (ops.manages_punches() or staff_id = auth.uid());

-- 3b. A changed punch says so on itself (the DTR, its print and every export), not only in the log.
alter table ops.time_punches add column if not exists edited_at timestamptz;
alter table ops.time_punches add column if not exists edited_by uuid references shared.staff(id) on delete set null deferrable initially immediate;

-- 4. Add a punch: a clock-in on a day (its day is made if it has none, marked missed_punch), or a clock-out for a
-- day's session. Signed and marked Added, never in the future, never over a request still to decide.
create or replace function ops.time_punch_add(p_staff uuid, p_type text, p_at timestamptz, p_entry uuid, p_reason text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_day date := (p_at at time zone 'Asia/Manila')::date;
  e ops.time_entries;
  v_punch uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  if p_actor is null or shared.current_staff_roles() is null or not ops.manages_punches() then
    raise exception 'Only those who manage punches add one.' using errcode = '42501';
  end if;
  if length(v_reason) not between 3 and 500 then
    raise exception 'Say why this punch is added (at least 3 characters).' using errcode = '23514';
  end if;
  if p_at is null or p_at > now() then
    raise exception 'A punch can''t be in the future.' using errcode = '23514';
  end if;
  if p_staff = p_actor and not shared.has_role('admin') then
    raise exception 'Someone else changes your own punches.' using errcode = '42501';
  end if;
  if p_type = 'clock_in' then
    if not exists (select 1 from shared.staff where id = p_staff and active) then
      raise exception 'No such staff member.' using errcode = 'P0002';
    end if;
    insert into ops.time_entries (staff_id, date, flag) values (p_staff, v_day, 'missed_punch') on conflict (staff_id, date) do nothing;
    select * into e from ops.time_entries where staff_id = p_staff and date = v_day for update;
  elsif p_type = 'clock_out' then
    select * into e from ops.time_entries where id = p_entry for update;
    if not found or e.staff_id <> p_staff then
      raise exception 'That day is not this person''s.' using errcode = 'P0002';
    end if;
    if v_day not in (e.date, e.date + 1) then
      raise exception 'A clock-out goes on its day or the morning after.' using errcode = '23514';
    end if;
    if exists (select 1 from ops.dtr_correction_requests where time_entry_id = e.id and status = 'pending') then
      raise exception 'This day has a request waiting: approve or reject it instead.' using errcode = '23514';
    end if;
    -- Under the lock: the day's last session has no clock-out yet (two people adding the same OUT, or a device OUT).
    if exists (select 1 from ops.time_punches o where o.time_entry_id = e.id and o.punch_type = 'clock_out'
               and o.punched_at > coalesce((select max(i.punched_at) from ops.time_punches i where i.time_entry_id = e.id and i.punch_type = 'clock_in'), '-infinity')) then
      raise exception 'This day already has its clock-out.' using errcode = '23514';
    end if;
  else
    raise exception 'A punch is a clock-in or a clock-out.' using errcode = '22023';
  end if;
  insert into ops.time_punches (time_entry_id, staff_id, punch_type, punched_at, location_status, device_type, source, adjustment_reason, adjusted_by)
  values (e.id, p_staff, p_type, p_at, 'unavailable', 'unknown', 'adjustment', v_reason, p_actor)
  returning id into v_punch;
  return jsonb_build_object('punch_id', v_punch, 'time_entry_id', e.id, 'day', e.date);
end $$;
revoke all on function ops.time_punch_add(uuid, text, timestamptz, uuid, text, uuid) from public, anon, authenticated;
grant execute on function ops.time_punch_add(uuid, text, timestamptz, uuid, text, uuid) to service_role;

-- 5. Change a punch's time: a clock-in stays on its day, a clock-out on its day or the morning after; the original
-- goes into the log first.
create or replace function ops.time_punch_edit(p_punch uuid, p_at timestamptz, p_reason text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_day date := (p_at at time zone 'Asia/Manila')::date;
  p ops.time_punches;
  e ops.time_entries;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  if p_actor is null or shared.current_staff_roles() is null or not ops.manages_punches() then
    raise exception 'Only those who manage punches change one.' using errcode = '42501';
  end if;
  if length(v_reason) not between 3 and 500 then
    raise exception 'Say why this time is changed (at least 3 characters).' using errcode = '23514';
  end if;
  if p_at is null or p_at > now() then
    raise exception 'A punch can''t be in the future.' using errcode = '23514';
  end if;
  select * into p from ops.time_punches where id = p_punch;
  if not found then
    raise exception 'No such punch.' using errcode = 'P0002';
  end if;
  -- The day first, then the punch (as 0141).
  select * into e from ops.time_entries where id = p.time_entry_id for update;
  select * into p from ops.time_punches where id = p_punch for update;
  if not found or e.id is null then
    raise exception 'No such punch.' using errcode = 'P0002';
  end if;
  if p.staff_id = p_actor and not shared.has_role('admin') then
    raise exception 'Someone else changes your own punches.' using errcode = '42501';
  end if;
  -- As with deleting (0141): a punch a request made, or a day with a request still to decide, is settled through the request.
  if exists (select 1 from ops.dtr_correction_requests r where r.adjustment_punch_id = p.id or (r.time_entry_id = e.id and r.status = 'pending')) then
    raise exception 'This day has a correction request: settle it through the request instead.' using errcode = '23514';
  end if;
  if p.punched_at = p_at then
    raise exception 'That is the time it has already.' using errcode = '23514';
  end if;
  if (p.punch_type = 'clock_in' and v_day <> e.date) or (p.punch_type = 'clock_out' and v_day not in (e.date, e.date + 1)) then
    raise exception 'A clock-in stays on its day, a clock-out on its day or the morning after.' using errcode = '23514';
  end if;
  insert into ops.time_punch_deletions (action, punch_id, staff_id, punched_at, new_punched_at, punch, reason, deleted_by)
  values ('edited', p.id, p.staff_id, p.punched_at, p_at, to_jsonb(p), v_reason, p_actor);
  update ops.time_punches set punched_at = p_at, edited_at = now(), edited_by = p_actor where id = p.id;
  return jsonb_build_object('staff_id', p.staff_id, 'time_entry_id', e.id, 'day', e.date);
end $$;
revoke all on function ops.time_punch_edit(uuid, timestamptz, text, uuid) from public, anon, authenticated;
grant execute on function ops.time_punch_edit(uuid, timestamptz, text, uuid) to service_role;

-- 6. Delete (0141) and the request decisions (0062): from the Super Admin / HR to those who manage punches.
CREATE OR REPLACE FUNCTION ops.time_punch_delete(p_punch uuid, p_reason text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'shared', 'pg_temp'
AS $function$
declare
  p ops.time_punches;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_key text;
  v_left integer := 0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  if p_actor is null or shared.current_staff_roles() is null or not ops.manages_punches() then
    raise exception 'Only those who manage punches delete one.' using errcode = '42501';
  end if;
  if length(v_reason) not between 3 and 500 then
    raise exception 'Say why this punch is deleted (at least 3 characters).' using errcode = '23514';
  end if;
  select * into p from ops.time_punches where id = p_punch;
  if not found then
    raise exception 'No such punch.' using errcode = 'P0002';
  end if;
  -- The day first, then the punch: a punch arriving on this day meanwhile waits, and is counted (never cascaded away).
  perform 1 from ops.time_entries where id = p.time_entry_id for update;
  select * into p from ops.time_punches where id = p_punch for update;
  if not found then
    raise exception 'No such punch.' using errcode = 'P0002';
  end if;
  -- Your own punches are someone else's to change, as your own request is someone else's to decide (the Super Admin excepted).
  if p.staff_id = p_actor and not shared.has_role('admin') then
    raise exception 'Someone else changes your own punches.' using errcode = '42501';
  end if;
  select count(*) into v_left from ops.time_punches where time_entry_id = p.time_entry_id and id <> p.id;
  -- A clock-in that a clock-out closes: its clock-out would be left alone and pair with another day.
  if p.punch_type = 'clock_in' and exists (
    select 1 from ops.time_punches o
    where o.time_entry_id = p.time_entry_id and o.punch_type = 'clock_out' and o.punched_at > p.punched_at
      and not exists (select 1 from ops.time_punches i where i.time_entry_id = p.time_entry_id and i.punch_type = 'clock_in' and i.punched_at > p.punched_at and i.punched_at < o.punched_at)) then
    raise exception 'This clock-in has its clock-out: delete the clock-out first.' using errcode = '23514';
  end if;
  -- A correction request still to decide, one that made this punch, or any the emptied day would take with it.
  if exists (
    select 1 from ops.dtr_correction_requests r
    where r.adjustment_punch_id = p.id
       or (r.time_entry_id = p.time_entry_id and (r.status = 'pending' or v_left = 0))) then
    raise exception 'This day has a correction request: settle it through the request instead.' using errcode = '23514';
  end if;
  select object_key into v_key from ops.time_punch_photos where punch_id = p.id;
  insert into ops.time_punch_deletions (action, punch_id, staff_id, punched_at, punch, photo_key, reason, deleted_by)
  values ('deleted', p.id, p.staff_id, p.punched_at, to_jsonb(p), v_key, v_reason, p_actor);
  delete from ops.time_punch_photos where punch_id = p.id;
  delete from ops.time_punches where id = p.id;
  if p.time_entry_id is not null and v_left = 0 then
    delete from ops.time_entries where id = p.time_entry_id;
  end if;
  return jsonb_build_object('staff_id', p.staff_id, 'punched_at', p.punched_at, 'time_entry_id', p.time_entry_id,
                            'entry_deleted', p.time_entry_id is not null and v_left = 0, 'photo_key', v_key);
end $function$;
revoke all on function ops.time_punch_delete(uuid, text, uuid) from public, anon, authenticated;
grant execute on function ops.time_punch_delete(uuid, text, uuid) to service_role;

CREATE OR REPLACE FUNCTION ops.approve_correction_request(p_id uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_req ops.dtr_correction_requests;
  v_punch uuid;
begin
  if not ops.manages_punches() then
    raise exception 'Only those who manage punches decide correction requests.' using errcode = '42501';
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
$function$;

CREATE OR REPLACE FUNCTION ops.reject_correction_request(p_id uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_req ops.dtr_correction_requests;
begin
  if not ops.manages_punches() then
    raise exception 'Only those who manage punches decide correction requests.' using errcode = '42501';
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
$function$;

-- 7. The page, for every role that has the DTR, and the CEO.
insert into shared.role_page_access (role, page, level)
select r.role, p.page, 'view' from (values ('staff.punches')) p(page)
cross join (select role from shared.role_page_access where page = 'staff.dtr' union select key from shared.roles where key = 'ceo') r
on conflict do nothing;

notify pgrst, 'reload schema';
