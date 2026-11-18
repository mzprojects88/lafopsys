-- 0166: one scan, then the service (owner, 19 Nov 2026): Housing, Meals, Transport.
--
--  * Meals are recorded in the app whatever the LAF Programs sheet does (it is still read alongside until
--    Settings switches it off; reports show the higher of the two per day, never the sum). 0165's block
--    "while meals are on the Programs sheet" is gone. A meal may be recorded up to
--    shared.app_settings.meals_back_days (default 60) days back; admins any past day; never a future day.
--  * Transport: a scan makes the child a passenger of an open trip today (scheduled or started). A driver
--    adds to their OWN trip; a Patients editor (social worker, admin) picks one of today's open trips. A scan
--    never creates a trip. Drivers (Transport editors) may now scan; like house staff they see only the
--    name, the carer and the photo.
--  * Housing: "Same bed as last night" or another bed (ops.readmit_for_tonight, with the bed rules); a new
--    arrival goes through the usual Check in, and the scan is logged.
-- No rows are inserted here.

-- ---- settings: how far back a meal may be recorded ----
alter table shared.app_settings add column if not exists meals_back_days smallint not null default 60;
alter table shared.app_settings drop constraint if exists app_settings_meals_back_days_check;
alter table shared.app_settings add constraint app_settings_meals_back_days_check check (meals_back_days between 0 and 365);

create or replace function ops.guard_meals_served()
returns trigger language plpgsql security definer set search_path to 'ops', 'pg_temp' as $$
declare
  manila_today date := (now() at time zone 'Asia/Manila')::date;
  d date := coalesce(new.date, old.date);
  v_back smallint;
begin
  if d > manila_today then
    raise exception 'A meal cannot be recorded for a day still to come' using errcode = '22023';
  end if;
  select meals_back_days into v_back from shared.app_settings where id;
  if d < manila_today - coalesce(v_back, 0) and not shared.has_role('admin') then
    raise exception 'Meals can be recorded up to % days back; ask an admin for an older day', coalesce(v_back, 0) using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.served_by := auth.uid();
    new.served_at := now();
    return new;
  end if;
  return old;
end;
$$;

-- ---- the log: transport too ----
alter table ops.card_scans drop constraint if exists card_scans_purpose_check;
alter table ops.card_scans add constraint card_scans_purpose_check check (purpose in ('look', 'admission', 'meal', 'transport'));

-- ---- who may scan: + drivers (Transport editors) ----
create or replace function ops.may_scan_cards() returns boolean
language sql stable security definer set search_path to '' as $$
  select shared.module_viewable('patients') or shared.module_editable('house_ops') or shared.module_editable('transport');
$$;

