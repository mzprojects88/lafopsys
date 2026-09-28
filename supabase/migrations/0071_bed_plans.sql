-- 0071: Bed plans -- a re-arrangement of the house applied as one (bed rules, phase 3).
--
-- House Today's "Suggest bed plan" (app/api/patients/bed-plan) finds the
-- rearrangements that satisfy the bed rules (0070) with the fewest moves and
-- has the AI choose and explain one; a social worker approves it. Moving
-- families one at a time through confirm_night would be refused half way
-- (e.g. swapping which room is the women's), so a plan is applied here in
-- one transaction and checked on the END state: every moved stay must pass
-- ops.bed_rule_problem where it lands, no bed over capacity. Each move is
-- logged with its reason. Like hospitals, families are not moved at night:
-- plans apply only between shared.app_settings.bed_moves_from and _until
-- (Manila time; admin setting, default 07:00-20:00). The moves are tonight's
-- beds (bed_nights), as a Move tonight is.

alter table shared.app_settings
  add column bed_moves_from time not null default '07:00',
  add column bed_moves_until time not null default '20:00',
  add constraint app_settings_bed_moves_window check (bed_moves_from < bed_moves_until);

create table ops.bed_moves (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  stay_id uuid not null references ops.stays (id),
  from_unit_id text references ops.units (id),
  to_unit_id text not null references ops.units (id),
  reason text not null check (btrim(reason) <> ''),
  summary text,
  moved_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index bed_moves_stay on ops.bed_moves (stay_id);
alter table ops.bed_moves enable row level security;
create policy "patients viewers read" on ops.bed_moves
  for select to authenticated using (shared.module_viewable('patients'));
revoke all on ops.bed_moves from anon, authenticated;
grant select on ops.bed_moves to authenticated;
alter publication supabase_realtime add table ops.bed_moves;

-- p_moves: [{"stay_id": uuid, "unit_id": text, "reason": text}, ...]
create function ops.apply_bed_plan(p_moves jsonb, p_summary text default null)
returns uuid
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_now time := (now() at time zone 'Asia/Manila')::time;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_from time;
  v_until time;
  v_plan uuid := gen_random_uuid();
  v_move record;
  v_stay ops.stays%rowtype;
  v_unit ops.units%rowtype;
  v_position text;
  v_problem text;
  v_count int;
begin
  if not shared.module_editable('patients') then
    raise exception 'Your access to Patients is view only' using errcode = '42501';
  end if;
  select bed_moves_from, bed_moves_until into v_from, v_until from shared.app_settings where id;
  if v_now < v_from or v_now > v_until then
    raise exception 'Families are moved between % and %; plan it for then', to_char(v_from, 'HH24:MI'), to_char(v_until, 'HH24:MI')
      using errcode = '23514';
  end if;
  if jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) = 0 then
    raise exception 'The plan has no moves' using errcode = '22023';
  end if;

  create temp table if not exists pg_temp.plan_moves (stay_id uuid primary key, unit_id text not null, reason text not null, from_unit text) on commit drop;
  truncate pg_temp.plan_moves;
  begin
    insert into pg_temp.plan_moves (stay_id, unit_id, reason)
      select (m ->> 'stay_id')::uuid, m ->> 'unit_id', coalesce(nullif(btrim(m ->> 'reason'), ''), 'Bed plan')
        from jsonb_array_elements(p_moves) m;
  exception when unique_violation then
    raise exception 'A family appears twice in the plan' using errcode = '22023';
  end;

  -- Lock every bed and stay the plan touches, in a fixed order.
  perform 1 from ops.units u where u.id in (select unit_id from pg_temp.plan_moves) order by u.id for update;
  for v_move in select * from pg_temp.plan_moves order by stay_id loop
    select * into v_stay from ops.stays where id = v_move.stay_id for update;
    if not found or v_stay.status not in ('in_house', 'overdue') then
      raise exception 'A family in the plan is no longer in the house' using errcode = 'P0002';
    end if;
    select * into v_unit from ops.units where id = v_move.unit_id;
    if not found or not v_unit.active then
      raise exception 'No such bed' using errcode = 'P0002';
    end if;
    if v_unit.status <> 'available' then
      raise exception 'Bed % is locked (%)', v_unit.code, v_unit.lock_reason using errcode = '23514';
    end if;
    update pg_temp.plan_moves set from_unit = (select unit_id from ops.bed_positions where id = v_stay.bed_position_id) where stay_id = v_stay.id;
  end loop;

  -- Tonight's beds of the moved families give way first (a swap would collide on them).
  delete from ops.bed_nights where night = v_today and stay_id in (select stay_id from pg_temp.plan_moves);

  -- Move everyone onto a free position of their new bed (each bed has several;
  -- capacity is checked on the end state below).
  for v_move in select * from pg_temp.plan_moves where unit_id is distinct from from_unit order by stay_id loop
    select bp.id into v_position from ops.bed_positions bp
      where bp.unit_id = v_move.unit_id
        and not exists (select 1 from ops.stays s where s.bed_position_id = bp.id and s.status in ('in_house', 'overdue'))
      order by bp.label limit 1;
    if v_position is null then
      raise exception 'Bed % has no room left in this plan', (select code from ops.units where id = v_move.unit_id) using errcode = '23505';
    end if;
    update ops.stays set bed_position_id = v_position where id = v_move.stay_id;
  end loop;

  -- The end state: no bed over capacity, every moved family where the rules allow.
  for v_move in select * from pg_temp.plan_moves loop
    select * into v_unit from ops.units where id = v_move.unit_id;
    select count(*) into v_count from ops.stays s join ops.bed_positions bp on bp.id = s.bed_position_id
      where bp.unit_id = v_unit.id and s.status in ('in_house', 'overdue');
    if v_count > v_unit.capacity then
      raise exception 'Bed % would hold more families than it takes', v_unit.code using errcode = '23505';
    end if;
    select * into v_stay from ops.stays where id = v_move.stay_id;
    v_problem := ops.bed_rule_problem(v_unit.id, ops.stay_sleeper_sex(v_stay.id),
                                      (select family_id from ops.patients where id = v_stay.patient_id), v_stay.id, v_stay.patient_id);
    if v_problem is not null then
      raise exception 'The plan puts a family on bed % where the rules say no: %', v_unit.code, v_problem using errcode = '23514', hint = 'bed_rule';
    end if;
  end loop;

  insert into ops.bed_nights (night, stay_id, bed_position_id, confirmed_by)
    select v_today, s.id, s.bed_position_id, auth.uid()
      from ops.stays s where s.id in (select stay_id from pg_temp.plan_moves);
  insert into ops.bed_moves (plan_id, stay_id, from_unit_id, to_unit_id, reason, summary)
    select v_plan, stay_id, from_unit, unit_id, reason, nullif(btrim(p_summary), '') from pg_temp.plan_moves;
  return v_plan;
end;
$$;
revoke all on function ops.apply_bed_plan(jsonb, text) from public, anon;
grant execute on function ops.apply_bed_plan(jsonb, text) to authenticated, service_role;

notify pgrst, 'reload schema';
