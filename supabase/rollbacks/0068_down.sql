-- Undo 0068: back to the 0051/0057 signatures (rules step app-only again).
drop function ops.admit_from_sheet(uuid, text, date, uuid, jsonb, uuid, text, text, text, date, boolean);
drop function ops.check_in(text, date, uuid, uuid, uuid, text, text, text, date, date, text, text, text, boolean, boolean);
CREATE OR REPLACE FUNCTION ops.check_in(p_unit_id text, p_check_in_at date, p_patient_id uuid DEFAULT NULL::uuid, p_referral_id uuid DEFAULT NULL::uuid, p_carer_id uuid DEFAULT NULL::uuid, p_carer_name text DEFAULT NULL::text, p_carer_relationship text DEFAULT NULL::text, p_carer_mobile text DEFAULT NULL::text, p_expected_checkout_at date DEFAULT NULL::date, p_appt_date date DEFAULT NULL::date, p_appt_time text DEFAULT NULL::text, p_appt_clinic text DEFAULT NULL::text, p_appt_purpose text DEFAULT NULL::text, p_appt_needs_transport boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'shared', 'pg_temp'
AS $function$
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
    -- The CN is the sheet's to give; the LFCN comes from fill_case_number (0057).
    v_number := null;
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

  return jsonb_build_object('patient_id', v_patient.id, 'stay_id', v_stay_id, 'patient_number', v_patient.patient_number, 'case_number', v_patient.case_number);
end;
$function$;

CREATE OR REPLACE FUNCTION ops.admit_from_sheet(p_sheet_row_id uuid, p_unit_id text, p_check_in_at date, p_patient_id uuid DEFAULT NULL::uuid, p_referral jsonb DEFAULT NULL::jsonb, p_carer_id uuid DEFAULT NULL::uuid, p_carer_name text DEFAULT NULL::text, p_carer_relationship text DEFAULT NULL::text, p_carer_mobile text DEFAULT NULL::text, p_expected_checkout_at date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'shared', 'pg_temp'
AS $function$
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
$function$;

revoke all on function ops.check_in(text, date, uuid, uuid, uuid, text, text, text, date, date, text, text, text, boolean) from public, anon;
grant execute on function ops.check_in(text, date, uuid, uuid, uuid, text, text, text, date, date, text, text, text, boolean) to authenticated, service_role;
revoke all on function ops.admit_from_sheet(uuid, text, date, uuid, jsonb, uuid, text, text, text, date) from public, anon;
grant execute on function ops.admit_from_sheet(uuid, text, date, uuid, jsonb, uuid, text, text, text, date) to authenticated, service_role;
notify pgrst, 'reload schema';
