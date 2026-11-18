-- 0163: bed rules the admin can switch off, and long-stay families keep their bed (owner, 18 Nov 2026).
--
--  1. shared.app_settings: bed_fill_order (Room 1 -> 2 -> 3, regular beds before temporary ones),
--     bed_single_sex (rooms for women carers or men carers, families excepted), both on by default
--     (today's rules); bed_keep_from_night (default 3, null = off).
--  2. ops.kept_beds(): after the morning reset, the bed of a family whose visit reaches that night
--     tonight stays theirs until the finalize time (admission_finalize_by), as long as they are not
--     back in the house. It counts as taken for everyone else, and for the rooms' rules.
--  3. ops.bed_rule_problem gains p_all (every rule, whatever Settings say) and reads the switches;
--     the kept bed is a rule of its own (an approver may still set it aside, with a reason).
--  4. ops.readmit_for_tonight: from that night on, last night's bed is always allowed.
--  5. ops.log_bed_waiver(): a placement that passes only because a rule is switched off, or because
--     the family keeps its bed, is written to ops.bed_rule_exceptions with the reason, as the 28 Sep
--     rules asked of every placement outside them. check_in (and so admit_from_sheet),
--     confirm_night and readmit_for_tonight call it.
--
-- Nothing is inserted into any table. check_in, confirm_night and readmit_for_tonight are their
-- live definitions with the changes marked "0163"; ops.apply_bed_plan and ops.guard_bed_reservation
-- follow the switches through ops.bed_rule_problem unchanged.

-- ---- 1. the settings ----
alter table shared.app_settings
  add column if not exists bed_fill_order boolean not null default true,
  add column if not exists bed_single_sex boolean not null default true,
  add column if not exists bed_keep_from_night smallint default 3;
alter table shared.app_settings drop constraint if exists app_settings_bed_keep_check;
alter table shared.app_settings add constraint app_settings_bed_keep_check
  check (bed_keep_from_night is null or bed_keep_from_night between 2 and 30);

-- ---- 2. beds kept for long-stay families ----
create or replace function ops.kept_beds()
returns table (unit_id text, room_id text, patient_id uuid, sex text, family_id uuid, night integer)
language sql stable security definer set search_path to '' as $$
  with cfg as (
    select a.bed_keep_from_night as from_night, coalesce(a.admission_finalize_by, '18:00'::time) as until,
           (now() at time zone 'Asia/Manila') as here
      from shared.app_settings a where a.id
  ), closed as (
    -- This morning's reset closed last night's stay; tonight is that visit's next night.
    select distinct on (s.patient_id) s.*, (select count(*) from ops.stays v where v.visit_id = s.visit_id)::int + 1 as night
      from ops.stays s, cfg
     where s.check_out_reason = 'daily_reset' and s.check_out_at = cfg.here::date
     order by s.patient_id, s.check_in_at desc, s.created_at desc
  )
  select u.id, u.room_id, c.patient_id, coalesce(cr.sex, case when c.carer_id is null then p.sex end), p.family_id, c.night
    from closed c
    cross join cfg
    join ops.bed_positions bp on bp.id = c.bed_position_id
    join ops.units u on u.id = bp.unit_id and u.active
    join ops.patients p on p.id = c.patient_id
    left join ops.carers cr on cr.id = c.carer_id
   where cfg.from_night is not null and c.night >= cfg.from_night and cfg.here::time < cfg.until
     and not exists (select 1 from ops.stays a where a.patient_id = c.patient_id and a.status in ('in_house', 'overdue'));
$$;
revoke all on function ops.kept_beds() from public, anon, authenticated;

-- Everyone in a bed now: stays in the house, open holds, and (0163) kept beds.
create or replace function ops.bed_occupants(p_ignore_stay uuid, p_ignore_patient uuid)
returns table (room_id text, unit_id text, sex text, family_id uuid)
language sql stable security definer set search_path to '' as $$
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
   where r.status = 'active' and r.patient_id is distinct from p_ignore_patient
  union all
  select k.room_id, k.unit_id, k.sex, k.family_id
    from ops.kept_beds() k
   where k.patient_id is distinct from p_ignore_patient;
$$;
revoke all on function ops.bed_occupants(uuid, uuid) from public, anon, authenticated;

-- ---- 3. the rules, with the switches ----
drop function if exists ops.bed_rule_problem(text, text, uuid, uuid, uuid);
create function ops.bed_rule_problem(p_unit_id text, p_sex text, p_family uuid, p_ignore_stay uuid, p_ignore_patient uuid, p_all boolean default false)
returns text language plpgsql stable security definer set search_path to '' as $$
declare
  v_unit ops.units;
  v_room ops.rooms;
  v_other ops.rooms;
  v_single_sex boolean;
  v_fill_order boolean;
  v_night integer;
  v_until time;
begin
  select * into v_unit from ops.units where id = p_unit_id;
  if not found then
    return null;
  end if;

  -- A long-stay family's bed (0163) is theirs until the finalize time.
  select k.night into v_night from ops.kept_beds() k
   where k.unit_id = v_unit.id and k.patient_id is distinct from p_ignore_patient limit 1;
  if v_night is not null
     and (select count(*) from ops.stays s join ops.bed_positions bp on bp.id = s.bed_position_id
           where bp.unit_id = v_unit.id and s.status in ('in_house', 'overdue') and s.id is distinct from p_ignore_stay)
       + (select count(*) from ops.kept_beds() k where k.unit_id = v_unit.id and k.patient_id is distinct from p_ignore_patient)
       >= v_unit.capacity then
    select coalesce(a.admission_finalize_by, '18:00'::time) into v_until from shared.app_settings a where a.id;
    return format('Bed %s is kept for a family on their night %s until %s', v_unit.code, v_night, to_char(coalesce(v_until, '18:00'::time), 'FMHH12:MI AM'));
  end if;

  if v_unit.room_id is null or p_sex is null then
    return null; -- an unplaced bed, or nobody whose sex is known
  end if;
  select a.bed_single_sex, a.bed_fill_order into v_single_sex, v_fill_order from shared.app_settings a where a.id;
  v_single_sex := p_all or coalesce(v_single_sex, true);
  v_fill_order := p_all or coalesce(v_fill_order, true);
  select * into v_room from ops.rooms where id = v_unit.room_id;

  if v_single_sex and exists (select 1 from ops.bed_occupants(p_ignore_stay, p_ignore_patient) o
                               where o.room_id = v_room.id and o.sex is not null and o.sex <> p_sex
                                 and (p_family is null or o.family_id is distinct from p_family)) then
    return format('%s is a %s room now', v_room.name, case when p_sex = 'F' then 'men''s' else 'women''s' end);
  end if;
  if not v_fill_order then
    return null;
  end if;

  -- Regular beds first (0092): for a regular bed, an earlier room that can take this carer and
  -- still has a free regular bed comes first; for a temporary bed, any room's free regular bed
  -- does, and so does an earlier room's free temporary bed (the area below Room 3 comes last).
  -- With single-sex rooms switched off (0163) every room can take them.
  for v_other in
    select * from ops.rooms r
     where (v_unit.temporary and true) or r.sort_order < v_room.sort_order
     order by r.sort_order
  loop
    if not (v_single_sex and exists (select 1 from ops.bed_occupants(p_ignore_stay, p_ignore_patient) o
                                      where o.room_id = v_other.id and o.sex is not null and o.sex <> p_sex
                                        and (p_family is null or o.family_id is distinct from p_family)))
       and exists (select 1 from ops.units u
                    where u.room_id = v_other.id and u.active and u.status = 'available'
                      and (not u.temporary or (v_unit.temporary and v_other.sort_order < v_room.sort_order))
                      and (select count(*) from ops.bed_occupants(p_ignore_stay, p_ignore_patient) o where o.unit_id = u.id) < u.capacity) then
      return format('%s still has a free bed: fill it first', v_other.name);
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function ops.bed_rule_problem(text, text, uuid, uuid, uuid, boolean) from public, anon, authenticated;

-- ---- 5. the trail of placements the switches or a long stay let through ----
create or replace function ops.log_bed_waiver(p_stay_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_stay ops.stays;
  v_unit text;
  v_problem text;
begin
  select * into v_stay from ops.stays where id = p_stay_id;
  select bp.unit_id into v_unit from ops.bed_positions bp where bp.id = v_stay.bed_position_id;
  v_problem := ops.bed_rule_problem(v_unit, ops.stay_sleeper_sex(v_stay.id),
                                    (select p.family_id from ops.patients p where p.id = v_stay.patient_id),
                                    v_stay.id, v_stay.patient_id, true);
  if v_problem is not null then
    insert into ops.bed_rule_exceptions (stay_id, unit_id, rule, reason) values (v_stay.id, v_unit, v_problem, p_reason);
  end if;
end;
$$;
revoke all on function ops.log_bed_waiver(uuid, text) from public, anon, authenticated;


-- ---- 4. tonight's re-admission, check-in and moves (live definitions, changes marked 0163) ----
CREATE OR REPLACE FUNCTION ops.readmit_for_tonight(p_patient_id uuid, p_unit_id text DEFAULT NULL::text, p_exception_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'shared', 'pg_temp'
AS $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_prev ops.stays%rowtype;
  v_patient ops.patients%rowtype;
  v_unit ops.units%rowtype;
  v_unit_id text;
  v_position_id text;
  v_sex text;
  v_allowed text;
  v_stay_id uuid;
  v_prev_unit text;  -- 0163
  v_night integer;
  v_keep smallint;
  v_long boolean := false;
begin
  if not shared.module_editable('patients') then
    raise exception 'Your access to Patients is view only' using errcode = '42501';
  end if;
  select * into v_prev from ops.stays s
    where s.patient_id = p_patient_id and s.check_out_reason = 'daily_reset' and s.check_out_at = v_today
    order by s.check_in_at desc, s.created_at desc limit 1;
  if not found then
    raise exception 'No night to continue: check the child in' using errcode = 'P0002';
  end if;
  select * into v_patient from ops.patients where id = p_patient_id;
  if exists (select 1 from ops.stays where patient_id = p_patient_id and status in ('in_house', 'overdue')) then
    raise exception '% % is already checked in', v_patient.first_name, v_patient.last_name using errcode = '23505';
  end if;

  v_prev_unit := (select bp.unit_id from ops.bed_positions bp where bp.id = v_prev.bed_position_id);
  v_unit_id := coalesce(p_unit_id, v_prev_unit);
  -- 0163: tonight's night of the visit, and from which night a family keeps its bed.
  v_night := (select count(*) from ops.stays v where v.visit_id = v_prev.visit_id)::int + 1;
  select bed_keep_from_night into v_keep from shared.app_settings where id;
  select * into v_unit from ops.units where id = v_unit_id for update;
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

  if v_prev.carer_id is not null then
    select sex into v_sex from ops.carers where id = v_prev.carer_id;
    if v_sex is null then
      raise exception 'Give the carer''s sex: it decides which room they sleep in' using errcode = '23514';
    end if;
  else
    v_sex := v_patient.sex;
  end if;
  if v_keep is not null and v_night >= v_keep and v_unit.id = v_prev_unit then
    v_long := true; -- 0163: a long stay keeps last night's bed, whatever the rooms say
  else
    v_allowed := ops.enforce_bed_rules(v_unit.id, v_sex, v_patient.family_id, null, v_patient.id, p_exception_reason);
  end if;

  insert into ops.stays (patient_id, bed_position_id, carer_id, check_in_at, expected_checkout_at, status, visit_id,
                         arrival_mode, arrival_ride_id, arrival_trip_id)
    values (v_patient.id, v_position_id, v_prev.carer_id, v_today, v_prev.expected_checkout_at, 'in_house', v_prev.visit_id,
            v_prev.arrival_mode, v_prev.arrival_ride_id, v_prev.arrival_trip_id)
    returning id into v_stay_id;
  if v_allowed is not null then
    insert into ops.bed_rule_exceptions (stay_id, unit_id, rule, reason) values (v_stay_id, v_unit.id, v_allowed, btrim(p_exception_reason));
  else
    perform ops.log_bed_waiver(v_stay_id, case when v_long then format('Long stay: same bed as last night, night %s', v_night)
                                               else 'Allowed by Settings: a bed rule is switched off' end); -- 0163
  end if;
  delete from ops.bed_nights bn using ops.stays s
    where bn.night = v_today and bn.bed_position_id = v_position_id
      and s.id = bn.stay_id and s.status not in ('in_house', 'overdue');
  insert into ops.bed_nights (night, stay_id, bed_position_id, confirmed_by)
    values (v_today, v_stay_id, v_position_id, auth.uid());
  return jsonb_build_object('stay_id', v_stay_id, 'visit_id', v_prev.visit_id, 'unit_id', v_unit.id);
end;
$$;

CREATE OR REPLACE FUNCTION ops.check_in(p_unit_id text, p_check_in_at date, p_patient_id uuid DEFAULT NULL::uuid, p_referral_id uuid DEFAULT NULL::uuid, p_carer_id uuid DEFAULT NULL::uuid, p_carer_name text DEFAULT NULL::text, p_carer_relationship text DEFAULT NULL::text, p_carer_mobile text DEFAULT NULL::text, p_expected_checkout_at date DEFAULT NULL::date, p_appt_date date DEFAULT NULL::date, p_appt_time text DEFAULT NULL::text, p_appt_clinic text DEFAULT NULL::text, p_appt_purpose text DEFAULT NULL::text, p_appt_needs_transport boolean DEFAULT false, p_rules_discussed boolean DEFAULT false, p_carer_sex text DEFAULT NULL::text, p_exception_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'shared', 'pg_temp'
AS $$
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
  else
    perform ops.log_bed_waiver(v_stay_id, 'Allowed by Settings: a bed rule is switched off'); -- 0163
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
$$;

CREATE OR REPLACE FUNCTION ops.confirm_night(p_stay_id uuid, p_unit_id text DEFAULT NULL::text, p_exception_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'shared', 'pg_temp'
AS $$
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
    else
      perform ops.log_bed_waiver(v_stay.id, 'Allowed by Settings: a bed rule is switched off'); -- 0163
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
