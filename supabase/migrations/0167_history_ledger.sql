-- 0167: Patients > History, the record of past days (owner, 19 Nov 2026).
-- "A records of history ledger who was admitted on a certain day for an entire month or 2 months, in a list
-- or month calendar view that we can edit: add a patient and assign a bed, availed meals and trips for that
-- day per patient or bulk edit ... a backdating record entry for our housing program, meal and trip."
--
-- Owner's decisions: a month calendar, then a day's list per child (bed, carer, B/L/D, NCH->LAF, LAF->NCH)
-- with bulk edits; "Fill from the sheet" (the House Sheet and the LAF Programs sheet name the people of a
-- day; 94% are matched to a patient); up to 60 days back (the same figure as meals, Settings), older days
-- admin only; Patients editors record nights, beds and meals; rides also Transport editors (drivers).
--
--   1. Settings: history_note_days (a note is needed for days further back than this). The back-limit is
--      meals_back_days (0166), one figure for nights, meals and rides.
--   2. stays.from_history, trips.from_history: rows made here. A past night is a one-night stay closed the
--      next morning, exactly as the 6 AM reset leaves one (check_out_reason 'daily_reset'), so visits,
--      departures and "readmit for tonight" read it like any other night.
--   3. ops.history_days (a day marked complete: the app is that day's record, not the sheets) and
--      ops.history_edits (who changed what, when, and why).
--   4. close_holds_on_stay: a stay inserted already checked out is a record of the past, never an arrival,
--      so it no longer closes the family's current bed holds.
--   5. The functions: history_month, history_day (read); history_save_night, history_remove_nights,
--      history_set_meals, history_set_rides, history_complete_day (write). The browser writes nothing else.
--   6. The records the reports read: nightly_record and meal_record use the app on completed days;
--      program_impact_range_rows counts completed days from the app, and its House Sheet fill (0148) now
--      leaves out only the children the app already has that night (a partly entered night no longer drops
--      everyone else).
--   7. Pages: patients.history (Patients editors) and transport.history (drivers).

-- ---- 1. settings ----
alter table shared.app_settings
  add column if not exists history_note_days smallint not null default 7 check (history_note_days between 0 and 365);

-- ---- 2. markers ----
alter table ops.stays add column if not exists from_history boolean not null default false;
alter table ops.trips add column if not exists from_history boolean not null default false;

-- Only the History functions set the marker: a stay or trip marked by hand could later be deleted with it.
create or replace function ops.guard_from_history()
 returns trigger
 language plpgsql
 set search_path to ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.from_history is distinct from (case when tg_op = 'INSERT' then false else old.from_history end) then
    raise exception 'Past days are entered in Patients > History' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function ops.guard_from_history() from public, anon, authenticated;
drop trigger if exists guard_from_history on ops.stays;
create trigger guard_from_history before insert or update of from_history on ops.stays for each row execute function ops.guard_from_history();
drop trigger if exists guard_from_history on ops.trips;
create trigger guard_from_history before insert or update of from_history on ops.trips for each row execute function ops.guard_from_history();

-- ---- 3. complete days and the trail ----
create table if not exists ops.history_days (
  day date primary key,
  completed_by uuid default auth.uid() references shared.staff(id) deferrable,
  completed_at timestamptz not null default now(),
  note text
);
alter table ops.history_days enable row level security;
-- The reports' views read it as the viewer (security_invoker), so every active staff account reads it; not
-- donors or partners (their sessions are signed in too).
create policy "staff read complete days" on ops.history_days for select to authenticated
  using ((select shared.current_staff_roles()) is not null);
revoke insert, update, delete on ops.history_days from authenticated;
grant select on ops.history_days to authenticated;

create table if not exists ops.history_edits (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  patient_id uuid references ops.patients(id) on delete set null deferrable,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  note text,
  edited_by uuid default auth.uid() references shared.staff(id) deferrable,
  edited_at timestamptz not null default now()
);
create index if not exists history_edits_day_idx on ops.history_edits (day, edited_at desc);
alter table ops.history_edits enable row level security;
create policy "patients and transport viewers read the history trail" on ops.history_edits for select to authenticated
  using ((select shared.module_viewable(variadic array['patients', 'transport'])));
revoke insert, update, delete on ops.history_edits from authenticated;
grant select on ops.history_edits to authenticated;

-- ---- 4. holds: only a stay that starts now closes them ----
create or replace function ops.close_holds_on_stay()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $$
begin
  if new.status = 'checked_out' then
    return null; -- 0167: a past night entered in History is not an arrival
  end if;
  perform ops.close_holds_for_stay(new.id, new.patient_id, new.bed_position_id, null);
  return null;
end;
$$;

-- ---- 5. the functions ----

-- Every write passes here: a day before today, within the back-limit (admins any day), a note for days
-- further back than history_note_days, and the right access.
create or replace function ops.history_guard(p_day date, p_note text, p_what text)
 returns void
 language plpgsql
 stable
 security definer
 set search_path to 'ops', 'shared', 'pg_temp'
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_back smallint;
  v_note_days smallint;
begin
  if p_what in ('nights', 'meals', 'complete') and not shared.module_editable('patients') then
    raise exception 'Recording past nights and meals needs Patients edit' using errcode = '42501';
  end if;
  if p_what = 'rides' and not (shared.module_editable('patients') or shared.module_editable('transport')) then
    raise exception 'Recording past rides needs Patients or Transport edit' using errcode = '42501';
  end if;
  if p_day is null or p_day >= v_today then
    raise exception 'Today is recorded on House Today; History is for the days before' using errcode = '22023';
  end if;
  select meals_back_days, history_note_days into v_back, v_note_days from shared.app_settings where id;
  if p_day < v_today - coalesce(v_back, 0) and not shared.has_role('admin') then
    raise exception 'Past days can be recorded up to % days back; ask an admin for an older day', coalesce(v_back, 0) using errcode = '42501';
  end if;
  if p_day < v_today - coalesce(v_note_days, 7) and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Add a note: why this day is being entered now (needed for days more than % days back)', coalesce(v_note_days, 7) using errcode = '22023';
  end if;
end;
$$;
revoke all on function ops.history_guard(date, text, text) from public, anon, authenticated;

-- An NCH bill that is final, sent or paid is not changed from here: reopen it first.
create or replace function ops.history_caf_locked(p_day date)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'ops', 'pg_temp'
as $$
  select exists (select 1 from ops.caf_billings b
                  where date_trunc('month', b.month) = date_trunc('month', p_day) and b.status <> 'draft');
$$;
revoke all on function ops.history_caf_locked(date) from public, anon, authenticated;

-- The children of one day, as one JSON for the History page.
create or replace function ops.history_day(p_day date)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'ops', 'shared', 'pg_temp'
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_full boolean := shared.module_viewable('patients');
  v_rides boolean := shared.module_viewable('transport');
  v_back smallint;
  v_note_days smallint;
  v_rows jsonb;
  v_sheet jsonb := '[]'::jsonb;
  v_beds jsonb := '[]'::jsonb;
  v_trips jsonb;
  v_edits jsonb;
  v_done jsonb;
begin
  if not (v_full or v_rides) then
    raise exception 'History needs Patients or Transport access' using errcode = '42501';
  end if;
  if p_day is null then
    raise exception 'Give a day' using errcode = '22023';
  end if;
  select meals_back_days, history_note_days into v_back, v_note_days from shared.app_settings where id;

  with kids as (
    select s.patient_id from ops.bed_nights bn join ops.stays s on s.id = bn.stay_id where bn.night = p_day
    union select ms.patient_id from ops.meals_served ms where ms.date = p_day
    union select tp.patient_id from ops.trip_passengers tp join ops.trips t on t.id = tp.trip_id
           where t.date = p_day and t.direction in ('to_hospital', 'from_hospital')
  )
  select coalesce(jsonb_agg(r order by r->>'name'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'patientId', p.id,
      'name', btrim(concat_ws(' ', p.first_name, p.last_name)),
      'caseNumber', case when v_full then p.case_number end,
      'caf', case when v_full then p.caf_billing end,
      'stayed', n.stay_id is not null,
      'nightBefore', exists (select 1 from ops.bed_nights b2 join ops.stays s2 on s2.id = b2.stay_id
                              where b2.night = p_day - 1 and s2.patient_id = p.id),
      'night', case when v_full and n.stay_id is not null then jsonb_build_object(
          'stayId', n.stay_id, 'unitId', n.unit_id, 'unitCode', n.unit_code, 'carerId', n.carer_id, 'carerName', n.carer_name,
          'people', n.people_with_child, 'open', n.status in ('in_house', 'overdue'), 'fromHistory', n.from_history) end,
      'meals', case when v_full then coalesce((select jsonb_agg(ms.meal order by ms.meal) from ops.meals_served ms
                                                where ms.patient_id = p.id and ms.date = p_day), '[]'::jsonb) end,
      'rides', (select coalesce(jsonb_object_agg(t.direction, jsonb_build_object('tripId', t.id, 'people', tp.people)), '{}'::jsonb)
                  from ops.trip_passengers tp join ops.trips t on t.id = tp.trip_id
                 where tp.patient_id = p.id and t.date = p_day and t.direction in ('to_hospital', 'from_hospital')),
      'carers', case when v_full then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'relationship', c.relationship)
                                                          order by c.effective_from desc)
                                                  from ops.carers c where c.patient_id = p.id), '[]'::jsonb) end
    ) as r
    from kids k
    join ops.patients p on p.id = k.patient_id
    left join lateral (
      select bn.stay_id, bp.unit_id, u.code as unit_code, s.carer_id, c.name as carer_name, s.people_with_child, s.status, s.from_history
        from ops.bed_nights bn join ops.stays s on s.id = bn.stay_id
        join ops.bed_positions bp on bp.id = bn.bed_position_id join ops.units u on u.id = bp.unit_id
        left join ops.carers c on c.id = s.carer_id
       where bn.night = p_day and s.patient_id = p.id
       order by bn.confirmed_at limit 1
    ) n on true
  ) x;

  if v_full then
    -- The sheets' people of the day: the House Sheet's night list and the Programs sheet's meal list.
    with names as (
      select sn.name_key, sn.patient_name, sn.carer_name, true as slept from ops.sheet_nights sn where sn.night = p_day
      union all
      select sm.name_key, sm.patient_name, sm.carer_name, false from ops.sheet_meals sm
       where sm.date = p_day and not exists (select 1 from ops.sheet_nights x where x.night = p_day and x.name_key = sm.name_key)
    ),
    people as (
      select distinct on (nm.name_key) nm.*, h.match_status,
             case when h.match_status in ('auto_matched', 'confirmed', 'encoded') then h.matched_patient_id end as patient_id
        from names nm left join ops.house_sheet_people h on h.name_key = nm.name_key
       where coalesce(h.match_status, 'unmatched') <> 'dismissed'
       order by nm.name_key, nm.slept desc
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'nameKey', pp.name_key, 'name', pp.patient_name, 'carer', pp.carer_name, 'slept', pp.slept,
      'patientId', pp.patient_id, 'matchStatus', coalesce(pp.match_status, 'unmatched'),
      'meals', coalesce((select jsonb_agg(m.meal) from ops.sheet_meals sm
                          cross join lateral (values ('breakfast', sm.breakfast), ('lunch', sm.lunch), ('dinner', sm.dinner)) m(meal, people)
                         where sm.date = p_day and sm.name_key = pp.name_key and m.people > 0), '[]'::jsonb),
      -- The bed: the one the child had the night before, else the night after, when it is free tonight.
      'suggestedUnitId', (select bp.unit_id from ops.bed_nights b join ops.stays s on s.id = b.stay_id join ops.bed_positions bp on bp.id = b.bed_position_id
                           where s.patient_id = pp.patient_id and b.night in (p_day - 1, p_day + 1)
                             and exists (select 1 from ops.bed_positions fp where fp.unit_id = bp.unit_id
                                          and not exists (select 1 from ops.bed_nights o where o.night = p_day and o.bed_position_id = fp.id))
                           order by b.night limit 1),
      -- The carer: the one the sheet names, else the one on file for that day.
      'suggestedCarerId', coalesce(
          (select c.id from ops.carers c where c.patient_id = pp.patient_id and lower(btrim(c.name)) = lower(btrim(pp.carer_name)) limit 1),
          (select c.id from ops.carers c where c.patient_id = pp.patient_id and c.effective_from <= p_day
              and (c.effective_to is null or c.effective_to >= p_day) order by c.effective_from desc limit 1))
    ) order by pp.patient_name), '[]'::jsonb) into v_sheet
    from people pp;

    select coalesce(jsonb_agg(jsonb_build_object(
      'unitId', u.id, 'code', u.code, 'room', r.name, 'capacity', u.capacity, 'temporary', u.temporary,
      'taken', (select count(*) from ops.bed_nights b join ops.bed_positions bp on bp.id = b.bed_position_id
                 where b.night = p_day and bp.unit_id = u.id)
    ) order by r.sort_order nulls last, u.code), '[]'::jsonb) into v_beds
    from ops.units u left join ops.rooms r on r.id = u.room_id
    where u.active or exists (select 1 from ops.bed_nights b join ops.bed_positions bp on bp.id = b.bed_position_id
                               where b.night = p_day and bp.unit_id = u.id);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'direction', t.direction, 'time', t.departure_time, 'vehicle', t.vehicle, 'status', t.status,
    'fromHistory', t.from_history, 'mine', t.driver_staff_id = auth.uid(),
    'driver', (select s.first_name from shared.staff s where s.id = t.driver_staff_id),
    'riders', (select count(*) from ops.trip_passengers tp where tp.trip_id = t.id)
  ) order by t.direction, t.departure_time), '[]'::jsonb) into v_trips
  from ops.trips t where t.date = p_day and t.direction in ('to_hospital', 'from_hospital');

  select coalesce(jsonb_agg(jsonb_build_object(
    'at', e.edited_at, 'by', (select s.first_name from shared.staff s where s.id = e.edited_by), 'action', e.action,
    'patient', (select btrim(concat_ws(' ', p.first_name, p.last_name)) from ops.patients p where p.id = e.patient_id),
    'detail', e.detail, 'note', e.note
  ) order by e.edited_at desc), '[]'::jsonb) into v_edits
  from (select * from ops.history_edits where day = p_day
          and (v_full or action like 'ride%')
        order by edited_at desc limit 40) e;

  select jsonb_build_object('at', d.completed_at, 'by', (select s.first_name from shared.staff s where s.id = d.completed_by), 'note', d.note)
    into v_done from ops.history_days d where d.day = p_day;

  return jsonb_build_object(
    'day', p_day, 'today', v_today, 'backDays', coalesce(v_back, 0), 'noteDays', coalesce(v_note_days, 7),
    'full', v_full, 'isAdmin', shared.has_role('admin'),
    'canNights', shared.module_editable('patients'),
    'canRides', shared.module_editable('patients') or shared.module_editable('transport'),
    'inWindow', p_day < v_today and (p_day >= v_today - coalesce(v_back, 0) or shared.has_role('admin')),
    'cafLocked', ops.history_caf_locked(p_day),
    'completed', v_done, 'rows', v_rows, 'sheet', v_sheet, 'beds', v_beds, 'trips', v_trips, 'edits', v_edits);
