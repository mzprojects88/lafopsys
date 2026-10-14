-- 0092: temporary beds for overflow nights (decided by the user 2026-10-14).
--
-- When NCH sends more children than the house has beds, a social worker (anyone who assigns
-- beds: Patients edit) adds a temporary bed -- a mattress -- in a room: at most 2 per room, and
-- 1 in the section below Room 3, which becomes the fourth area of the plan, last in the fill
-- order, with the same room rules. A temporary bed stays until someone removes it by hand.
--
--   1. ops.units.temporary (+ who added it, why, when, and why it was removed);
--      ops.rooms.max_temporary and temporary_spots (preset places on the plan, so nobody drags).
--   2. The fourth area: ops.rooms 'room-below-3', sort_order 4, one temporary bed at most.
--   3. ops.add_temporary_bed(room, reason) / ops.remove_temporary_bed(bed, reason): definer, for
--      Patients editors; codes T1, T2, ... never reused; removal refused while someone is in it.
--   4. The bed rules (0070): a free temporary bed never makes a later room wait, and a temporary
--      bed may be taken only when no regular bed without a sex clash is free in any room.
--      A hold (0065) cannot sit on a temporary bed.
-- Rollback: supabase/rollbacks/0092_down.sql

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
alter table ops.units
  add column if not exists temporary boolean not null default false,
  add column if not exists added_by uuid references shared.staff(id),
  add column if not exists added_reason text,
  add column if not exists added_at timestamptz,
  add column if not exists removed_reason text;
alter table ops.units add constraint units_temporary_has_reason check (not temporary or nullif(btrim(added_reason), '') is not null);
comment on column ops.units.temporary is 'An overflow mattress added for the night(s) by a social worker (0092); removed by hand.';

alter table ops.rooms
  add column if not exists max_temporary smallint not null default 2 check (max_temporary between 0 and 4),
  add column if not exists temporary_spots jsonb not null default '[]'::jsonb;
comment on column ops.rooms.temporary_spots is 'Preset centres for temporary beds, [{"x","y","rot"}], taken in order (0092).';

-- ---------------------------------------------------------------------
-- 2. The fourth area, and where the mattresses go
-- ---------------------------------------------------------------------
insert into ops.rooms (id, name, bounds, sort_order, max_temporary, temporary_spots)
values ('room-below-3', 'Below Room 3', '[[0.6057, 0.69], [0.8214, 0.69], [0.8214, 0.95], [0.6057, 0.95]]'::jsonb, 4, 1, '[{"x": 0.70, "y": 0.76, "rot": 0}]'::jsonb)
on conflict (id) do nothing;
-- Room ids and names are swapped since 0069 (room-3 is "Room 1"): by id.
update ops.rooms set temporary_spots = '[{"x": 0.20, "y": 0.56, "rot": 0}, {"x": 0.20, "y": 0.70, "rot": 0}]'::jsonb where id = 'room-3';
update ops.rooms set temporary_spots = '[{"x": 0.39, "y": 0.20, "rot": 0}, {"x": 0.39, "y": 0.34, "rot": 0}]'::jsonb where id = 'room-2';
update ops.rooms set temporary_spots = '[{"x": 0.64, "y": 0.28, "rot": 0}, {"x": 0.76, "y": 0.55, "rot": 0}]'::jsonb where id = 'room-1';

-- ---------------------------------------------------------------------
-- 3. Adding and removing
-- ---------------------------------------------------------------------
create or replace function ops.add_temporary_bed(p_room_id text, p_reason text)
returns text
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_room ops.rooms%rowtype;
  v_used int;
  v_n int;
  v_id text;
  v_spot jsonb;
