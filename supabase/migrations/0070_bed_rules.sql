-- 0070: Bed rules -- rooms filled in order, single-sex rooms by carer.
--
-- Decided with LAF 2026-09-28, after how hospitals place patients (NHS
-- same-sex accommodation: a bed next to or opposite someone of the other sex
-- is a breach; a breach is exceptional, decided by a senior, recorded):
--   * Room 1 fills before Room 2, Room 2 before Room 3 (rooms.sort_order);
--     a later room opens only when every earlier room is full or holds
--     carers of the other sex.
--   * A room holds women carers or men carers, not both: the first carer in
--     an empty room decides. Walls separate the rooms, so side-by-side and
--     facing beds are covered by the room rule. A child staying without a
--     carer counts as their own sex.
--   * Carers of the same family (patients.family_id, e.g. mother and father of
--     two siblings) may share a room.
--   * When no bed fits, an admin or the inventory lead may allow an exception
--     with a written reason; it is logged in ops.bed_rule_exceptions and shows
--     as a breach until the family moves.
-- The rules live in ops.bed_rule_problem, called by every door that places a
-- stay or a hold on a bed: check_in / admit_from_sheet, confirm_night (Move
-- tonight, and now Transfer bed too), and the reservation guard. The app
-- mirrors them in lib/utils/bed-rules.ts to grey out beds with the reason;
-- change both together. The browser can no longer write a stay's bed directly.

-- ---------------------------------------------------------------------------
-- 1. Carer sex, families, a hold's carer sex
-- ---------------------------------------------------------------------------

alter table ops.carers add column sex text check (sex in ('F', 'M'));
comment on column ops.carers.sex is 'F or M; decides which room the carer (and the child) may sleep in (0070).';

-- The relationship says it for nearly everyone on file.
update ops.carers set sex = case
    when lower(btrim(relationship)) in ('mother', 'grandmother', 'aunt', 'sister', 'stepmother', 'step-mother', 'godmother',
                                        'nanay', 'ina', 'lola', 'tita', 'tiya', 'ate', 'ninang') then 'F'
    when lower(btrim(relationship)) in ('father', 'grandfather', 'uncle', 'brother', 'stepfather', 'step-father', 'godfather',
                                        'tatay', 'ama', 'lolo', 'tito', 'tiyo', 'kuya', 'ninong') then 'M'
  end
where sex is null;

alter table ops.patients add column family_id uuid;
create index patients_family on ops.patients (family_id) where family_id is not null;
comment on column ops.patients.family_id is 'Siblings share one id; their carers may share a room whatever their sex (0070).';

alter table ops.bed_reservations add column carer_sex text check (carer_sex in ('F', 'M'));

-- ---------------------------------------------------------------------------
-- 2. Exceptions
-- ---------------------------------------------------------------------------

