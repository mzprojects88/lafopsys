-- Undo 0092 (temporary beds). Temporary beds that were ever used keep their rows (stays and
-- bed nights point at their positions); they are retired and moved out of the fourth area.
drop function if exists ops.add_temporary_bed(text, text);
drop function if exists ops.remove_temporary_bed(text, text);

create or replace function ops.bed_rule_problem(p_unit_id text, p_sex text, p_family uuid, p_ignore_stay uuid, p_ignore_patient uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_unit ops.units;
  v_room ops.rooms;
  v_earlier ops.rooms;
begin
  select * into v_unit from ops.units where id = p_unit_id;
  if not found or v_unit.room_id is null or p_sex is null then
    return null;
  end if;
  select * into v_room from ops.rooms where id = v_unit.room_id;
  if exists (select 1 from ops.bed_occupants(p_ignore_stay, p_ignore_patient) o
              where o.room_id = v_room.id and o.sex is not null and o.sex <> p_sex
                and (p_family is null or o.family_id is distinct from p_family)) then
    return format('%s is a %s room now', v_room.name, case when p_sex = 'F' then 'men''s' else 'women''s' end);
  end if;
  for v_earlier in select * from ops.rooms r where r.sort_order < v_room.sort_order order by r.sort_order loop
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

create or replace function ops.guard_bed_reservation()
returns trigger language plpgsql security definer set search_path = '' as $$
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

update ops.units set active = false, retired_at = coalesce(retired_at, now()), room_id = null where temporary;
delete from ops.rooms where id = 'room-below-3';
alter table ops.rooms drop column if exists temporary_spots, drop column if exists max_temporary;
alter table ops.units drop constraint if exists units_temporary_has_reason;
alter table ops.units drop column if exists removed_reason, drop column if exists added_at, drop column if exists added_reason, drop column if exists added_by, drop column if exists temporary;
