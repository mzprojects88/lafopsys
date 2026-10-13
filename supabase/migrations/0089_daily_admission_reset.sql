-- 0089: the admission resets every day (decided by the user 2026-10-13).
--
-- A stay is one night. Every morning, at a time set in Settings, every checked-in child is
-- checked out by the database; every afternoon the social worker gives tonight's bed to each
-- name on NCH's tab (the House Sheet), to be finished before the finalize time (18:00). A
-- child whose visit continues is re-admitted in one click, keeping carer, arrival and visit.
--
--   1. shared.app_settings.admission_reset_at / admission_finalize_by (Manila time).
--   2. ops.stays.visit_id: the nights of one visit share it (the first night's own id); a
--      before-insert trigger inherits it from the stay this morning's reset closed, whichever
--      door re-admits the child. One active stay per patient, enforced by an index at last.
--   3. ops.admission_resets: one row per day the reset ran, shown on House Today.
--   4. ops.daily_admission_reset(): run by pg_cron every 15 minutes; acts once per day, after
--      the reset time, on stays checked in before today (check_out_reason 'daily_reset').
--   5. ops.readmit_for_tonight(patient, bed, exception): tonight's stay for a continuing visit --
--      no house-rules step (heard on the first night), same bed rules and capacity checks as
--      check_in, tonight's bed night written.
-- Rollback: supabase/rollbacks/0089_down.sql

-- ---------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------
alter table shared.app_settings
  add column if not exists admission_reset_at time not null default '06:00',
  add column if not exists admission_finalize_by time not null default '18:00';
comment on column shared.app_settings.admission_reset_at is 'Manila time after which the day''s reset checks everyone out (0089).';
comment on column shared.app_settings.admission_finalize_by is 'Manila time by which tonight''s beds must be assigned; House Today warns past it (0089).';

-- ---------------------------------------------------------------------
-- 2. Visits
-- ---------------------------------------------------------------------
alter table ops.stays add column if not exists visit_id uuid;
update ops.stays set visit_id = id where visit_id is null;
create index if not exists stays_visit_id on ops.stays (visit_id);
comment on column ops.stays.visit_id is 'The nights of one visit share the first night''s stay id (0089).';

create or replace function ops.stay_visit_default()
returns trigger language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_prev uuid;
begin
  if new.visit_id is null then
    -- The visit continues when this morning's reset closed the child's previous night.
    select s.visit_id into v_prev from ops.stays s
      where s.patient_id = new.patient_id and s.check_out_reason = 'daily_reset' and s.check_out_at = v_today
      order by s.check_in_at desc, s.created_at desc limit 1;
    new.visit_id := coalesce(v_prev, new.id);
  end if;
  return new;
end;
$$;
revoke all on function ops.stay_visit_default() from public, anon, authenticated;
drop trigger if exists stay_visit_default on ops.stays;
create trigger stay_visit_default before insert on ops.stays for each row execute function ops.stay_visit_default();

-- One active stay per patient: check_in refused it, the table now does too.
create unique index if not exists stays_one_active_per_patient on ops.stays (patient_id) where status in ('in_house', 'overdue');

-- ---------------------------------------------------------------------
-- 3. The reset log
-- ---------------------------------------------------------------------
create table ops.admission_resets (
  day date primary key,
  ran_at timestamptz not null default now(),
  checked_out integer not null default 0
);
alter table ops.admission_resets enable row level security;
create policy "module read" on ops.admission_resets for select to authenticated
  using (shared.module_viewable('patients', 'house_ops'));
revoke insert, update, delete on ops.admission_resets from authenticated;
alter publication supabase_realtime add table ops.admission_resets;

-- ---------------------------------------------------------------------
-- 4. The reset
-- ---------------------------------------------------------------------
create or replace function ops.daily_admission_reset()
returns integer language plpgsql security definer
set search_path to 'ops', 'shared', 'pg_temp' as $$
declare
  v_now timestamptz := now();
  v_today date := (v_now at time zone 'Asia/Manila')::date;
  v_at time;
  n integer := 0;
begin
  select admission_reset_at into v_at from shared.app_settings where id;
  if (v_now at time zone 'Asia/Manila')::time < coalesce(v_at, '06:00'::time) then
    return 0;
  end if;
  if exists (select 1 from ops.admission_resets where day = v_today) then
    return 0;
  end if;
  -- Hold the day first, so two cron ticks can't both run it.
  insert into ops.admission_resets (day) values (v_today);
  with closed as (
    update ops.stays set status = 'checked_out', check_out_at = v_today, check_out_reason = 'daily_reset'
      where status in ('in_house', 'overdue') and check_in_at < v_today
      returning id
  )
  select count(*) into n from closed;
  update ops.admission_resets set checked_out = n, ran_at = v_now where day = v_today;
  return n;
end;
$$;
revoke all on function ops.daily_admission_reset() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'admission-reset';
select cron.schedule('admission-reset', '*/15 * * * *', $$select ops.daily_admission_reset()$$);

-- ---------------------------------------------------------------------
-- 5. Tonight's stay for a continuing visit
-- ---------------------------------------------------------------------
create or replace function ops.readmit_for_tonight(p_patient_id uuid, p_unit_id text default null, p_exception_reason text default null)
returns jsonb language plpgsql security definer
set search_path to 'ops', 'shared', 'pg_temp' as $$
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

  v_unit_id := coalesce(p_unit_id, (select bp.unit_id from ops.bed_positions bp where bp.id = v_prev.bed_position_id));
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
  v_allowed := ops.enforce_bed_rules(v_unit.id, v_sex, v_patient.family_id, null, v_patient.id, p_exception_reason);

  insert into ops.stays (patient_id, bed_position_id, carer_id, check_in_at, expected_checkout_at, status, visit_id,
                         arrival_mode, arrival_ride_id, arrival_trip_id)
    values (v_patient.id, v_position_id, v_prev.carer_id, v_today, v_prev.expected_checkout_at, 'in_house', v_prev.visit_id,
            v_prev.arrival_mode, v_prev.arrival_ride_id, v_prev.arrival_trip_id)
    returning id into v_stay_id;
  if v_allowed is not null then
    insert into ops.bed_rule_exceptions (stay_id, unit_id, rule, reason) values (v_stay_id, v_unit.id, v_allowed, btrim(p_exception_reason));
  end if;
  delete from ops.bed_nights bn using ops.stays s
    where bn.night = v_today and bn.bed_position_id = v_position_id
      and s.id = bn.stay_id and s.status not in ('in_house', 'overdue');
  insert into ops.bed_nights (night, stay_id, bed_position_id, confirmed_by)
    values (v_today, v_stay_id, v_position_id, auth.uid());
  return jsonb_build_object('stay_id', v_stay_id, 'visit_id', v_prev.visit_id, 'unit_id', v_unit.id);
end;
$$;
revoke all on function ops.readmit_for_tonight(uuid, text, text) from public, anon;
grant execute on function ops.readmit_for_tonight(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