end;
$$;
revoke all on function ops.history_day(date) from public, anon;
grant execute on function ops.history_day(date) to authenticated;

-- The calendar: per day, the app's and the sheets' counts and whether the day is complete.
create or replace function ops.history_month(p_from date, p_to date)
 returns table (day date, app_children integer, sheet_children integer, app_meals integer, sheet_meals integer,
                app_rides integer, sheet_rides integer, completed boolean)
 language plpgsql
 stable
 security definer
 set search_path to 'ops', 'shared', 'pg_temp'
as $$
begin
  if not shared.module_viewable(variadic array['patients', 'transport']) then
    raise exception 'History needs Patients or Transport access' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 93 then
    raise exception 'Give up to three months' using errcode = '22023';
  end if;
  return query
  select x.d,
    (select count(distinct s.patient_id) from ops.bed_nights b join ops.stays s on s.id = b.stay_id where b.night = d)::int,
    (select count(*) from ops.sheet_nights sn left join ops.house_sheet_people h on h.name_key = sn.name_key
      where sn.night = d and coalesce(h.match_status, 'unmatched') <> 'dismissed')::int,
    (select count(*) from ops.meals_served ms where ms.date = d)::int,
    (select coalesce(sum((sm.breakfast > 0)::int + (sm.lunch > 0)::int + (sm.dinner > 0)::int), 0) from ops.sheet_meals sm where sm.date = d)::int,
    (select coalesce(sum(tp.people), 0) from ops.trip_passengers tp join ops.trips t on t.id = tp.trip_id
      where t.date = d and t.direction in ('to_hospital', 'from_hospital'))::int,
    (select coalesce(sum(coalesce(sr.to_nch, 0) + coalesce(sr.to_laf, 0)), 0) from ops.sheet_rides sr where sr.date = d)::int,
    exists (select 1 from ops.history_days hd where hd.day = d)
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  cross join lateral (select g::date as d) x;
end;
$$;
revoke all on function ops.history_month(date, date) from public, anon;
grant execute on function ops.history_month(date, date) to authenticated;

