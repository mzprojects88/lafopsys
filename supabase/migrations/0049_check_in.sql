-- 0049: one door into the house. ops.check_in admits a patient to a bed in a
-- single transaction -- patient (only when new), carer (only when new), stay,
-- first appointment, and the referral's "admitted" stamp -- so a failure half
-- way leaves nothing behind and a retry cannot make a second patient.
--
-- It takes EITHER an existing patient (a family back for the next cycle, or
-- one already in the house when the system started) OR an approved referral,
-- or both (a referral for someone already on file: no duplicate record).
-- Before this, the only path was Confirm Arrival, which always inserted a new
-- patient with a 'REF-<uuid>' number.
--
-- Rules:
--   * admin and social_worker only (the patients module's people; 0046 uses
--     the same pair for the house sheet).
--   * the bed must be active, unlocked and not full; the unit row is locked
--     FOR UPDATE so two check-ins cannot take the same bed.
--   * one active stay per patient; a deceased ('expired') patient is refused.
--   * check-in date may be in the past (families already in the house are
--     entered with the day they arrived) but not after today, Manila time.
--   * a new patient gets the next number in the house's own sequence (the
--     integers 1..169 migrated from FINAL_PATIENTS DATABASE), under an
--     advisory lock; the unique constraint is the backstop.
-- Rollback: supabase/rollbacks/0049_down.sql.

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
  if coalesce(shared.current_staff_role(), '') not in ('admin', 'social_worker') then
    raise exception 'Only admins and social workers check patients in' using errcode = '42501';
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

  -- the referral, if any, must be waiting for this
  if p_referral_id is not null then
    select * into v_ref from ops.referrals where id = p_referral_id for update;
    if not found then
      raise exception 'Referral not found' using errcode = 'P0002';
    end if;
    if v_ref.status <> 'approved' then
      raise exception 'Only an approved referral can be admitted (this one is %)', v_ref.status using errcode = '23514';
    end if;
  end if;

  -- the patient: the one named, or a new record from the referral
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

  -- the bed
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

  -- the carer: one on file, a new one typed in, or the referral's
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

revoke execute on function ops.check_in(text, date, uuid, uuid, uuid, text, text, text, date, date, text, text, text, boolean) from public;
grant execute on function ops.check_in(text, date, uuid, uuid, uuid, text, text, text, date, date, text, text, text, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
