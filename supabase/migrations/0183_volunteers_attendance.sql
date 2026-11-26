-- 0183: Volunteers, step 3: the group confirms and corrects who came (owner, 26 Nov 2026; PLAN.md v2, answer 3).
--
--   * For attendance_days after a visit (Booking settings, default 7) the group's contact may, from the Volunteers
--     Portal, tick who came, untick who did not, and add someone who came but was not listed (full name and email,
--     a parent's or guardian's for a member under 18). After that the group writes to the foundation instead.
--   * Staff's record of the visit stays the official one (children, volunteers, hours; Program Impact): this changes
--     only who is credited with the visit. The volunteer log follows the ticks (sync_volunteer_log, 0181), on
--     production only. Staff can change any mark at any time; the latest mark wins, and every change is on the trail.
--   * Reached only through the ArkOS server with the service key, for the group of the signed-in session.

alter table booking.settings add column if not exists attendance_days integer not null default 7 check (attendance_days between 0 and 30);
comment on column booking.settings.attendance_days is 'Days after a visit during which the group may confirm or correct who came, from the Volunteers Portal (0183).';

create or replace function booking.portal_attendance(p_group uuid, p_ref text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $$
declare
  r booking.requests;
  st booking.settings;
  v_mark jsonb;
  v_add jsonb;
  v_name text;
  v_email text;
  v_pos integer;
  v_count integer;
  v_changed integer := 0;
  v_added integer := 0;
begin
  select * into st from booking.settings where id;
  select * into r from booking.requests where ref = upper(regexp_replace(coalesce(p_ref, ''), '\s+', '', 'g')) for update;
  if not found or r.group_id is distinct from p_group then
    raise exception 'That visit was not found.' using errcode = 'P0002';
  end if;
  if r.status <> 'completed' then
    raise exception 'Who came can be confirmed once Little Ark Foundation has recorded the visit.' using errcode = '22023';
  end if;
  if booking.today() > r.date + st.attendance_days then
    raise exception 'Who came could be confirmed until % days after the visit. Please write to us to change it.', st.attendance_days using errcode = '22023';
  end if;

  -- Ticks: only members of this visit.
  for v_mark in select value from jsonb_array_elements(coalesce(p->'marks', '[]'::jsonb)) loop
    if jsonb_typeof(v_mark->'came') is distinct from 'boolean' then
      raise exception 'That could not be read.' using errcode = '22023';
    end if;
    update booking.volunteers set came = (v_mark->>'came')::boolean
     where id = nullif(v_mark->>'id', '')::uuid and request_id = r.id and came is distinct from (v_mark->>'came')::boolean;
    if found then
      v_changed := v_changed + 1;
    elsif not exists (select 1 from booking.volunteers where id = nullif(v_mark->>'id', '')::uuid and request_id = r.id) then
      raise exception 'That person is not on this visit.' using errcode = '22023';
    end if;
  end loop;

  -- People who came but were not listed.
  for v_add in select value from jsonb_array_elements(coalesce(p->'added', '[]'::jsonb)) loop
    v_name := regexp_replace(btrim(coalesce(v_add->>'name', '')), '\s+', ' ', 'g');
    v_email := lower(btrim(coalesce(v_add->>'email', '')));
    if length(v_name) not between 2 and 120 then
      raise exception 'Please give the full name of each person you add.' using errcode = '22023';
    end if;
    if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then
      raise exception 'Please give the email address of %. For a volunteer under 18, a parent''s or guardian''s.', v_name using errcode = '22023';
    end if;
    select count(*), coalesce(max(position), 0) into v_count, v_pos from booking.volunteers where request_id = r.id;
    if v_count >= st.max_volunteers then
      raise exception 'A visit has at most % volunteers. Please write to us.', st.max_volunteers using errcode = '22023';
    end if;
    insert into booking.volunteers (request_id, position, name, email, under_18, came)
    values (r.id, v_pos + 1, v_name, v_email, coalesce((v_add->>'under18')::boolean, false), true);
    v_added := v_added + 1;
  end loop;

  if v_changed + v_added > 0 then
    insert into booking.events (request_id, by_requestor, action, detail)
    values (r.id, true, 'attendance', btrim(case when v_changed > 0 then v_changed || ' mark(s) changed. ' else '' end || case when v_added > 0 then v_added || ' person(s) added.' else '' end));
  end if;
  return jsonb_build_object('changed', v_changed, 'added', v_added);
exception
  when invalid_text_representation then
    raise exception 'That could not be read.' using errcode = '22023';
end;
$$;
revoke all on function booking.portal_attendance(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function booking.portal_attendance(uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';