-- Save one child's night: add it (a one-night stay closed the next morning) or change its bed, carer and
-- people with the child. One bed holds one child a night (bed_nights' own unique key).
create or replace function ops.history_save_night(p_day date, p_patient_id uuid, p_unit_id text,
                                                  p_carer_id uuid default null, p_people smallint default null, p_note text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'ops', 'shared', 'pg_temp'
as $$
declare
  v_patient ops.patients%rowtype;
  v_unit ops.units%rowtype;
  v_bn ops.bed_nights%rowtype;
  v_stay ops.stays%rowtype;
  v_position text;
  v_visit uuid;
  v_next uuid;
  v_carer uuid;
  v_people smallint;
  v_stay_id uuid;
begin
  perform ops.history_guard(p_day, p_note, 'nights');
  select * into v_patient from ops.patients where id = p_patient_id;
  if not found then
    raise exception 'No such patient' using errcode = 'P0002';
  end if;
  if v_patient.caf_billing and ops.history_caf_locked(p_day) then
    raise exception 'The NCH bill for that month is final; reopen it before changing its nights' using errcode = '42501';
  end if;
  if p_people is not null and (p_people < 0 or p_people > 6) then
    raise exception 'People with the child: 0 to 6' using errcode = '22023';
  end if;
  if p_carer_id is not null and not exists (select 1 from ops.carers where id = p_carer_id and patient_id = p_patient_id) then
    raise exception 'That carer is not on this child''s file' using errcode = '22023';
  end if;
  select * into v_unit from ops.units where id = p_unit_id;
  if not found then
    raise exception 'Choose a bed' using errcode = '22023';
  end if;
  -- One save at a time per child and night (bed_nights has no per-child key).
  perform pg_advisory_xact_lock(hashtext('history:' || p_patient_id::text || ':' || p_day::text));

  select bn.* into v_bn from ops.bed_nights bn join ops.stays s on s.id = bn.stay_id
   where bn.night = p_day and s.patient_id = p_patient_id order by bn.confirmed_at limit 1;
  if found then
    select * into v_stay from ops.stays where id = v_bn.stay_id for update;
    if v_stay.status in ('in_house', 'overdue') then
      raise exception 'That night is still open on House Today; change it there' using errcode = '55000';
    end if;
  end if;

  -- The bed: keep the child's place in the same bed, else the first free place in it that night.
  select bp.id into v_position from ops.bed_positions bp
   where bp.unit_id = v_unit.id
     and not exists (select 1 from ops.bed_nights o where o.night = p_day and o.bed_position_id = bp.id and o.id is distinct from v_bn.id)
   order by (bp.id = v_bn.bed_position_id) desc, bp.label limit 1;
  if v_position is null then
    raise exception 'Bed % is taken that night', v_unit.code using errcode = '23505';
  end if;

  if v_bn.id is not null then
    update ops.bed_nights set bed_position_id = v_position, confirmed_by = auth.uid(), confirmed_at = now() where id = v_bn.id;
    -- A night of its own (every night since 0089, and those made here) carries the bed, carer and people.
    if v_stay.from_history or v_stay.check_in_at = p_day then
      update ops.stays set bed_position_id = v_position,
                           carer_id = coalesce(p_carer_id, carer_id),
                           people_with_child = coalesce(p_people, people_with_child)
       where id = v_stay.id;
    end if;
    insert into ops.history_edits (day, patient_id, action, detail, note)
      values (p_day, p_patient_id, 'night_changed',
              jsonb_build_object('bed', v_unit.code, 'carerId', p_carer_id, 'people', p_people), nullif(btrim(p_note), ''));
    return jsonb_build_object('stayId', v_stay.id, 'unitId', v_unit.id, 'bedPositionId', v_position, 'added', false);
  end if;

  -- A new night: the same visit as the night before when there is one.
  select coalesce(s.visit_id, s.id), s.carer_id, s.people_with_child into v_visit, v_carer, v_people
    from ops.bed_nights b join ops.stays s on s.id = b.stay_id
   where b.night = p_day - 1 and s.patient_id = p_patient_id order by b.confirmed_at limit 1;
  v_carer := coalesce(p_carer_id, v_carer,
    (select c.id from ops.carers c where c.patient_id = p_patient_id and c.effective_from <= p_day
        and (c.effective_to is null or c.effective_to >= p_day) order by c.effective_from desc limit 1));
  -- The visit is set here: left empty, stay_visit_default would join it to whatever visit this morning's
  -- reset closed.
  v_stay_id := gen_random_uuid();
  insert into ops.stays (id, patient_id, bed_position_id, carer_id, check_in_at, check_out_at, check_out_reason, status, visit_id, from_history)
    values (v_stay_id, p_patient_id, v_position, v_carer, p_day, p_day + 1, 'daily_reset', 'checked_out', coalesce(v_visit, v_stay_id), true);
  -- carry_people_with_child copies the visit's count on insert; the count given here wins.
  update ops.stays set people_with_child = coalesce(p_people, v_people, people_with_child) where id = v_stay_id;
  select coalesce(visit_id, id) into v_visit from ops.stays where id = v_stay_id;
  -- The nights after it join the same visit.
  select coalesce(s.visit_id, s.id) into v_next from ops.bed_nights b join ops.stays s on s.id = b.stay_id
   where b.night = p_day + 1 and s.patient_id = p_patient_id order by b.confirmed_at limit 1;
  if v_next is not null and v_next <> v_visit then
    update ops.stays set visit_id = v_visit where patient_id = p_patient_id and coalesce(visit_id, id) = v_next;
  end if;
  insert into ops.bed_nights (night, stay_id, bed_position_id, confirmed_by) values (p_day, v_stay_id, v_position, auth.uid());
  insert into ops.history_edits (day, patient_id, action, detail, note)
    values (p_day, p_patient_id, 'night_added',
            jsonb_build_object('bed', v_unit.code, 'carerId', v_carer, 'people', p_people), nullif(btrim(p_note), ''));
  return jsonb_build_object('stayId', v_stay_id, 'unitId', v_unit.id, 'bedPositionId', v_position, 'added', true);
end;
$$;
revoke all on function ops.history_save_night(date, uuid, text, uuid, smallint, text) from public, anon;
grant execute on function ops.history_save_night(date, uuid, text, uuid, smallint, text) to authenticated;

-- Take nights off a day. A night made here goes with its stay; a night of an older stay leaves the stay.
-- That day's meals go too unless the night before still covers them (breakfast the morning after).
create or replace function ops.history_remove_nights(p_day date, p_patient_ids uuid[], p_note text default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'ops', 'shared', 'pg_temp'
as $$
declare
  v_id uuid;
  v_bn ops.bed_nights%rowtype;
  v_stay ops.stays%rowtype;
  v_after uuid;
  v_done integer := 0;
  v_meals integer;
begin
  perform ops.history_guard(p_day, p_note, 'nights');
  if coalesce(cardinality(p_patient_ids), 0) = 0 or cardinality(p_patient_ids) > 40 then
    raise exception 'Choose 1 to 40 children' using errcode = '22023';
  end if;
  foreach v_id in array p_patient_ids loop
    perform pg_advisory_xact_lock(hashtext('history:' || v_id::text || ':' || p_day::text));
    select bn.* into v_bn from ops.bed_nights bn join ops.stays s on s.id = bn.stay_id
     where bn.night = p_day and s.patient_id = v_id order by bn.confirmed_at limit 1;
    continue when not found;
    select * into v_stay from ops.stays where id = v_bn.stay_id for update;
    if v_stay.status in ('in_house', 'overdue') then
      raise exception 'That night is still open on House Today; change it there' using errcode = '55000';
    end if;
    if (select caf_billing from ops.patients where id = v_id) and ops.history_caf_locked(p_day) then
      raise exception 'The NCH bill for that month is final; reopen it before changing its nights' using errcode = '42501';
    end if;
    delete from ops.bed_nights where id = v_bn.id;
    if v_stay.from_history and not exists (select 1 from ops.bed_nights where stay_id = v_stay.id) then
      -- The nights after this one start a visit of their own.
      select s.id into v_after from ops.bed_nights b join ops.stays s on s.id = b.stay_id
       where b.night = p_day + 1 and s.patient_id = v_id order by b.confirmed_at limit 1;
      if v_after is not null then
        update ops.stays set visit_id = v_after
         where patient_id = v_id and coalesce(visit_id, id) = coalesce(v_stay.visit_id, v_stay.id) and check_in_at > p_day;
      end if;
      delete from ops.stays where id = v_stay.id;
    end if;
    v_meals := 0;
    if not exists (select 1 from ops.bed_nights b join ops.stays s on s.id = b.stay_id where b.night = p_day - 1 and s.patient_id = v_id) then
      delete from ops.meals_served where patient_id = v_id and date = p_day;
      get diagnostics v_meals = row_count;
    end if;
    insert into ops.history_edits (day, patient_id, action, detail, note)
      values (p_day, v_id, 'night_removed', jsonb_build_object('mealsRemoved', v_meals), nullif(btrim(p_note), ''));
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;
revoke all on function ops.history_remove_nights(date, uuid[], text) from public, anon;
grant execute on function ops.history_remove_nights(date, uuid[], text) to authenticated;

-- Breakfast, lunch and dinner on or off for some children of a day. A meal needs a night that covers the
-- day: that night, or the night before (breakfast before leaving).
create or replace function ops.history_set_meals(p_day date, p_patient_ids uuid[], p_meals text[], p_on boolean, p_note text default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'ops', 'shared', 'pg_temp'
as $$
declare
  v_id uuid;
  v_name text;
  v_count integer;
  v_done integer := 0;
begin
  perform ops.history_guard(p_day, p_note, 'meals');
  if coalesce(cardinality(p_patient_ids), 0) = 0 or cardinality(p_patient_ids) > 40 then
    raise exception 'Choose 1 to 40 children' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_meals), 0) = 0 or not (p_meals <@ array['breakfast', 'lunch', 'dinner']) then
    raise exception 'Meals are breakfast, lunch and dinner' using errcode = '22023';
  end if;
  foreach v_id in array p_patient_ids loop
    if p_on then
      if not exists (select 1 from ops.bed_nights b join ops.stays s on s.id = b.stay_id
                      where b.night in (p_day, p_day - 1) and s.patient_id = v_id) then
        select btrim(concat_ws(' ', first_name, last_name)) into v_name from ops.patients where id = v_id;
        raise exception '% has no night at LAF House that day or the night before: add the night first', coalesce(v_name, 'A child')
          using errcode = '22023';
      end if;
      insert into ops.meals_served (patient_id, date, meal) select v_id, p_day, m from unnest(p_meals) m
        on conflict do nothing;
    else
      delete from ops.meals_served where patient_id = v_id and date = p_day and meal = any (p_meals);
    end if;
    get diagnostics v_count = row_count;
    if v_count > 0 then
      insert into ops.history_edits (day, patient_id, action, detail, note)
        values (p_day, v_id, case when p_on then 'meals_added' else 'meals_removed' end, jsonb_build_object('meals', to_jsonb(p_meals)), nullif(btrim(p_note), ''));
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;
revoke all on function ops.history_set_meals(date, uuid[], text[], boolean, text) from public, anon;
grant execute on function ops.history_set_meals(date, uuid[], text[], boolean, text) to authenticated;

-- Rides between LAF House and NCH on a past day. A rider joins that day's trip in that direction (the one
-- given, else the first; a driver only their own); without one, a trip "entered in History" is made, with
-- no vehicle or odometer. Taking the last rider off such a trip removes the trip.
create or replace function ops.history_set_rides(p_day date, p_patient_ids uuid[], p_direction text, p_on boolean,
                                                 p_people smallint default 2, p_trip_id uuid default null, p_note text default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'ops', 'shared', 'pg_temp'
as $$
declare
  v_editor boolean := shared.module_editable('patients');
  v_trip ops.trips%rowtype;
  v_id uuid;
  v_count integer;
  v_done integer := 0;
begin
  perform ops.history_guard(p_day, p_note, 'rides');
  if p_direction is null or p_direction not in ('to_hospital', 'from_hospital') then
    raise exception 'A ride is LAF House to NCH or NCH to LAF House' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_patient_ids), 0) = 0 or cardinality(p_patient_ids) > 40 then
    raise exception 'Choose 1 to 40 children' using errcode = '22023';
  end if;
  if (select count(*) from ops.patients where id = any (p_patient_ids)) <> cardinality(p_patient_ids) then
    raise exception 'A patient is no longer on file' using errcode = 'P0002';
  end if;

  if p_on then
    if p_people is null or p_people < 1 or p_people > 6 then
      raise exception 'People riding: 1 to 6' using errcode = '22023';
    end if;
    if p_trip_id is not null then
      select * into v_trip from ops.trips where id = p_trip_id;
      if not found or v_trip.date <> p_day or v_trip.direction <> p_direction then
        raise exception 'That trip is not on this day in this direction' using errcode = '22023';
      end if;
      if not v_editor and v_trip.driver_staff_id is distinct from auth.uid() then
        raise exception 'A driver adds riders to their own trips' using errcode = '42501';
      end if;
    else
      select * into v_trip from ops.trips t
       where t.date = p_day and t.direction = p_direction and (v_editor or t.driver_staff_id = auth.uid())
       order by t.from_history, t.departure_time, t.created_at limit 1;
      if not found then
        insert into ops.trips (date, direction, driver_staff_id, vehicle, departure_time, status, carries_passengers, from_history)
          values (p_day, p_direction, case when v_editor then null else auth.uid() end,
                  'Not recorded (entered in History)', 'Not recorded', 'completed', true, true)
          returning * into v_trip;
      end if;
    end if;
    foreach v_id in array p_patient_ids loop
      -- A child rides once each way a day: an existing ride that way is kept as it is.
      continue when exists (select 1 from ops.trip_passengers tp join ops.trips t on t.id = tp.trip_id
                             where tp.patient_id = v_id and t.date = p_day and t.direction = p_direction and t.id <> v_trip.id);
      insert into ops.trip_passengers (trip_id, patient_id, people) values (v_trip.id, v_id, p_people)
        on conflict (trip_id, patient_id) do update set people = excluded.people;
      insert into ops.history_edits (day, patient_id, action, detail, note)
        values (p_day, v_id, 'ride_added', jsonb_build_object('direction', p_direction, 'tripId', v_trip.id, 'people', p_people), nullif(btrim(p_note), ''));
      v_done := v_done + 1;
    end loop;
  else
    foreach v_id in array p_patient_ids loop
      delete from ops.trip_passengers tp using ops.trips t
       where t.id = tp.trip_id and tp.patient_id = v_id and t.date = p_day and t.direction = p_direction
         and (v_editor or t.driver_staff_id = auth.uid());
      get diagnostics v_count = row_count;
      if v_count > 0 then
        insert into ops.history_edits (day, patient_id, action, detail, note)
          values (p_day, v_id, 'ride_removed', jsonb_build_object('direction', p_direction), nullif(btrim(p_note), ''));
        v_done := v_done + 1;
      end if;
    end loop;
    delete from ops.trips t where t.date = p_day and t.direction = p_direction and t.from_history
       and not exists (select 1 from ops.trip_passengers tp where tp.trip_id = t.id)
       and not exists (select 1 from ops.trip_manifest m where m.trip_id = t.id);
  end if;
  return v_done;