-- ---- what a scan shows ----
create or replace function ops.scan_card(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_card ops.patient_cards;
  v_patient ops.patients;
  v_full boolean := shared.module_viewable('patients');
  v_editor boolean := shared.module_editable('patients');
  v_driver boolean := shared.module_editable('transport');
  v_back smallint;
  v_tonight ops.stays;
  v_last ops.stays;
  v_carer ops.carers;
  v_bed text;
  v_last_bed text;
  v_night integer;
  v_newer integer;
begin
  if not ops.may_scan_cards() then
    raise exception 'Your role does not scan ID cards' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('status', 'unknown');
  end if;
  select * into v_card from ops.patient_cards where token = p_token;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  select * into v_patient from ops.patients where id = v_card.patient_id;
  insert into ops.card_scans (card_id, patient_id, purpose) values (v_card.id, v_card.patient_id, 'look');

  if v_card.status <> 'active' then
    select max(version) into v_newer from ops.patient_cards where patient_id = v_card.patient_id and status = 'active';
    return jsonb_build_object(
      'status', v_card.status, 'version', v_card.version, 'endedAt', v_card.ended_at, 'endedReason', v_card.ended_reason,
      'newerVersion', v_newer, 'name', v_patient.first_name || ' ' || v_patient.last_name,
      'patientId', case when v_full then v_patient.id end);
  end if;

  select meals_back_days into v_back from shared.app_settings where id;
  select * into v_tonight from ops.stays where patient_id = v_patient.id and status in ('in_house', 'overdue') order by check_in_at desc limit 1;
  select * into v_last from ops.stays
   where patient_id = v_patient.id and check_out_reason = 'daily_reset' and check_out_at = v_today
   order by check_in_at desc limit 1;
  select u.code into v_bed from ops.bed_positions bp join ops.units u on u.id = bp.unit_id where bp.id = v_tonight.bed_position_id;
  select u.code into v_last_bed from ops.bed_positions bp join ops.units u on u.id = bp.unit_id where bp.id = v_last.bed_position_id;
  if v_last.id is not null then
    v_night := (select count(*) from ops.stays v where v.visit_id = v_last.visit_id)::int + 1;
  end if;
  select * into v_carer from ops.carers where id = coalesce(v_tonight.carer_id, v_last.carer_id);
  if v_carer.id is null then
    select * into v_carer from ops.carers where patient_id = v_patient.id order by effective_from desc nulls last limit 1;
  end if;

  return jsonb_build_object(
    'status', 'active',
    'version', v_card.version,
    'name', v_patient.first_name || ' ' || v_patient.last_name,
    'initials', upper(left(v_patient.first_name, 1) || left(v_patient.last_name, 1)),
    'carer', case when v_carer.id is not null then jsonb_build_object('name', v_carer.name, 'relationship', v_carer.relationship) end,
    'hasPhoto', coalesce(v_patient.photo_consent_granted, false) and exists (
      select 1 from ops.patient_documents d where d.patient_id = v_patient.id and d.document_type = 'patient_photo' and d.storage_path is not null),
    'inHouse', v_tonight.id is not null,
    'canContinue', v_tonight.id is null and v_last.id is not null,
    'today', v_today,
    -- Meals: what is recorded in the app over the days a meal may still be recorded.
    'mealsBackDays', case when shared.has_role('admin') then 365 else coalesce(v_back, 0) end,
    'meals', coalesce((select jsonb_agg(jsonb_build_object('date', m.date, 'meal', m.meal) order by m.date, m.meal)
                         from ops.meals_served m
                        where m.patient_id = v_patient.id and m.date >= v_today - greatest(coalesce(v_back, 0), 0)), '[]'::jsonb),
    'mealsInApp', true,
    'canHousing', v_editor,
    'canAdmit', v_editor,
    'canMeal', v_editor or shared.module_editable('house_ops'),
    'canTransport', v_editor or v_driver,
    -- Transport: today's open trips (a driver: their own), and whether the child is on each.
    'trips', case when v_editor or v_driver then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'direction', t.direction, 'status', t.status, 'departureTime', t.departure_time,
               'driver', (select s.first_name from shared.staff s where s.id = t.driver_staff_id),
               'mine', t.driver_staff_id = auth.uid(),
               'passengers', (select count(*) from ops.trip_passengers tp where tp.trip_id = t.id),
               'onBoard', exists (select 1 from ops.trip_passengers tp where tp.trip_id = t.id and tp.patient_id = v_patient.id))
             order by t.departure_time nulls last, t.created_at)
        from ops.trips t
       where t.date = v_today and t.status in ('scheduled', 'in_progress') and t.direction in ('to_hospital', 'from_hospital')
         and coalesce(t.carries_passengers, true)
         and (v_editor or t.driver_staff_id = auth.uid())), '[]'::jsonb) else '[]'::jsonb end,
    -- Patients viewers only: the record, the case number, the beds.
    'patientId', case when v_full then v_patient.id end,
    'caseNumber', case when v_full then v_patient.case_number end,
    'bed', case when v_full then v_bed end,
    'lastBed', case when v_full then v_last_bed end,
    'night', case when v_full then v_night end
  );
end;
$$;

