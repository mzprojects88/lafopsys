-- DTR correction requests (DTR plan phase 1-2, user 2026-09-24).
--
-- 16 of the last 17 punches were clock-ins: people forget to clock out, and
-- the next morning the punch route refuses their clock-in ("Already clocked
-- in ... yesterday") until they clock out, which records a false 24-hour day.
-- Now the person says when they actually left. That becomes a REQUEST, never
-- a punch: admins and HR approve it (phase 2), and only then is a signed
-- adjustment punch added (0029's rule: nothing edits a punch). Meanwhile the
-- day is marked missed_punch, which stops it counting as "clocked in", so
-- today's clock-in goes through.
--
-- Written only through ops.report_missed_clock_out (below) and, in phase 2,
-- the approval function; staff read their own requests, admins and HR all.

create table ops.dtr_correction_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references shared.staff (id),
  time_entry_id uuid not null references ops.time_entries (id) on delete cascade,
  kind text not null check (kind in ('missed_clock_out', 'missed_clock_in', 'wrong_time')),
  punch_type text not null check (punch_type in ('clock_in', 'clock_out')),
  -- The moment the person says the punch should have been.
  requested_at timestamptz not null,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references shared.staff (id),
  decided_at timestamptz,
  decision_note text,
  adjustment_punch_id uuid references ops.time_punches (id),
  created_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null)),
  check ((status = 'pending') = (decided_by is null))
);

-- One open request per day and punch; a rejected one can be asked again.
create unique index dtr_correction_requests_one_pending
  on ops.dtr_correction_requests (time_entry_id, punch_type) where status = 'pending';
create index dtr_correction_requests_staff on ops.dtr_correction_requests (staff_id, created_at desc);

alter table ops.dtr_correction_requests enable row level security;

create policy "own or hr read correction requests" on ops.dtr_correction_requests
  for select to authenticated
  using (staff_id = auth.uid() or hr.is_hr_staff());

revoke all on ops.dtr_correction_requests from anon, authenticated;
grant select on ops.dtr_correction_requests to authenticated;

alter publication supabase_realtime add table ops.dtr_correction_requests;

-- ---------------------------------------------------------------------------
-- "I forgot to clock out; I left at ..."
-- ---------------------------------------------------------------------------
create or replace function ops.report_missed_clock_out(p_entry_id uuid, p_left_at timestamptz, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ops, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_entry ops.time_entries;
  v_started timestamptz;
  v_id uuid;
begin
  select * into v_entry from ops.time_entries where id = p_entry_id and staff_id = v_uid for update;
  if not found then
    raise exception 'No such day on your time record.' using errcode = '42501';
  end if;
  if v_entry.clock_out is not null then
    raise exception 'That day already has a clock-out.' using errcode = '22023';
  end if;

  -- The open session: the day's latest clock-in.
  select max(punched_at) into v_started
  from ops.time_punches
  where time_entry_id = p_entry_id and punch_type = 'clock_in';
  if v_started is null then
    raise exception 'That day has no clock-in to close.' using errcode = '22023';
  end if;
  if p_left_at <= v_started or p_left_at > now() or p_left_at > v_started + interval '25 hours' then
    raise exception 'The time you left must be after you clocked in, not in the future, and within 25 hours.' using errcode = '22023';
  end if;

  insert into ops.dtr_correction_requests (staff_id, time_entry_id, kind, punch_type, requested_at, reason)
  values (v_uid, p_entry_id, 'missed_clock_out', 'clock_out', p_left_at, btrim(p_reason))
  returning id into v_id;

  -- No longer "clocked in": today's clock-in can go through.
  update ops.time_entries set flag = 'missed_punch', updated_at = now() where id = p_entry_id;
  return v_id;
end;
$$;

revoke all on function ops.report_missed_clock_out(uuid, timestamptz, text) from public, anon;
grant execute on function ops.report_missed_clock_out(uuid, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