end;
$$;
revoke all on function ops.history_set_rides(date, uuid[], text, boolean, smallint, uuid, text) from public, anon;
grant execute on function ops.history_set_rides(date, uuid[], text, boolean, smallint, uuid, text) to authenticated;

-- A day complete: from then on the reports read the app for it, not the sheets. With fewer children in the
-- app than the House Sheet lists, the person confirms it and says why.
create or replace function ops.history_complete_day(p_day date, p_complete boolean, p_note text default null, p_fewer_ok boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'ops', 'shared', 'pg_temp'
as $$
declare
  v_app integer;
  v_sheet integer;
begin
  perform ops.history_guard(p_day, p_note, 'complete');
  if ops.history_caf_locked(p_day) then
    raise exception 'The NCH bill for that month is final; reopen it first' using errcode = '42501';
  end if;
  if not p_complete then
    delete from ops.history_days where day = p_day;
    insert into ops.history_edits (day, action, note) values (p_day, 'day_reopened', nullif(btrim(p_note), ''));
    return jsonb_build_object('completed', false);
  end if;
  if exists (select 1 from ops.bed_nights b join ops.stays s on s.id = b.stay_id where b.night = p_day and s.status in ('in_house', 'overdue')) then
    raise exception 'That night is still open on House Today; finish it there first' using errcode = '55000';
  end if;
  select count(distinct s.patient_id) into v_app from ops.bed_nights b join ops.stays s on s.id = b.stay_id where b.night = p_day;
  select count(*) into v_sheet from ops.sheet_nights sn left join ops.house_sheet_people h on h.name_key = sn.name_key
   where sn.night = p_day and coalesce(h.match_status, 'unmatched') <> 'dismissed';
  if v_app < v_sheet and not (p_fewer_ok and nullif(btrim(coalesce(p_note, '')), '') is not null) then
    raise exception 'The app has % children that night and the House Sheet % : confirm and add a note to complete the day with fewer', v_app, v_sheet
      using errcode = 'P0001', hint = 'fewer';
  end if;
  insert into ops.history_days (day, note) values (p_day, nullif(btrim(p_note), ''))
    on conflict (day) do update set completed_by = auth.uid(), completed_at = now(), note = excluded.note;
  insert into ops.history_edits (day, action, detail, note)
    values (p_day, 'day_completed', jsonb_build_object('children', v_app, 'sheet', v_sheet), nullif(btrim(p_note), ''));
  return jsonb_build_object('completed', true, 'children', v_app, 'sheet', v_sheet);
end;
$$;
revoke all on function ops.history_complete_day(date, boolean, text, boolean) from public, anon;
grant execute on function ops.history_complete_day(date, boolean, text, boolean) to authenticated;

-- ---- 6. the records the reports read ----
create or replace view ops.nightly_record with (security_invoker = true) as
 WITH cut AS (
         SELECT COALESCE(( SELECT app_settings.nights_from_app_since
                   FROM shared.app_settings
                  WHERE app_settings.id), 'infinity'::date) AS since
        ), sheet AS (
         SELECT DISTINCT ON (h.matched_patient_id, sn.night) h.matched_patient_id AS patient_id,
            sn.night,
            sn.first_synced_at AS recorded_at,
            sn.carer_name
           FROM ops.sheet_nights sn
             JOIN ops.house_sheet_people h ON h.name_key = sn.name_key
          WHERE (h.match_status = ANY (ARRAY['auto_matched'::text, 'confirmed'::text, 'encoded'::text])) AND h.matched_patient_id IS NOT NULL AND sn.night < (( SELECT cut.since
                   FROM cut))
            AND NOT (EXISTS ( SELECT 1 FROM ops.history_days hd WHERE hd.day = sn.night)) -- 0167: a complete day is the app's
          ORDER BY h.matched_patient_id, sn.night, sn.first_synced_at
        ), sheet_runs AS (
         SELECT s.patient_id,
            s.night,
            s.recorded_at,
            s.carer_name,
            s.night - row_number() OVER (PARTITION BY s.patient_id ORDER BY s.night)::integer AS run
           FROM sheet s
        ), app AS (
         SELECT DISTINCT ON (st.patient_id, bn.night) st.patient_id,
            bn.night,
            bn.confirmed_at AS recorded_at,
            bn.bed_position_id,
            COALESCE(st.visit_id, st.id) AS visit_id,
            ( SELECT c.name
                   FROM ops.carers c
                  WHERE c.id = st.carer_id) AS carer_name
           FROM ops.bed_nights bn
             JOIN ops.stays st ON st.id = bn.stay_id
          ORDER BY st.patient_id, bn.night, bn.confirmed_at
        )
 SELECT r.patient_id,
    r.night,
    'sheet'::text AS source,
    r.recorded_at,
    a.bed_position_id,
    r.carer_name,
    (r.patient_id::text || ':'::text) || r.run::text AS visit_key,
    min(r.night) OVER (PARTITION BY r.patient_id, r.run) AS visit_start
   FROM sheet_runs r
     LEFT JOIN app a ON a.patient_id = r.patient_id AND a.night = r.night
UNION ALL
 SELECT a.patient_id,
    a.night,
    'app'::text AS source,
    a.recorded_at,
    a.bed_position_id,
    a.carer_name,
    a.visit_id::text AS visit_key,
    ( SELECT min(s2.check_in_at) AS min
           FROM ops.stays s2
          WHERE COALESCE(s2.visit_id, s2.id) = a.visit_id) AS visit_start
   FROM app a
  WHERE a.night >= (( SELECT cut.since
           FROM cut)) OR NOT (EXISTS ( SELECT 1
           FROM ops.sheet_nights x
          WHERE x.night = a.night))
     OR (EXISTS ( SELECT 1 FROM ops.history_days hd WHERE hd.day = a.night)); -- 0167

create or replace view ops.meal_record with (security_invoker = true) as
 WITH cut AS (
         SELECT COALESCE(( SELECT app_settings.programs_from_app_since
                   FROM shared.app_settings
                  WHERE app_settings.id), 'infinity'::date) AS since
        )
 SELECT DISTINCT ON (h.matched_patient_id, sm.date, m.meal) h.matched_patient_id AS patient_id,
    sm.date,
    m.meal,
    m.people,
    'sheet'::text AS source
   FROM ops.sheet_meals sm
     JOIN ops.house_sheet_people h ON h.name_key = sm.name_key
     CROSS JOIN LATERAL ( VALUES ('breakfast'::text,sm.breakfast), ('lunch'::text,sm.lunch), ('dinner'::text,sm.dinner)) m(meal, people)
  WHERE m.people > 0 AND sm.date < (( SELECT cut.since
           FROM cut)) AND (h.match_status = ANY (ARRAY['auto_matched'::text, 'confirmed'::text, 'encoded'::text])) AND h.matched_patient_id IS NOT NULL
    AND NOT (EXISTS ( SELECT 1 FROM ops.history_days hd WHERE hd.day = sm.date)) -- 0167
UNION ALL
 SELECT ms.patient_id,
    ms.date,
    ms.meal,
    2 AS people,
    'app'::text AS source
   FROM ops.meals_served ms
  WHERE ms.date >= (( SELECT cut.since
           FROM cut)) OR NOT (EXISTS ( SELECT 1
           FROM ops.sheet_meals x
          WHERE x.date = ms.date))
     OR (EXISTS ( SELECT 1 FROM ops.history_days hd WHERE hd.day = ms.date)); -- 0167

-- The Programs report: a complete day counts from the app in the "from sheet" column too, so the column
-- the report shows (the larger of the two per period) never mixes a day twice.
create or replace function ops.program_impact_range_rows(p_from date, p_to date, p_grain text)
 returns table(line text, bucket date, native numeric, from_sheet numeric)
 language sql
 stable security definer
 set search_path to 'ops', 'inventory', 'pg_temp'
as $function$
  with months as (select generate_series(date_trunc(p_grain, p_from::timestamp), p_to::timestamp, ('1 ' || p_grain)::interval)::date as m),
  done as (select hd.day from ops.history_days hd where hd.day between p_from and p_to), -- 0167
  lines as (
    select unnest(array['housing', 'transport_to_nch', 'transport_to_laf', 'meals_breakfast', 'meals_lunch', 'meals_dinner',
                        'care_cart_1000', 'care_cart_1200', 'care_cart_1700', 'care_cart_volunteers',
                        'center_nch_participants', 'center_nch_hours', 'center_nch_volunteers', 'center_laf_volunteers', 'caf_nights']) as l
  ),
  native as (
    select 'housing' as l, date_trunc(p_grain, bn.night)::date as m, sum(1 + s.people_with_child)::numeric as v
      from ops.bed_nights bn join ops.stays s on s.id = bn.stay_id where bn.night between p_from and p_to group by 2
    union all
    select case t.direction when 'to_hospital' then 'transport_to_nch' else 'transport_to_laf' end, date_trunc(p_grain, t.date)::date, sum(tp.people)::numeric
      from ops.trips t join ops.trip_passengers tp on tp.trip_id = t.id
     where t.date between p_from and p_to and t.status <> 'cancelled' and t.direction in ('to_hospital', 'from_hospital') group by 1, 2
    union all
    select 'meals_' || ms.meal, date_trunc(p_grain, ms.date)::date, sum(1 + coalesce(st.people_with_child, 1))::numeric
      from ops.meals_served ms
      left join lateral (select people_with_child from ops.stays s where s.patient_id = ms.patient_id and s.check_in_at::date <= ms.date
                           and (s.check_out_at is null or s.check_out_at::date >= ms.date) order by s.check_in_at desc limit 1) st on true
     where ms.date between p_from and p_to group by 1, 2
    union all
    select 'care_cart_' || replace(c.time_slot, ':', ''), date_trunc(p_grain, c.date)::date, sum(coalesce(c.served_count, 0))::numeric
      from inventory.care_cart_runs c where c.sheet_key is null and c.delivery_status <> 'cancelled' and c.date between p_from and p_to and c.time_slot in ('10:00', '12:00', '17:00') group by 1, 2
    union all
    select 'care_cart_volunteers', date_trunc(p_grain, c.date)::date, sum(coalesce(c.volunteer_count, 0))::numeric
      from inventory.care_cart_runs c where c.sheet_key is null and c.delivery_status <> 'cancelled' and c.date between p_from and p_to group by 2
    union all
    select 'center_nch_participants', date_trunc(p_grain, a.date)::date, sum(a.participants)::numeric from ops.activity_sessions a where a.source = 'app' and a.site = 'NCH' and a.date between p_from and p_to group by 2
    union all
    select 'center_nch_hours', date_trunc(p_grain, a.date)::date, sum(a.hours)::numeric from ops.activity_sessions a where a.source = 'app' and a.site = 'NCH' and a.date between p_from and p_to group by 2
    union all
    select 'center_nch_volunteers', date_trunc(p_grain, a.date)::date, sum(a.volunteer_count)::numeric from ops.activity_sessions a where a.source = 'app' and a.site = 'NCH' and a.date between p_from and p_to group by 2
    union all
    select 'center_laf_volunteers', date_trunc(p_grain, a.date)::date, sum(a.volunteer_count)::numeric from ops.activity_sessions a where a.source = 'app' and a.site = 'LAF' and a.date between p_from and p_to group by 2
    union all
    select 'caf_nights', date_trunc(p_grain, bn.night)::date, count(*)::numeric
      from ops.bed_nights bn join ops.stays s on s.id = bn.stay_id join ops.patients p on p.id = s.patient_id
     where p.caf_billing and bn.night between p_from and p_to group by 2
  ),
  from_sheet as (
    select 'housing' as l, date_trunc(p_grain, sm.date)::date as m, sum(coalesce(sm.bn, 0))::numeric as v from ops.sheet_meals sm where sm.date between p_from and p_to and sm.date not in (select day from done) group by 2
    union all
    select 'transport_to_nch', date_trunc(p_grain, sr.date)::date, sum(sr.to_nch)::numeric from ops.sheet_rides sr where sr.date between p_from and p_to and sr.date not in (select day from done) group by 2
    union all
    select 'transport_to_laf', date_trunc(p_grain, sr.date)::date, sum(sr.to_laf)::numeric from ops.sheet_rides sr where sr.date between p_from and p_to and sr.date not in (select day from done) group by 2
    union all
    select 'meals_breakfast', date_trunc(p_grain, sm.date)::date, sum(sm.breakfast)::numeric from ops.sheet_meals sm where sm.date between p_from and p_to and sm.date not in (select day from done) group by 2
    union all
    select 'meals_lunch', date_trunc(p_grain, sm.date)::date, sum(sm.lunch)::numeric from ops.sheet_meals sm where sm.date between p_from and p_to and sm.date not in (select day from done) group by 2
    union all
    select 'meals_dinner', date_trunc(p_grain, sm.date)::date, sum(sm.dinner)::numeric from ops.sheet_meals sm where sm.date between p_from and p_to and sm.date not in (select day from done) group by 2
    union all
    select 'care_cart_' || replace(c.time_slot, ':', ''), date_trunc(p_grain, c.date)::date, sum(coalesce(c.served_count, 0))::numeric
      from inventory.care_cart_runs c where c.sheet_key is not null and c.delivery_status <> 'cancelled' and c.date between p_from and p_to and c.time_slot in ('10:00', '12:00', '17:00') group by 1, 2
    union all
    select 'care_cart_volunteers', date_trunc(p_grain, c.date)::date, sum(coalesce(c.volunteer_count, 0))::numeric
      from inventory.care_cart_runs c where c.sheet_key is not null and c.delivery_status <> 'cancelled' and c.date between p_from and p_to group by 2
    union all
    select 'center_nch_participants', date_trunc(p_grain, a.date)::date, sum(a.participants)::numeric from ops.activity_sessions a where a.source = 'sheet' and a.site = 'NCH' and a.date between p_from and p_to group by 2
    union all
    select 'center_nch_hours', date_trunc(p_grain, a.date)::date, sum(a.hours)::numeric from ops.activity_sessions a where a.source = 'sheet' and a.site = 'NCH' and a.date between p_from and p_to group by 2
    union all
    select 'center_nch_volunteers', date_trunc(p_grain, a.date)::date, sum(a.volunteer_count)::numeric from ops.activity_sessions a where a.source = 'sheet' and a.site = 'NCH' and a.date between p_from and p_to group by 2
    union all
    select 'center_laf_volunteers', date_trunc(p_grain, a.date)::date, sum(a.volunteer_count)::numeric from ops.activity_sessions a where a.source = 'sheet' and a.site = 'LAF' and a.date between p_from and p_to group by 2
    union all
    select 'caf_nights', date_trunc(p_grain, r.night)::date, count(*)::numeric
      from ops.nightly_record r join ops.patients p on p.id = r.patient_id
     where r.source = 'sheet' and p.caf_billing and r.night between p_from and p_to group by 2
    -- 0167: complete days, from the app (the same sums as the native column, on those days only)
    union all
    select 'housing', date_trunc(p_grain, bn.night)::date, sum(1 + s.people_with_child)::numeric
      from ops.bed_nights bn join ops.stays s on s.id = bn.stay_id where bn.night in (select day from done) group by 2
    union all
    select case t.direction when 'to_hospital' then 'transport_to_nch' else 'transport_to_laf' end, date_trunc(p_grain, t.date)::date, sum(tp.people)::numeric
      from ops.trips t join ops.trip_passengers tp on tp.trip_id = t.id
     where t.date in (select day from done) and t.direction in ('to_hospital', 'from_hospital') group by 1, 2
    union all
    select 'meals_' || ms.meal, date_trunc(p_grain, ms.date)::date, sum(1 + coalesce(st.people_with_child, 1))::numeric
      from ops.meals_served ms
      left join lateral (select people_with_child from ops.stays s where s.patient_id = ms.patient_id and s.check_in_at::date <= ms.date
                           and (s.check_out_at is null or s.check_out_at::date >= ms.date) order by s.check_in_at desc limit 1) st on true
     where ms.date in (select day from done) group by 1, 2
    union all
    select 'caf_nights', date_trunc(p_grain, bn.night)::date, count(*)::numeric
      from ops.bed_nights bn join ops.stays s on s.id = bn.stay_id join ops.patients p on p.id = s.patient_id
     where p.caf_billing and bn.night in (select day from done) group by 2
  ),
  -- 0148: a past night the House Sheet lists that the Programs sheet (sheet_meals) has not: each child once
  -- (dismissed names left out), with their carer. 0167: only the children the app does not have that night
  -- (it was any app night at all), and never a complete day. Added to both columns below.
  fill as (
    select date_trunc(p_grain, x.night)::date as m, sum(x.people)::numeric as v from (
      select sn.night, max(1 + (nullif(btrim(sn.carer_name), '') is not null)::int) as people
        from ops.sheet_nights sn left join ops.house_sheet_people hp on hp.name_key = sn.name_key
       where sn.night between p_from and least(p_to, (now() at time zone 'Asia/Manila')::date - 1)
         and coalesce(hp.match_status, 'unmatched') <> 'dismissed'
         and not exists (select 1 from ops.sheet_meals sm where sm.date = sn.night)
         and sn.night not in (select day from done)
         and not exists (select 1 from ops.bed_nights b join ops.stays s on s.id = b.stay_id
                          where b.night = sn.night
                            and s.patient_id = case when hp.match_status in ('auto_matched', 'confirmed', 'encoded') then hp.matched_patient_id end)
       group by sn.night, coalesce(hp.matched_patient_id::text, sn.name_key)
    ) x group by 1
  )
  select lines.l, months.m,
         coalesce(n.v, 0) + case when lines.l = 'housing' then coalesce(fl.v, 0) else 0 end,
         coalesce((select sum(f.v) from from_sheet f where f.l = lines.l and f.m = months.m), 0) + case when lines.l = 'housing' then coalesce(fl.v, 0) else 0 end
    from lines cross join months
    left join native n on n.l = lines.l and n.m = months.m
    left join fill fl on fl.m = months.m
   order by lines.l, months.m;
$function$;

-- ---- 7. the pages ----
insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level from (values ('patients.history')) p(page)
cross join (values ('social_worker', 'edit'), ('office_admin', 'edit')) r(role, level)
where exists (select 1 from shared.roles where key = r.role)
on conflict do nothing;

insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level from (values ('transport.history')) p(page)
cross join (values ('driver', 'edit'), ('social_worker', 'edit')) r(role, level)
where exists (select 1 from shared.roles where key = r.role)
on conflict do nothing;