-- ---- Housing: last night's bed or another bed, with the bed rules ----
drop function if exists ops.readmit_by_card(text);
create function ops.readmit_by_card(p_token text, p_unit_id text default null, p_exception_reason text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_card ops.patient_cards;
  v_result jsonb;
begin
  select * into v_card from ops.patient_cards where token = p_token and status = 'active';
  if not found then
    raise exception 'This card does not work any more' using errcode = 'P0002';
  end if;
  v_result := ops.readmit_for_tonight(v_card.patient_id, p_unit_id, p_exception_reason);
  insert into ops.card_scans (card_id, patient_id, purpose, detail)
    values (v_card.id, v_card.patient_id, 'admission', case when p_unit_id is null then 'same bed as last night' else 'another bed tonight' end);
  return v_result;
end;
$$;

-- A check-in or a bed change made through the usual dialogs after a scan: the trail only.
create or replace function ops.log_card_scan(p_token text, p_purpose text, p_detail text)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_card ops.patient_cards;
begin
  if not shared.module_editable('patients') then
    raise exception 'Your access to Patients is view only' using errcode = '42501';
  end if;
  if p_purpose is null or p_purpose not in ('admission', 'meal', 'transport') then
    raise exception 'Admission, meal or transport' using errcode = '22023';
  end if;
  select * into v_card from ops.patient_cards where token = p_token and status = 'active';
  if not found then
    raise exception 'This card does not work any more' using errcode = 'P0002';
  end if;
  insert into ops.card_scans (card_id, patient_id, purpose, detail) values (v_card.id, v_card.patient_id, p_purpose, left(nullif(btrim(p_detail), ''), 120));
end;
$$;

-- ---- Meals: any day the settings allow, whatever the Programs sheet does ----
drop function if exists ops.record_meal_by_card(text, text);
create function ops.record_meal_by_card(p_token text, p_meal text, p_date date default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_day date := coalesce(p_date, (now() at time zone 'Asia/Manila')::date);
  v_card ops.patient_cards;
  v_added integer;
begin
  if not (shared.module_editable('patients') or shared.module_editable('house_ops')) then
    raise exception 'Your role does not record meals' using errcode = '42501';
  end if;
  if p_meal is null or p_meal not in ('breakfast', 'lunch', 'dinner') then
    raise exception 'Breakfast, lunch or dinner' using errcode = '22023';
  end if;
  select * into v_card from ops.patient_cards where token = p_token and status = 'active';
  if not found then
    raise exception 'This card does not work any more' using errcode = 'P0002';
  end if;
  -- The family stayed that day: a night that started that day or ended that morning.
  if not exists (select 1 from ops.stays s where s.patient_id = v_card.patient_id
                  and s.check_in_at <= v_day and coalesce(s.check_out_at, v_day) >= v_day) then
    raise exception 'This child was not staying at LAF House that day' using errcode = '23514';
  end if;
  -- ops.guard_meals_served checks the day (not to come, not further back than the settings allow).
  insert into ops.meals_served (patient_id, date, meal) values (v_card.patient_id, v_day, p_meal) on conflict do nothing;
  get diagnostics v_added = row_count;
  insert into ops.card_scans (card_id, patient_id, purpose, detail)
    values (v_card.id, v_card.patient_id, 'meal', p_meal || ' ' || v_day || case when v_added = 0 then ' (already recorded)' else '' end);
  return jsonb_build_object('meal', p_meal, 'date', v_day, 'added', v_added = 1);
end;
$$;

-- ---- Transport: a passenger of an open trip today ----
create or replace function ops.add_passenger_by_card(p_token text, p_trip_id uuid, p_people smallint default 2)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_card ops.patient_cards;
  v_trip ops.trips;
  v_editor boolean := shared.module_editable('patients');
  v_added integer;
begin
  if not (v_editor or shared.module_editable('transport')) then
    raise exception 'Your role does not add passengers' using errcode = '42501';
  end if;
  if p_people is null or p_people not between 1 and 6 then
    raise exception 'From 1 to 6 people ride' using errcode = '22023';
  end if;
  select * into v_card from ops.patient_cards where token = p_token and status = 'active';
  if not found then
    raise exception 'This card does not work any more' using errcode = 'P0002';
  end if;
  select * into v_trip from ops.trips where id = p_trip_id for update;
  if not found or v_trip.date <> v_today or v_trip.status not in ('scheduled', 'in_progress')
     or v_trip.direction not in ('to_hospital', 'from_hospital') or not coalesce(v_trip.carries_passengers, true) then
    raise exception 'That trip is not open today' using errcode = '23514';
  end if;
  if not v_editor and v_trip.driver_staff_id is distinct from auth.uid() then
    raise exception 'Only the driver of this trip adds its passengers by scan' using errcode = '42501';
  end if;
  insert into ops.trip_passengers (trip_id, patient_id, people) values (v_trip.id, v_card.patient_id, p_people)
    on conflict (trip_id, patient_id) do update set people = excluded.people;
  get diagnostics v_added = row_count;
  insert into ops.card_scans (card_id, patient_id, purpose, detail)
    values (v_card.id, v_card.patient_id, 'transport',
            case v_trip.direction when 'from_hospital' then 'NCH to LAF' else 'LAF to NCH' end || ', ' || p_people || ' riding');
  return jsonb_build_object('tripId', v_trip.id, 'direction', v_trip.direction, 'people', p_people);
end;
$$;

revoke all on function ops.readmit_by_card(text, text, text), ops.log_card_scan(text, text, text), ops.record_meal_by_card(text, text, date),
                       ops.add_passenger_by_card(text, uuid, smallint) from public, anon;
grant execute on function ops.readmit_by_card(text, text, text), ops.log_card_scan(text, text, text), ops.record_meal_by_card(text, text, date),
                          ops.add_passenger_by_card(text, uuid, smallint) to authenticated;

notify pgrst, 'reload schema';