create table ops.bed_rule_exceptions (
  id uuid primary key default gen_random_uuid(),
  stay_id uuid not null references ops.stays (id),
  unit_id text not null references ops.units (id),
  rule text not null,
  reason text not null check (btrim(reason) <> ''),
  allowed_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index bed_rule_exceptions_stay on ops.bed_rule_exceptions (stay_id);
alter table ops.bed_rule_exceptions enable row level security;
create policy "patients viewers read" on ops.bed_rule_exceptions
  for select to authenticated using (shared.module_viewable('patients'));
revoke all on ops.bed_rule_exceptions from anon, authenticated;
grant select on ops.bed_rule_exceptions to authenticated;
alter publication supabase_realtime add table ops.bed_rule_exceptions;

create function ops.can_allow_bed_exception() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(shared.current_staff_role() in ('admin', 'inventory_lead'), false);
$$;
grant execute on function ops.can_allow_bed_exception() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The rules
-- ---------------------------------------------------------------------------

-- Who sleeps in each bed now: stays in the house and open holds, with the
-- sex that counts (the carer's; the child's own when no carer stays) and the
-- family. p_ignore_stay: the stay being moved; p_ignore_patient: the child
-- being placed (their own hold does not count against them).
create function ops.bed_occupants(p_ignore_stay uuid, p_ignore_patient uuid)
returns table (room_id text, unit_id text, sex text, family_id uuid)
language sql stable security definer set search_path = '' as $$
  select u.room_id, u.id, coalesce(c.sex, case when s.carer_id is null then p.sex end), p.family_id
    from ops.stays s
    join ops.bed_positions bp on bp.id = s.bed_position_id
    join ops.units u on u.id = bp.unit_id
    join ops.patients p on p.id = s.patient_id
    left join ops.carers c on c.id = s.carer_id
   where s.status in ('in_house', 'overdue') and s.id is distinct from p_ignore_stay
  union all
  select u.room_id, u.id, r.carer_sex, p.family_id
    from ops.bed_reservations r
    join ops.units u on u.id = r.unit_id
    left join ops.patients p on p.id = r.patient_id
   where r.status = 'active' and r.patient_id is distinct from p_ignore_patient;
$$;
revoke all on function ops.bed_occupants(uuid, uuid) from public, anon, authenticated;

-- Why a carer of this sex (and family) may not take this bed, or null.
create function ops.bed_rule_problem(p_unit_id text, p_sex text, p_family uuid, p_ignore_stay uuid, p_ignore_patient uuid)
returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_unit ops.units;
  v_room ops.rooms;
  v_earlier ops.rooms;
begin
  select * into v_unit from ops.units where id = p_unit_id;
  if not found or v_unit.room_id is null or p_sex is null then
    return null; -- an unplaced bed, or nobody whose sex is known
  end if;
  select * into v_room from ops.rooms where id = v_unit.room_id;

  if exists (select 1 from ops.bed_occupants(p_ignore_stay, p_ignore_patient) o
              where o.room_id = v_room.id and o.sex is not null and o.sex <> p_sex
                and (p_family is null or o.family_id is distinct from p_family)) then
    return format('%s is a %s room now', v_room.name, case when p_sex = 'F' then 'men''s' else 'women''s' end);
  end if;

  for v_earlier in select * from ops.rooms r where r.sort_order < v_room.sort_order order by r.sort_order loop
    -- An earlier room that can take this carer and still has a free bed comes first.
    if not exists (select 1 from ops.bed_occupants(p_ignore_stay, p_ignore_patient) o
                    where o.room_id = v_earlier.id and o.sex is not null and o.sex <> p_sex
                      and (p_family is null or o.family_id is distinct from p_family))
       and exists (select 1 from ops.units u
                    where u.room_id = v_earlier.id and u.active and u.status = 'available'
                      and (select count(*) from ops.bed_occupants(p_ignore_stay, p_ignore_patient) o where o.unit_id = u.id) < u.capacity) then
      return format('%s still has a free bed: fill it first', v_earlier.name);
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function ops.bed_rule_problem(text, text, uuid, uuid, uuid) from public, anon, authenticated;

-- The rule, or the exception to it: returns the rule that was set aside
-- (to log once the stay exists) or null; refuses otherwise.
create function ops.enforce_bed_rules(p_unit_id text, p_sex text, p_family uuid, p_ignore_stay uuid, p_ignore_patient uuid, p_exception_reason text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_problem text := ops.bed_rule_problem(p_unit_id, p_sex, p_family, p_ignore_stay, p_ignore_patient);
begin
  if v_problem is null then
    return null;
  end if;
  if nullif(btrim(p_exception_reason), '') is null then
    raise exception '%', v_problem using errcode = '23514', hint = 'bed_rule';
  end if;
  if not ops.can_allow_bed_exception() then
    raise exception '% -- only an admin or the inventory lead can allow an exception', v_problem using errcode = '42501';
  end if;
  return v_problem;
end;
$$;
revoke all on function ops.enforce_bed_rules(text, text, uuid, uuid, uuid, text) from public, anon, authenticated;

-- The sex that counts for a stay: its carer's, or the child's own without one.
create function ops.stay_sleeper_sex(p_stay_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(c.sex, case when s.carer_id is null then p.sex end)
    from ops.stays s join ops.patients p on p.id = s.patient_id left join ops.carers c on c.id = s.carer_id
   where s.id = p_stay_id;
$$;
revoke all on function ops.stay_sleeper_sex(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Every door that places someone on a bed
-- ---------------------------------------------------------------------------

drop function ops.admit_from_sheet(uuid, text, date, uuid, jsonb, uuid, text, text, text, date, boolean);
drop function ops.check_in(text, date, uuid, uuid, uuid, text, text, text, date, date, text, text, text, boolean, boolean);
drop function ops.confirm_night(uuid, text);

-- check_in: 0068's body, plus the carer's sex (required for a carer who
-- stays) and the bed rules. Unchanged otherwise.
CREATE FUNCTION ops.check_in(p_unit_id text, p_check_in_at date, p_patient_id uuid DEFAULT NULL::uuid, p_referral_id uuid DEFAULT NULL::uuid, p_carer_id uuid DEFAULT NULL::uuid, p_carer_name text DEFAULT NULL::text, p_carer_relationship text DEFAULT NULL::text, p_carer_mobile text DEFAULT NULL::text, p_expected_checkout_at date DEFAULT NULL::date, p_appt_date date DEFAULT NULL::date, p_appt_time text DEFAULT NULL::text, p_appt_clinic text DEFAULT NULL::text, p_appt_purpose text DEFAULT NULL::text, p_appt_needs_transport boolean DEFAULT false, p_rules_discussed boolean DEFAULT false, p_carer_sex text DEFAULT NULL::text, p_exception_reason text DEFAULT NULL::text)
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
  v_sex text;
  v_allowed text;
begin
  if not shared.module_editable('patients') then
    raise exception 'Your access to Patients is view only' using errcode = '42501';
  end if;
  -- The house rules are the last step before a child is checked in (0068).
  if p_rules_discussed is distinct from true then
    raise exception 'Discuss the house rules with the patient and carer first' using errcode = '23514';
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
  if p_carer_sex is not null and p_carer_sex not in ('F', 'M') then
    raise exception 'The carer''s sex is F or M' using errcode = '22023';
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
    if p_carer_sex is not null then
      update ops.carers set sex = p_carer_sex where id = v_carer_id;
    end if;
  elsif nullif(btrim(coalesce(p_carer_name, v_ref.carer_name)), '') is not null then
    if nullif(btrim(coalesce(p_carer_relationship, v_ref.carer_relationship)), '') is null then
      raise exception 'Give the carer''s relationship to the patient' using errcode = '23514';
    end if;
    insert into ops.carers (patient_id, name, relationship, mobile_number, effective_from, sex)
      values (v_patient.id,
              btrim(coalesce(p_carer_name, v_ref.carer_name)),
              btrim(coalesce(p_carer_relationship, v_ref.carer_relationship)),
              nullif(btrim(coalesce(p_carer_mobile, v_ref.carer_mobile)), ''),
              p_check_in_at, p_carer_sex)
      returning id into v_carer_id;
  end if;

  -- The bed rules (0070): the sex that counts is the carer's, or the child's own.
  if v_carer_id is not null then
    select sex into v_sex from ops.carers where id = v_carer_id;
    if v_sex is null then
      raise exception 'Give the carer''s sex: it decides which room they sleep in' using errcode = '23514';
    end if;
  else
    v_sex := v_patient.sex;
  end if;
  v_allowed := ops.enforce_bed_rules(v_unit.id, v_sex, v_patient.family_id, null, v_patient.id, p_exception_reason);

  insert into ops.stays (patient_id, bed_position_id, carer_id, check_in_at, expected_checkout_at, status)
    values (v_patient.id, v_position_id, v_carer_id, p_check_in_at, p_expected_checkout_at, 'in_house')
    returning id into v_stay_id;
  if v_allowed is not null then
    insert into ops.bed_rule_exceptions (stay_id, unit_id, rule, reason) values (v_stay_id, v_unit.id, v_allowed, btrim(p_exception_reason));
  end if;

  -- Every rule this family heard, ticked on the stay: all of them the first
  -- time, the returnee list after that (0054/0068). Stamped by trigger.
  insert into ops.stay_orientation_checks (stay_id, topic_id)
    select v_stay_id, t.id from ops.orientation_topics t
     where t.returnee_too
        or not exists (select 1 from ops.stays s where s.patient_id = v_patient.id and s.id <> v_stay_id)
  on conflict do nothing;

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

-- admit_from_sheet: 0068's body; the carer's sex and an exception pass through to check_in.
CREATE FUNCTION ops.admit_from_sheet(p_sheet_row_id uuid, p_unit_id text, p_check_in_at date, p_patient_id uuid DEFAULT NULL::uuid, p_referral jsonb DEFAULT NULL::jsonb, p_carer_id uuid DEFAULT NULL::uuid, p_carer_name text DEFAULT NULL::text, p_carer_relationship text DEFAULT NULL::text, p_carer_mobile text DEFAULT NULL::text, p_expected_checkout_at date DEFAULT NULL::date, p_rules_discussed boolean DEFAULT false, p_carer_sex text DEFAULT NULL::text, p_exception_reason text DEFAULT NULL::text)
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
                             p_expected_checkout_at => p_expected_checkout_at, p_rules_discussed => p_rules_discussed,
                             p_carer_sex => p_carer_sex, p_exception_reason => p_exception_reason);
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
                             p_expected_checkout_at => p_expected_checkout_at, p_rules_discussed => p_rules_discussed,
                             p_carer_sex => p_carer_sex, p_exception_reason => p_exception_reason);
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

-- confirm_night: 0051's body plus the bed rules on a move. It is now also
-- the one way to transfer a stay to another bed (the move is tonight's bed).
create function ops.confirm_night(p_stay_id uuid, p_unit_id text default null, p_exception_reason text default null)
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
  v_allowed text;
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
    v_allowed := ops.enforce_bed_rules(v_unit.id, ops.stay_sleeper_sex(v_stay.id),
                                       (select family_id from ops.patients where id = v_stay.patient_id),
                                       v_stay.id, v_stay.patient_id, p_exception_reason);
    select bp.id into v_position_id from ops.bed_positions bp
      where bp.unit_id = v_unit.id
        and not exists (select 1 from ops.stays s where s.bed_position_id = bp.id and s.status in ('in_house', 'overdue'))
      order by bp.label limit 1;
    update ops.stays set bed_position_id = v_position_id where id = v_stay.id;
    if v_allowed is not null then
      insert into ops.bed_rule_exceptions (stay_id, unit_id, rule, reason) values (v_stay.id, v_unit.id, v_allowed, btrim(p_exception_reason));
    end if;
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

revoke all on function ops.check_in(text, date, uuid, uuid, uuid, text, text, text, date, date, text, text, text, boolean, boolean, text, text) from public, anon;
grant execute on function ops.check_in(text, date, uuid, uuid, uuid, text, text, text, date, date, text, text, text, boolean, boolean, text, text) to authenticated, service_role;
revoke all on function ops.admit_from_sheet(uuid, text, date, uuid, jsonb, uuid, text, text, text, date, boolean, text, text) from public, anon;
grant execute on function ops.admit_from_sheet(uuid, text, date, uuid, jsonb, uuid, text, text, text, date, boolean, text, text) to authenticated, service_role;
revoke all on function ops.confirm_night(uuid, text, text) from public, anon;
grant execute on function ops.confirm_night(uuid, text, text) to authenticated, service_role;

-- A stay's bed changes only through the doors above (the browser used to
-- write it directly for Transfer bed).
create function ops.guard_stay_bed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and (tg_op = 'INSERT' or new.bed_position_id is distinct from old.bed_position_id) then
    raise exception 'Beds change through Check in, Transfer bed or Move tonight' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_stay_bed before insert or update of bed_position_id on ops.stays
  for each row execute function ops.guard_stay_bed();

-- ---------------------------------------------------------------------------
-- 5. Holds follow the same rules
-- ---------------------------------------------------------------------------

create or replace function ops.guard_bed_reservation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_unit ops.units;
  v_taken int;
  v_problem text;
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
  -- The bed rules (0070): a hold says who will sleep there.
  if new.carer_sex is null then
    raise exception 'Give the carer''s sex: it decides which room they sleep in' using errcode = '23514';
  end if;
  v_problem := ops.bed_rule_problem(v_unit.id, new.carer_sex, (select p.family_id from ops.patients p where p.id = new.patient_id), null, new.patient_id);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '23514', hint = 'bed_rule';
  end if;
  return new;
end;
$$;

drop function ops.replace_bed_reservation(uuid, uuid, uuid, text, text);
create function ops.replace_bed_reservation(
  p_id uuid,
  p_patient_id uuid,
  p_sheet_person_id uuid,
  p_reserved_for text,
  p_carer_sex text,
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
  insert into ops.bed_reservations (id, unit_id, patient_id, house_sheet_person_id, reserved_for, expected_on, note, carer_sex)
  values (v_new, v_old.unit_id, p_patient_id, p_sheet_person_id, p_reserved_for, (now() at time zone 'Asia/Manila')::date,
          coalesce(nullif(btrim(p_note), ''), 'In place of ' || v_old.reserved_for), p_carer_sex);
  return v_new;
end;
$$;
revoke all on function ops.replace_bed_reservation(uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function ops.replace_bed_reservation(uuid, uuid, uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
