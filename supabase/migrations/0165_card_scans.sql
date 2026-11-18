-- 0165: Patient ID cards, phase 2 (owner, 18-19 Nov 2026): what a scan shows and the two things it can do.
--
-- A card's QR opens https://arkos.littlearkfoundation.org/c/<token> (or the Scan page reads it). Who may scan:
-- staff who see Patients, and staff who edit House Ops (house staff record meals by scan: owner, 18 Nov,
-- "Social worker + house staff"). A scan only SHOWS the child; each action is one tap, through the same rules
-- as on House Today:
--   * ops.readmit_by_card: "Same bed as last night" (ops.readmit_for_tonight: Patients editors, bed rules).
--   * ops.record_meal_by_card: a meal served today (ops.meals_served: Patients or House Ops editors), only while
--     meals are recorded in the app (Settings: programs_from_app_since), as House Today's ticks.
-- Every scan and action is logged in ops.card_scans. House staff (no Patients access) get only what a meal
-- needs: the name, the carer, the photo (with consent), today's meals; never the case number or the bed.
-- No rows are inserted here.

create table if not exists ops.card_scans (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references ops.patient_cards (id) on delete cascade deferrable initially immediate,
  patient_id uuid not null references ops.patients (id) on delete cascade deferrable initially immediate,
  purpose text not null check (purpose in ('look', 'admission', 'meal')),
  detail text check (detail is null or char_length(detail) <= 120),
  scanned_by uuid default auth.uid(),
  scanned_at timestamptz not null default now()
);
create index if not exists card_scans_patient on ops.card_scans (patient_id, scanned_at desc);

alter table ops.card_scans enable row level security;
drop policy if exists "patients viewers read card scans" on ops.card_scans;
create policy "patients viewers read card scans" on ops.card_scans for select to authenticated
  using (shared.module_viewable('patients'));
revoke all on ops.card_scans from anon, authenticated;
grant select on ops.card_scans to authenticated;

-- Who may scan a card at all.
create or replace function ops.may_scan_cards() returns boolean
language sql stable security definer set search_path to '' as $$
  select shared.module_viewable('patients') or shared.module_editable('house_ops');
$$;

-- What a scan shows (and the "look" is logged).
create or replace function ops.scan_card(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_card ops.patient_cards;
  v_patient ops.patients;
  v_full boolean := shared.module_viewable('patients');
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
    'mealsToday', coalesce((select jsonb_agg(m.meal order by m.meal) from ops.meals_served m where m.patient_id = v_patient.id and m.date = v_today), '[]'::jsonb),
    'mealsInApp', coalesce((select a.programs_from_app_since <= v_today from shared.app_settings a where a.id), false),
    'canAdmit', shared.module_editable('patients'),
    'canMeal', shared.module_editable('patients') or shared.module_editable('house_ops'),
    -- Patients viewers only: the record, the case number, the beds.
    'patientId', case when v_full then v_patient.id end,
    'caseNumber', case when v_full then v_patient.case_number end,
    'bed', case when v_full then v_bed end,
    'lastBed', case when v_full then v_last_bed end,
    'night', case when v_full then v_night end
  );
end;
$$;

-- "Same bed as last night" from a scan: ops.readmit_for_tonight decides (Patients editors, bed rules), then it is logged.
create or replace function ops.readmit_by_card(p_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_card ops.patient_cards;
  v_result jsonb;
begin
  select * into v_card from ops.patient_cards where token = p_token and status = 'active';
  if not found then
    raise exception 'This card does not work any more' using errcode = 'P0002';
  end if;
  v_result := ops.readmit_for_tonight(v_card.patient_id);
  insert into ops.card_scans (card_id, patient_id, purpose, detail) values (v_card.id, v_card.patient_id, 'admission', 'same bed as last night');
  return v_result;
end;
$$;

-- A meal served today, from a scan.
create or replace function ops.record_meal_by_card(p_token text, p_meal text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_card ops.patient_cards;
  v_added integer;
begin
  if not (shared.module_editable('patients') or shared.module_editable('house_ops')) then
    raise exception 'Your role does not record meals' using errcode = '42501';
  end if;
  if p_meal is null or p_meal not in ('breakfast', 'lunch', 'dinner') then
    raise exception 'Breakfast, lunch or dinner' using errcode = '22023';
  end if;
  if not coalesce((select a.programs_from_app_since <= v_today from shared.app_settings a where a.id), false) then
    raise exception 'Meals are still recorded on the LAF Programs sheet: switch them to the app in Settings first' using errcode = '23514';
  end if;
  select * into v_card from ops.patient_cards where token = p_token and status = 'active';
  if not found then
    raise exception 'This card does not work any more' using errcode = 'P0002';
  end if;
  if not exists (select 1 from ops.stays s where s.patient_id = v_card.patient_id
                  and (s.status in ('in_house', 'overdue') or (s.check_out_reason = 'daily_reset' and s.check_out_at = v_today))) then
    raise exception 'This child is not staying at LAF House' using errcode = '23514';
  end if;
  insert into ops.meals_served (patient_id, date, meal) values (v_card.patient_id, v_today, p_meal) on conflict do nothing;
  get diagnostics v_added = row_count;
  insert into ops.card_scans (card_id, patient_id, purpose, detail) values (v_card.id, v_card.patient_id, 'meal', p_meal || case when v_added = 0 then ' (already recorded)' else '' end);
  return jsonb_build_object('meal', p_meal, 'added', v_added = 1);
end;
$$;

-- The card photo's file, for the photo route: only with consent, only for someone who may scan.
create or replace function ops.card_photo_path(p_token text)
returns text language sql stable security definer set search_path to '' as $$
  select d.storage_path
    from ops.patient_cards c
    join ops.patients p on p.id = c.patient_id and coalesce(p.photo_consent_granted, false)
    join ops.patient_documents d on d.patient_id = c.patient_id and d.document_type = 'patient_photo' and d.storage_path is not null
   where c.token = p_token and c.status = 'active' and ops.may_scan_cards()
   limit 1;
$$;

revoke all on function ops.may_scan_cards(), ops.scan_card(text), ops.readmit_by_card(text), ops.record_meal_by_card(text, text), ops.card_photo_path(text) from public, anon;
grant execute on function ops.may_scan_cards(), ops.scan_card(text), ops.readmit_by_card(text), ops.record_meal_by_card(text, text), ops.card_photo_path(text) to authenticated;

notify pgrst, 'reload schema';