begin
  if not shared.module_editable('patients') then
    raise exception 'Only staff who assign beds can add a temporary bed' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Say why the temporary bed is needed' using errcode = '22023';
  end if;
  select * into v_room from ops.rooms where id = p_room_id for update;
  if not found then
    raise exception 'Unknown room %', p_room_id using errcode = '23503';
  end if;
  select count(*) into v_used from ops.units where room_id = v_room.id and temporary and active;
  if v_used >= v_room.max_temporary then
    raise exception '% already has its % temporary bed%', v_room.name, v_room.max_temporary, case when v_room.max_temporary = 1 then '' else 's' end
      using errcode = '23514';
  end if;
  -- T1, T2, ...: numbers are never reused, so a removed bed's history keeps its name.
  select coalesce(max(substring(code from 2)::int), 0) + 1 into v_n from ops.units where code ~ '^T[0-9]+$';
  v_id := 'unit-T' || v_n;
  -- The first preset spot in this room with no live temporary bed on it; none left = unplaced.
  select s into v_spot
    from jsonb_array_elements(v_room.temporary_spots) s
   where not exists (
     select 1 from ops.units u
      where u.room_id = v_room.id and u.temporary and u.active and u.x is not null
        and abs(u.x - (s->>'x')::numeric) < 0.02 and abs(u.y - (s->>'y')::numeric) < 0.02)
   limit 1;
  insert into ops.units (id, code, room_id, status, shared_unit, x, y, w, h, rotation_deg, capacity, active, temporary, added_by, added_reason, added_at)
    values (v_id, 'T' || v_n, v_room.id, 'available', false,
            (v_spot->>'x')::numeric, (v_spot->>'y')::numeric, 0.05, 0.13, coalesce((v_spot->>'rot')::int, 0),
            1, true, true, auth.uid(), btrim(p_reason), now());
  insert into ops.bed_positions (id, unit_id, label)
    select v_id || '-' || l, v_id, l from unnest(array['A', 'B', 'C', 'D']) as l;
  return v_id;
end;
$$;
revoke all on function ops.add_temporary_bed(text, text) from public;
grant execute on function ops.add_temporary_bed(text, text) to authenticated;

create or replace function ops.remove_temporary_bed(p_unit_id text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_unit ops.units%rowtype;
begin
  if not shared.module_editable('patients') then
    raise exception 'Only staff who assign beds can remove a temporary bed' using errcode = '42501';
  end if;
  select * into v_unit from ops.units where id = p_unit_id for update;
  if not found or not v_unit.active then
    raise exception 'No such bed' using errcode = 'P0002';
  end if;
  if not v_unit.temporary then
    raise exception '% is a regular bed: an admin retires it from the Floor Plan', v_unit.code using errcode = '23514';
  end if;
  if exists (select 1 from ops.stays s join ops.bed_positions bp on bp.id = s.bed_position_id
              where bp.unit_id = v_unit.id and s.status in ('in_house', 'overdue')) then
    raise exception '% still has a child in it: move them first', v_unit.code using errcode = '23514';
  end if;
  if exists (select 1 from ops.bed_reservations r where r.unit_id = v_unit.id and r.status = 'active') then
    raise exception '% is held for a child who has not arrived: release the hold first', v_unit.code using errcode = '23514';
  end if;
  update ops.units
     set active = false, retired_at = now(), removed_reason = nullif(btrim(p_reason), ''), status = 'available', lock_reason = null
   where id = v_unit.id;
end;
$$;
revoke all on function ops.remove_temporary_bed(text, text) from public;
grant execute on function ops.remove_temporary_bed(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. The rules
-- ---------------------------------------------------------------------
create or replace function ops.bed_rule_problem(p_unit_id text, p_sex text, p_family uuid, p_ignore_stay uuid, p_ignore_patient uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_unit ops.units;
  v_room ops.rooms;
  v_other ops.rooms;
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

  -- Regular beds first (0092): for a regular bed, an earlier room that can take this carer and
  -- still has a free regular bed comes first; for a temporary bed, any room's free regular bed
  -- does, and so does an earlier room's free temporary bed (the area below Room 3 comes last).
  for v_other in
    select * from ops.rooms r
     where (v_unit.temporary and true) or r.sort_order < v_room.sort_order
     order by r.sort_order
  loop
    if not exists (select 1 from ops.bed_occupants(p_ignore_stay, p_ignore_patient) o
                    where o.room_id = v_other.id and o.sex is not null and o.sex <> p_sex
                      and (p_family is null or o.family_id is distinct from p_family))
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

create or replace function ops.guard_bed_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  -- A temporary bed is for tonight's overflow, not for a child who has not arrived (0092).
  if v_unit.temporary then
    raise exception 'A hold cannot sit on a temporary bed (%)', v_unit.code using errcode = '23514';
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
