-- 0141 Super Admin deletes a punch made by mistake (user, 12 Nov 2026).
--
-- Punches were never deleted (the DTR is payroll and labour-law evidence). The user: "superadmin should be able to
-- delete entries like this" (a punch entered by mistake). So, narrowly: only the Super Admin, only with a reason,
-- and every deletion keeps a full copy of the punch in ops.time_punch_deletions (HR and the Super Admin read it;
-- nobody edits it). The one door is /api/dtr/punch/delete (the function is the server's only, never called from
-- the browser): it removes the photo file and recomputes the day's summary with the punch route's pairing rules,
-- so nothing is left half done. The day's summary goes with its last punch.

create table if not exists ops.time_punch_deletions (
  id uuid primary key default gen_random_uuid(),
  punch_id uuid not null,
  staff_id uuid references shared.staff(id) on delete set null deferrable initially immediate,
  punched_at timestamptz not null,
  -- The punch as it was (type, time, location, device, site, adjustment), so nothing is lost but the row.
  punch jsonb not null,
  photo_key text,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  deleted_by uuid references shared.staff(id) on delete set null deferrable initially immediate,
  deleted_at timestamptz not null default now()
);
alter table ops.time_punch_deletions enable row level security;
drop policy if exists "hr and the super admin read punch deletions" on ops.time_punch_deletions;
create policy "hr and the super admin read punch deletions" on ops.time_punch_deletions
  for select to authenticated using (shared.has_role('admin') or hr.is_hr_staff());
revoke all on ops.time_punch_deletions from anon, authenticated;
grant select on ops.time_punch_deletions to authenticated;
do $$ begin
  alter publication supabase_realtime add table ops.time_punch_deletions;
exception when duplicate_object then null; end $$;

-- p_actor is the signed-in person the route verified; the function takes them as its caller for the checks and the
-- log, and only the server (service role) may call it.
create or replace function ops.time_punch_delete(p_punch uuid, p_reason text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  p ops.time_punches;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_key text;
  v_left integer := 0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  if p_actor is null or shared.current_staff_roles() is null or not shared.has_role('admin') then
    raise exception 'Only the Super Admin deletes a punch.' using errcode = '42501';
  end if;
  if length(v_reason) not between 3 and 500 then
    raise exception 'Say why this punch is deleted (at least 3 characters).' using errcode = '23514';
  end if;
  select * into p from ops.time_punches where id = p_punch;
  if not found then
    raise exception 'No such punch.' using errcode = 'P0002';
  end if;
  -- The day first, then the punch: a punch arriving on this day meanwhile waits, and is counted (never cascaded away).
  perform 1 from ops.time_entries where id = p.time_entry_id for update;
  select * into p from ops.time_punches where id = p_punch for update;
  if not found then
    raise exception 'No such punch.' using errcode = 'P0002';
  end if;
  select count(*) into v_left from ops.time_punches where time_entry_id = p.time_entry_id and id <> p.id;
  -- A clock-in that a clock-out closes: its clock-out would be left alone and pair with another day.
  if p.punch_type = 'clock_in' and exists (
    select 1 from ops.time_punches o
    where o.time_entry_id = p.time_entry_id and o.punch_type = 'clock_out' and o.punched_at > p.punched_at
      and not exists (select 1 from ops.time_punches i where i.time_entry_id = p.time_entry_id and i.punch_type = 'clock_in' and i.punched_at > p.punched_at and i.punched_at < o.punched_at)) then
    raise exception 'This clock-in has its clock-out: delete the clock-out first.' using errcode = '23514';
  end if;
  -- A correction request still to decide, one that made this punch, or any the emptied day would take with it.
  if exists (
    select 1 from ops.dtr_correction_requests r
    where r.adjustment_punch_id = p.id
       or (r.time_entry_id = p.time_entry_id and (r.status = 'pending' or v_left = 0))) then
    raise exception 'This day has a correction request: settle it through the request instead.' using errcode = '23514';
  end if;
  select object_key into v_key from ops.time_punch_photos where punch_id = p.id;
  insert into ops.time_punch_deletions (punch_id, staff_id, punched_at, punch, photo_key, reason, deleted_by)
  values (p.id, p.staff_id, p.punched_at, to_jsonb(p), v_key, v_reason, p_actor);
  delete from ops.time_punch_photos where punch_id = p.id;
  delete from ops.time_punches where id = p.id;
  if p.time_entry_id is not null and v_left = 0 then
    delete from ops.time_entries where id = p.time_entry_id;
  end if;
  return jsonb_build_object('staff_id', p.staff_id, 'punched_at', p.punched_at, 'time_entry_id', p.time_entry_id,
                            'entry_deleted', p.time_entry_id is not null and v_left = 0, 'photo_key', v_key);
end $$;
revoke all on function ops.time_punch_delete(uuid, text, uuid) from public, anon, authenticated;
grant execute on function ops.time_punch_delete(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
