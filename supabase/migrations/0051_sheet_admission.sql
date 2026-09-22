-- 0051: NCH's Occupancy Tracker drives admission (Phase A). The sheet is
-- filled by NCH and lists who is staying at LAF House each day: a new name is
-- an arrival, a name gone from the newest tab has left. Typing it again as a
-- referral was the double entry; from here a sheet row is admitted directly.
--
--   * ops.admit_from_sheet: one transaction from a sheet row to a bed. A
--     child on file is checked in as they are; a new child comes with the
--     encode form's fields, which become an NCH referral (source house_sheet,
--     admitted at once) so referral history and grant figures stay whole.
--   * ops.bed_nights: who slept in which bed, night by night. The social
--     worker confirms tonight's bed each afternoon (ops.confirm_night: same
--     bed, or a move); check-in records the first night itself.
--   * appointments the sheet carries (next_appointment_on) are kept current
--     by the sync (ops.sync_sheet_appointments), so the transport manifest
--     needs no typing. Only rows it made (source house_sheet) are touched.
--   * house_sheet_people.run_started_on: first day of the current unbroken
--     run on the sheet -- the arrival date a check-in defaults to.
-- Rollback: supabase/rollbacks/0051_down.sql.

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------

alter table ops.house_sheet_people add column run_started_on date;
-- Existing rows: the day they were first seen (a return before today is not
-- recorded anywhere, so this is the best there is).
update ops.house_sheet_people set run_started_on = first_seen_on;
alter table ops.house_sheet_people alter column run_started_on set not null;
-- A writer that does not know the column yet (the sync route between this
-- migration and the deploy that follows it) starts the run on day one.
create or replace function ops.house_sheet_run_default()
returns trigger
language plpgsql
as $$
begin
  new.run_started_on := coalesce(new.run_started_on, new.first_seen_on);
  return new;
end;
$$;
create trigger house_sheet_run_default
  before insert on ops.house_sheet_people
  for each row execute function ops.house_sheet_run_default();

alter table ops.referrals
  add column source text not null default 'manual' check (source in ('manual', 'house_sheet'));
alter table ops.appointments
  add column source text not null default 'manual' check (source in ('manual', 'house_sheet'));

-- ---------------------------------------------------------------------
-- 2. Nights
-- ---------------------------------------------------------------------

create table ops.bed_nights (
  id uuid primary key default gen_random_uuid(),
  night date not null,
  stay_id uuid not null references ops.stays (id) on delete cascade,
  bed_position_id text not null references ops.bed_positions (id),
  confirmed_by uuid references shared.staff (id),
  confirmed_at timestamptz not null default now(),
  unique (night, stay_id),
  unique (night, bed_position_id)
);
create index bed_nights_stay_idx on ops.bed_nights (stay_id, night desc);

alter table ops.bed_nights enable row level security;
create policy "module read" on ops.bed_nights for select to authenticated
  using ((select shared.module_viewable('patients', 'house_ops')));
-- Written only through ops.check_in / ops.confirm_night.
revoke all on ops.bed_nights from authenticated;
grant select on ops.bed_nights to authenticated;
alter publication supabase_realtime add table ops.bed_nights;

-- ---------------------------------------------------------------------
-- 3. Check-in records the first night (0049's function, 0050's gate)
-- ---------------------------------------------------------------------

create or replace function ops.check_in(
  p_unit_id text,
  p_check_in_at date,
  p_patient_id uuid default null,
  p_referral_id uuid default null,
  p_carer_id uuid default null,
  p_carer_name text default null,
  p_carer_relationship text default null,
  p_carer_mobile text default null,
  p_expected_checkout_at date default null,
  p_appt_date date default null,
  p_appt_time text default null,
  p_appt_clinic text default null,
  p_appt_purpose text default null,
  p_appt_needs_transport boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_ref ops.referrals%rowtype;
  v_patient ops.patients%rowtype;
  v_unit ops.units%rowtype;
  v_position_id text;
  v_carer_id uuid;
  v_stay_id uuid;
  v_number text;
begin
  if not shared.module_editable('patients') then
    raise exception 'Your access to Patients is view only' using errcode = '42501';
  end if;
  if p_patient_id is null and p_referral_id is null then
    raise exception 'Pick a patient or a referral' using errcode = '22023';
  end if;
  if p_check_in_at is null or p_check_in_at > v_today then
    raise exception 'The check-in date cannot be in the future' using errcode = '22023';
  end if;
  if p_expected_checkout_at is not null and p_expected_checkout_at < p_check_in_at then
    raise exception 'Expected check-out is before check-in' using errcode = '22023';
  end if;

  if p_referral_id is not null then
    select * into v_ref from ops.referrals where id = p_referral_id for update;
    if not found then
      raise exception 'Referral not found' using errcode = 'P0002';
    end if;
    if v_ref.status <> 'approved' then
      raise exception 'Only an approved referral can be admitted (this one is %)', v_ref.status using errcode = '23514';
    end if;
  end if;

  if p_patient_id is not null then
    select * into v_patient from ops.patients where id = p_patient_id for update;
    if not found then
      raise exception 'Patient not found' using errcode = 'P0002';
    end if;
    if v_patient.status = 'expired' then
      raise exception '% % is recorded as deceased', v_patient.first_name, v_patient.last_name using errcode = '23514';
    end if;
  else
    if v_ref.patient_first_name is null or v_ref.patient_last_name is null or v_ref.patient_sex is null then
      raise exception 'The referral is missing the patient''s name or sex -- complete it first' using errcode = '23514';
    end if;
    perform pg_advisory_xact_lock(hashtext('ops.patients.patient_number'));
    select (coalesce(max(patient_number::int), 0) + 1)::text into v_number
      from ops.patients where patient_number ~ '^[0-9]+$';
    insert into ops.patients (patient_number, first_name, last_name, birth_date, sex, province_id, raw_address,
                              treatment_phase_id, status, admitted_at, referring_hospital_id)
      values (v_number, v_ref.patient_first_name, v_ref.patient_last_name, v_ref.patient_birth_date, v_ref.patient_sex,
              v_ref.province_id, v_ref.raw_address, v_ref.treatment_phase_id, 'ongoing', p_check_in_at, v_ref.hospital_id)
      returning * into v_patient;
    insert into ops.patient_diagnoses (patient_id, diagnosis_id)
      select v_patient.id, diagnosis_id from ops.referral_diagnoses where referral_id = v_ref.id;
  end if;

  if exists (select 1 from ops.stays where patient_id = v_patient.id and status in ('in_house', 'overdue')) then
    raise exception '% % is already checked in', v_patient.first_name, v_patient.last_name using errcode = '23505';
  end if;

  select * into v_unit from ops.units where id = p_unit_id for update;
  if not found or not v_unit.active then
    raise exception 'No such bed' using errcode = 'P0002';
  end if;
  if v_unit.status <> 'available' then
    raise exception 'Bed % is locked (%)', v_unit.code, v_unit.lock_reason using errcode = '23514';
  end if;
  if (select count(*) from ops.stays s join ops.bed_positions bp on bp.id = s.bed_position_id
      where bp.unit_id = v_unit.id and s.status in ('in_house', 'overdue')) >= v_unit.capacity then
    raise exception 'Bed % is taken', v_unit.code using errcode = '23505';
  end if;
  select bp.id into v_position_id from ops.bed_positions bp
    where bp.unit_id = v_unit.id
      and not exists (select 1 from ops.stays s where s.bed_position_id = bp.id and s.status in ('in_house', 'overdue'))
    order by bp.label limit 1;

  if p_carer_id is not null then
    select id into v_carer_id from ops.carers where id = p_carer_id and patient_id = v_patient.id;
    if v_carer_id is null then
      raise exception 'That carer is not on this patient''s record' using errcode = '23514';
    end if;
  elsif nullif(btrim(coalesce(p_carer_name, v_ref.carer_name)), '') is not null then
    if nullif(btrim(coalesce(p_carer_relationship, v_ref.carer_relationship)), '') is null then
      raise exception 'Give the carer''s relationship to the patient' using errcode = '23514';
    end if;
    insert into ops.carers (patient_id, name, relationship, mobile_number, effective_from)
      values (v_patient.id,
              btrim(coalesce(p_carer_name, v_ref.carer_name)),
              btrim(coalesce(p_carer_relationship, v_ref.carer_relationship)),
              nullif(btrim(coalesce(p_carer_mobile, v_ref.carer_mobile)), ''),
              p_check_in_at)
      returning id into v_carer_id;
  end if;

  insert into ops.stays (patient_id, bed_position_id, carer_id, check_in_at, expected_checkout_at, status)
    values (v_patient.id, v_position_id, v_carer_id, p_check_in_at, p_expected_checkout_at, 'in_house')
    returning id into v_stay_id;

  -- Tonight is already known: the bed just chosen. A stale row a discharged
  -- stay left on this position tonight gives way.
  delete from ops.bed_nights bn using ops.stays s
    where bn.night = v_today and bn.bed_position_id = v_position_id
      and s.id = bn.stay_id and s.status not in ('in_house', 'overdue');
  insert into ops.bed_nights (night, stay_id, bed_position_id, confirmed_by)
    values (v_today, v_stay_id, v_position_id, auth.uid());

  if p_appt_date is not null then
    if nullif(btrim(p_appt_clinic), '') is null then
      raise exception 'Give the appointment''s clinic' using errcode = '23514';
    end if;
    insert into ops.appointments (patient_id, date, time, clinic, purpose, needs_transport)
      values (v_patient.id, p_appt_date, coalesce(nullif(btrim(p_appt_time), ''), '08:00'), btrim(p_appt_clinic),
              coalesce(nullif(btrim(p_appt_purpose), ''), 'Hospital appointment'), coalesce(p_appt_needs_transport, false));
  end if;

  if p_referral_id is not null then
    update ops.referrals set status = 'admitted', admitted_patient_id = v_patient.id, admitted_at = p_check_in_at
      where id = p_referral_id;
  end if;

  return jsonb_build_object('patient_id', v_patient.id, 'stay_id', v_stay_id, 'patient_number', v_patient.patient_number);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. From a sheet row to a bed
-- ---------------------------------------------------------------------

-- p_referral (a new child) carries the encode form: patient_first_name,
-- patient_last_name, patient_birth_date, patient_sex, treatment_phase_id,
-- province_id, raw_address, carer_name, carer_relationship, carer_mobile,
-- next_appointment_note, hospital_id, department, referring_person, urgency,
-- diagnosis_ids (array). Without it the row must stand for a patient on file
-- (matched, confirmed, or passed as p_patient_id).
create or replace function ops.admit_from_sheet(
  p_sheet_row_id uuid,
  p_unit_id text,
  p_check_in_at date,
  p_patient_id uuid default null,
  p_referral jsonb default null,
  p_carer_id uuid default null,
  p_carer_name text default null,
  p_carer_relationship text default null,
  p_carer_mobile text default null,
  p_expected_checkout_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_row ops.house_sheet_people%rowtype;
  v_patient_id uuid;
  v_referral_id uuid;
  v_result jsonb;
begin
  if not shared.module_editable('patients') then
    raise exception 'Your access to Patients is view only' using errcode = '42501';
  end if;
  select * into v_row from ops.house_sheet_people where id = p_sheet_row_id for update;
  if not found then
    raise exception 'That name is not on the house sheet' using errcode = 'P0002';
  end if;
  if v_row.match_status = 'dismissed' then
    raise exception '% was marked "not a patient" -- reopen the row first', v_row.patient_name using errcode = '23514';
  end if;

  if p_referral is not null then
    if nullif(btrim(p_referral ->> 'patient_first_name'), '') is null
       or nullif(btrim(p_referral ->> 'patient_last_name'), '') is null
       or coalesce(p_referral ->> 'patient_sex', '') not in ('M', 'F') then
      raise exception 'Give the child''s first name, last name and sex' using errcode = '23514';
    end if;
    insert into ops.referrals (patient_name, referring_person, department, urgency, date, status, source,
                               hospital_id, submitted_by_staff_id, patient_first_name, patient_last_name,
                               patient_birth_date, patient_sex, treatment_phase_id, province_id, raw_address,
                               carer_name, carer_relationship, carer_mobile, next_appointment_note, transcription_note)
      values (btrim(p_referral ->> 'patient_first_name') || ' ' || btrim(p_referral ->> 'patient_last_name'),
              coalesce(nullif(btrim(p_referral ->> 'referring_person'), ''), 'NCH Occupancy Tracker'),
              coalesce(nullif(btrim(p_referral ->> 'department'), ''), 'Medical Social Service'),
              coalesce(nullif(p_referral ->> 'urgency', ''), 'routine'),
              v_row.run_started_on, 'approved', 'house_sheet',
              nullif(p_referral ->> 'hospital_id', ''), auth.uid(),
              btrim(p_referral ->> 'patient_first_name'), btrim(p_referral ->> 'patient_last_name'),
              nullif(p_referral ->> 'patient_birth_date', '')::date, p_referral ->> 'patient_sex',
              nullif(p_referral ->> 'treatment_phase_id', ''), nullif(p_referral ->> 'province_id', ''),
              nullif(btrim(p_referral ->> 'raw_address'), ''),
              nullif(btrim(p_referral ->> 'carer_name'), ''), nullif(btrim(p_referral ->> 'carer_relationship'), ''),
              nullif(btrim(p_referral ->> 'carer_mobile'), ''), nullif(btrim(p_referral ->> 'next_appointment_note'), ''),
              format('From NCH''s Occupancy Tracker (on the sheet since %s).', v_row.run_started_on))
      returning id into v_referral_id;
    insert into ops.referral_diagnoses (referral_id, diagnosis_id)
      select v_referral_id, d from jsonb_array_elements_text(coalesce(p_referral -> 'diagnosis_ids', '[]'::jsonb)) d;

    v_result := ops.check_in(p_unit_id => p_unit_id, p_check_in_at => p_check_in_at, p_referral_id => v_referral_id,
                             p_carer_id => p_carer_id, p_carer_name => p_carer_name,
                             p_carer_relationship => p_carer_relationship, p_carer_mobile => p_carer_mobile,
                             p_expected_checkout_at => p_expected_checkout_at);
    update ops.house_sheet_people
      set match_status = 'encoded', referral_id = v_referral_id, matched_patient_id = null, match_method = null,
          reviewed_by = auth.uid()
      where id = v_row.id;
  else
    v_patient_id := coalesce(
      p_patient_id,
      case when v_row.match_status in ('auto_matched', 'confirmed') then v_row.matched_patient_id end,
      (select admitted_patient_id from ops.referrals where id = v_row.referral_id));
    if v_patient_id is null then
      raise exception 'This name is not linked to a patient yet -- pick the patient or fill in the form' using errcode = '23514';
    end if;
    v_result := ops.check_in(p_unit_id => p_unit_id, p_check_in_at => p_check_in_at, p_patient_id => v_patient_id,
                             p_carer_id => p_carer_id, p_carer_name => p_carer_name,
                             p_carer_relationship => p_carer_relationship, p_carer_mobile => p_carer_mobile,
                             p_expected_checkout_at => p_expected_checkout_at);
    if v_row.match_status <> 'encoded' then
      update ops.house_sheet_people
        set match_status = 'confirmed', matched_patient_id = v_patient_id,
            match_method = case when v_row.matched_patient_id = v_patient_id then coalesce(v_row.match_method, 'manual') else 'manual' end,
            referral_id = null, reviewed_by = auth.uid()
        where id = v_row.id;
    end if;
  end if;

  -- The sheet's next appointment, if it is still ahead.
  if v_row.next_appointment_on is not null and v_row.next_appointment_on >= v_today then
    insert into ops.appointments (patient_id, date, time, clinic, purpose, needs_transport, source)
      select (v_result ->> 'patient_id')::uuid, v_row.next_appointment_on, '08:00', 'NCH',
             coalesce(nullif(btrim(v_row.treatment), ''), 'Hospital appointment'), true, 'house_sheet'
      where not exists (select 1 from ops.appointments a
                        where a.patient_id = (v_result ->> 'patient_id')::uuid and a.date = v_row.next_appointment_on);
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Tonight's bed
-- ---------------------------------------------------------------------

-- p_unit_id null = the bed the stay is in now ("Same bed"); another bed moves
-- the stay there first, under the same rules as a check-in.
create or replace function ops.confirm_night(p_stay_id uuid, p_unit_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_stay ops.stays%rowtype;
  v_current_unit text;
  v_unit ops.units%rowtype;
  v_position_id text;
begin
  if not shared.module_editable('patients') then
    raise exception 'Your access to Patients is view only' using errcode = '42501';
  end if;
  select * into v_stay from ops.stays where id = p_stay_id for update;
  if not found or v_stay.status not in ('in_house', 'overdue') then
    raise exception 'That stay is not in the house' using errcode = 'P0002';
  end if;
  select unit_id into v_current_unit from ops.bed_positions where id = v_stay.bed_position_id;

  if p_unit_id is null or p_unit_id = v_current_unit then
    v_position_id := v_stay.bed_position_id;
  else
    select * into v_unit from ops.units where id = p_unit_id for update;
    if not found or not v_unit.active then
      raise exception 'No such bed' using errcode = 'P0002';
    end if;
    if v_unit.status <> 'available' then
      raise exception 'Bed % is locked (%)', v_unit.code, v_unit.lock_reason using errcode = '23514';
    end if;
    if (select count(*) from ops.stays s join ops.bed_positions bp on bp.id = s.bed_position_id
        where bp.unit_id = v_unit.id and s.status in ('in_house', 'overdue')) >= v_unit.capacity then
      raise exception 'Bed % is taken', v_unit.code using errcode = '23505';
    end if;
    select bp.id into v_position_id from ops.bed_positions bp
      where bp.unit_id = v_unit.id
        and not exists (select 1 from ops.stays s where s.bed_position_id = bp.id and s.status in ('in_house', 'overdue'))
      order by bp.label limit 1;
    update ops.stays set bed_position_id = v_position_id where id = v_stay.id;
  end if;

  delete from ops.bed_nights bn using ops.stays s
    where bn.night = v_today and bn.bed_position_id = v_position_id and bn.stay_id <> v_stay.id
      and s.id = bn.stay_id and s.status not in ('in_house', 'overdue');
  insert into ops.bed_nights (night, stay_id, bed_position_id, confirmed_by)
    values (v_today, v_stay.id, v_position_id, auth.uid())
    on conflict (night, stay_id) do update
      set bed_position_id = excluded.bed_position_id, confirmed_by = excluded.confirmed_by, confirmed_at = now();

  return jsonb_build_object('night', v_today, 'stay_id', v_stay.id, 'bed_position_id', v_position_id);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. The sheet keeps in-house children's next appointment current
-- ---------------------------------------------------------------------

-- Run by the sync (service role) after each roster. For each child on the
-- newest roster who is checked in and has a dated next appointment ahead:
-- move the upcoming sheet-made appointment to that date, or add one. Hand-made
-- appointments are never touched.
create or replace function ops.sync_sheet_appointments()
returns integer
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  rec record;
  v_changed integer := 0;
  v_appt_id uuid;
begin
  for rec in
    select distinct on (p.patient_id) p.patient_id, h.next_appointment_on as on_date, h.treatment
    from ops.house_sheet_people h
    cross join lateral (
      select coalesce(case when h.match_status in ('auto_matched', 'confirmed') then h.matched_patient_id end,
                      (select r.admitted_patient_id from ops.referrals r where r.id = h.referral_id)) as patient_id
    ) p
    where h.off_sheet_at is null and h.next_appointment_on >= v_today and p.patient_id is not null
      and exists (select 1 from ops.stays s where s.patient_id = p.patient_id and s.status in ('in_house', 'overdue'))
    order by p.patient_id, h.last_seen_on desc
  loop
    if exists (select 1 from ops.appointments where patient_id = rec.patient_id and date = rec.on_date) then
      continue;
    end if;
    select id into v_appt_id from ops.appointments
      where patient_id = rec.patient_id and source = 'house_sheet' and date >= v_today
      order by date limit 1;
    if v_appt_id is not null then
      update ops.appointments set date = rec.on_date where id = v_appt_id;
    else
      insert into ops.appointments (patient_id, date, time, clinic, purpose, needs_transport, source)
        values (rec.patient_id, rec.on_date, '08:00', 'NCH',
                coalesce(nullif(btrim(rec.treatment), ''), 'Hospital appointment'), true, 'house_sheet');
    end if;
    v_changed := v_changed + 1;
  end loop;
  return v_changed;
end;
$$;

revoke execute on function ops.admit_from_sheet(uuid, text, date, uuid, jsonb, uuid, text, text, text, date) from public;
grant execute on function ops.admit_from_sheet(uuid, text, date, uuid, jsonb, uuid, text, text, text, date) to authenticated, service_role;
revoke execute on function ops.confirm_night(uuid, text) from public;
grant execute on function ops.confirm_night(uuid, text) to authenticated, service_role;
revoke execute on function ops.sync_sheet_appointments() from public;
grant execute on function ops.sync_sheet_appointments() to service_role;

notify pgrst, 'reload schema';
