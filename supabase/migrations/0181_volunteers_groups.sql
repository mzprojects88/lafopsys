-- 0181: Volunteers, step 1 (owner, 26 Nov 2026; Builds/Volunteers Page and Portal/PLAN.md, version 2).
--
--   * Every booking belongs to a GROUP: one per contact email (found when a request is filed, or made). A request
--     staff file for someone without an email gets a group of its own, without portal access.
--   * The MEMBERS of a booking are given with full name and email (required; a parent's or guardian's for a
--     member under 18), and later marked as having come or not.
--   * When staff record a visit, each member who came becomes a VOLUNTEER on the Volunteers page (one per name
--     and email) and gets a line in the volunteer LOG: the date, where, the activity and the visit's hours. A
--     correction of who came changes the lines. Written only where booking.settings.feeds_ops is on
--     (production): ops.volunteers and ops.volunteer_hours are copied between the databases every hour.
--   * The Volunteers menu (module "volunteers") gets its page; the access rows are seeded on production only.
--   * The privacy notice gains the line the owner approved.

-- ---- 1. Groups ----
create table if not exists booking.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  kind text not null default 'organization' check (kind in ('person', 'company', 'school', 'church', 'organization', 'government')),
  contact_person text not null check (length(btrim(contact_person)) between 2 and 120),
  -- Empty only for a group staff filed for someone without an email address: it has no portal access.
  email text check (email is null or (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200)),
  mobile text not null default '' check (length(mobile) <= 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists groups_email on booking.groups (lower(email)) where email is not null;
comment on table booking.groups is 'One per contact email: the group that books visits (0181). Its details follow its latest request.';

alter table booking.requests add column if not exists group_id uuid references booking.groups (id) deferrable initially immediate;
create index if not exists requests_group on booking.requests (group_id);

-- A request finds its group by email, or makes one; the group's details follow its latest request.
create or replace function booking.assign_group() returns trigger
language plpgsql security definer set search_path to 'booking', 'pg_temp' as $$
begin
  if new.group_id is not null then
    return new;
  end if;
  if new.email is not null then
    insert into booking.groups (name, kind, contact_person, email, mobile)
    values (btrim(new.requestor_name), new.requestor_kind, btrim(new.contact_person), lower(new.email), coalesce(new.mobile, ''))
    on conflict ((lower(email))) where email is not null
      do update set name = excluded.name, kind = excluded.kind, contact_person = excluded.contact_person, mobile = excluded.mobile, updated_at = now()
    returning id into new.group_id;
  else
    insert into booking.groups (name, kind, contact_person, email, mobile)
    values (btrim(new.requestor_name), new.requestor_kind, btrim(new.contact_person), null, coalesce(new.mobile, ''))
    returning id into new.group_id;
  end if;
  return new;
end;
$$;
revoke all on function booking.assign_group() from public, anon, authenticated;
drop trigger if exists assign_group on booking.requests;
create trigger assign_group before insert on booking.requests for each row execute function booking.assign_group();

-- Requests filed before this migration get their group too (the oldest first, so the latest details win).
do $$
declare
  r record;
  v_group uuid;
begin
  for r in select * from booking.requests where group_id is null order by created_at loop
    if r.email is not null then
      insert into booking.groups (name, kind, contact_person, email, mobile)
      values (btrim(r.requestor_name), r.requestor_kind, btrim(r.contact_person), lower(r.email), coalesce(r.mobile, ''))
      on conflict ((lower(email))) where email is not null
        do update set name = excluded.name, kind = excluded.kind, contact_person = excluded.contact_person, mobile = excluded.mobile, updated_at = now()
      returning id into v_group;
    else
      insert into booking.groups (name, kind, contact_person, email, mobile)
      values (btrim(r.requestor_name), r.requestor_kind, btrim(r.contact_person), null, coalesce(r.mobile, ''))
      returning id into v_group;
    end if;
    update booking.requests set group_id = v_group where id = r.id;
  end loop;
end $$;

-- ---- 2. Members of a booking: full name, email, under 18, and whether they came ----
alter table booking.volunteers
  add column if not exists email text,
  add column if not exists under_18 boolean not null default false,
  -- Null until the visit is recorded and someone marks it; null counts as "came".
  add column if not exists came boolean,
  -- The volunteer on the Volunteers page (ops.volunteers) this member was credited to. A plain id: that table
  -- is copied between the databases.
  add column if not exists person_id uuid;
alter table booking.volunteers drop constraint if exists volunteers_email_check;
-- Names given before this migration have no email: the rule holds from now on (not valid = not re-checked).
alter table booking.volunteers add constraint volunteers_email_check
  check (email is not null and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200) not valid;
comment on column booking.volunteers.email is 'Required (owner, 26 Nov 2026); for a member under 18, a parent''s or guardian''s.';

-- The group gives its members until they are due. Each entry: {"name": "...", "email": "...", "under18": false}.
-- An email left empty, or sent back masked as the page shows it, keeps the email on record for that name.
create or replace function booking.web_names(p_ref text, p_names jsonb, p_caller text) returns jsonb
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $$
declare
  r booking.requests;
  v_due integer;
  v_old jsonb;
  v_entry jsonb;
  v_name text;
  v_email text;
  v_i integer := 0;
begin
  if not booking.within_limit('names', p_caller, 20, interval '1 hour') then
    raise exception 'Too many changes from here. Please try again later.' using errcode = '53400';
  end if;
  select * into r from booking.requests where ref = upper(regexp_replace(coalesce(p_ref, ''), '\s+', '', 'g')) for update;
  if not found then
    return null;
  end if;
  select names_due_days into v_due from booking.settings where id;
  if r.status <> 'approved' then
    raise exception 'Names can be added once the booking is approved.' using errcode = '22023';
  end if;
  if booking.today() > r.date - v_due then
    raise exception 'The names were due % days before the visit. Please write to us to change them.', v_due using errcode = '22023';
  end if;
  if jsonb_typeof(p_names) is distinct from 'array' or jsonb_array_length(p_names) > r.volunteers_count then
    raise exception 'This booking is for % volunteers. Please write to us if the number changed.', r.volunteers_count using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(lower(btrim(name)), email), '{}'::jsonb) into v_old from booking.volunteers where request_id = r.id and email is not null;
  delete from booking.volunteers where request_id = r.id;
  for v_entry in select value from jsonb_array_elements(p_names) loop
    v_name := btrim(case when jsonb_typeof(v_entry) = 'string' then v_entry #>> '{}' else coalesce(v_entry->>'name', '') end);
    if v_name = '' then
      continue;
    end if;
    if length(v_name) not between 2 and 120 then
      raise exception 'Please give each volunteer''s full name.' using errcode = '22023';
    end if;
    v_email := lower(btrim(case when jsonb_typeof(v_entry) = 'object' then coalesce(v_entry->>'email', '') else '' end));
    if v_email = '' or v_email like '%*%' then
      v_email := v_old->>lower(v_name);
    end if;
    if v_email is null or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then
      raise exception 'Please give the email address of %. For a volunteer under 18, a parent''s or guardian''s.', v_name using errcode = '22023';
    end if;
    v_i := v_i + 1;
    insert into booking.volunteers (request_id, position, name, email, under_18)
    values (r.id, v_i, v_name, v_email, case when jsonb_typeof(v_entry) = 'object' then coalesce((v_entry->>'under18')::boolean, false) else false end);
  end loop;
  insert into booking.events (request_id, by_requestor, action, detail) values (r.id, true, 'names', v_i || ' name(s) given.');
  return booking.request_view(r.id);
end;
$$;
revoke all on function booking.web_names(text, jsonb, text) from public, anon, authenticated;
grant execute on function booking.web_names(text, jsonb, text) to service_role;

-- What a requestor sees for their Request ID now lists the members too: name, email masked, under 18.
create or replace function booking.request_view(p_id uuid) returns jsonb
language sql stable security definer set search_path to 'booking', 'pg_temp' as $$
  select jsonb_build_object(
    'ref', r.ref, 'status', r.status, 'offPlan', r.off_plan,
    'date', r.date, 'start', left(r.start_time::text, 5), 'end', left(r.end_time::text, 5),
    'place', jsonb_build_object('name', pl.name, 'whereToGo', pl.where_to_go),
    'requestorName', r.requestor_name, 'requestorKind', r.requestor_kind, 'contactPerson', r.contact_person,
    'email', regexp_replace(r.email, '^(.).*(@.*)$', '\1***\2'), 'mobile', regexp_replace(r.mobile, '.(?=.{3})', '*', 'g'),
    'volunteersCount', r.volunteers_count, 'hasMinors', r.has_minors,
    'requestedOn', (r.created_at at time zone 'Asia/Manila')::date,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('activity', i.activity, 'source', i.source, 'purpose', i.purpose, 'who', i.who, 'ages', i.ages, 'gender', i.gender,
        'note', i.participants_note, 'start', left(i.start_time::text, 5), 'end', left(i.end_time::text, 5), 'materials', i.materials) order by i.position), '[]'::jsonb)
      from booking.request_items i where i.request_id = r.id),
    'names', (select coalesce(jsonb_agg(v.name order by v.position), '[]'::jsonb) from booking.volunteers v where v.request_id = r.id),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('name', v.name, 'email', regexp_replace(coalesce(v.email, ''), '^(.).*(@.*)$', '\1***\2'), 'under18', v.under_18) order by v.position), '[]'::jsonb)
      from booking.volunteers v where v.request_id = r.id),
    'namesDue', r.date - st.names_due_days,
    'canEditNames', r.status = 'approved' and booking.today() <= r.date - st.names_due_days,
    'canCancel', r.status in ('pending', 'approved') and r.date > booking.today(),
    'declineReason', case when r.status = 'declined' then r.decline_reason end,
    'approved', case when r.status in ('approved', 'completed') then jsonb_build_object(
        'instructions', pl.instructions, 'bookingInstructions', r.instructions,
        'coordinatorName', pl.coordinator_name, 'coordinatorPhone', pl.coordinator_phone) end,
    'replyDays', st.reply_days
  )
  from booking.requests r join booking.places pl on pl.id = r.place_id cross join (select * from booking.settings where id) st
  where r.id = p_id;
$$;
revoke all on function booking.request_view(uuid) from public, anon, authenticated;
grant execute on function booking.request_view(uuid) to service_role;

-- ---- 3. The volunteer log ----
alter table ops.volunteers drop constraint if exists volunteers_email_check;
alter table ops.volunteers add constraint volunteers_email_check check (email is null or length(email) <= 200);
-- New columns are nullable or have a default: the hourly copy works on the columns both databases share.
alter table ops.volunteer_hours
  add column if not exists place text check (place is null or length(place) <= 120),
  add column if not exists source text not null default 'manual' check (source in ('manual', 'booking')),
  add column if not exists booking_request_id uuid;
create index if not exists volunteer_hours_booking on ops.volunteer_hours (booking_request_id) where booking_request_id is not null;
comment on column ops.volunteer_hours.place is 'Where the volunteer served (the booking''s place, or typed by staff).';
comment on column ops.volunteer_hours.source is 'manual = logged by staff; booking = written when staff recorded an Activity Center visit (0181).';

-- Makes the log of one visit match who came: a volunteer and a line for each member who came, none for the
-- others. Only on a recorded visit with hours, and only where feeds_ops is on.
create or replace function booking.sync_volunteer_log(p_request uuid) returns void
language plpgsql security definer set search_path to 'booking', 'ops', 'pg_temp' as $$
declare
  r booking.requests;
  v_place text;
  m record;
  v_person uuid;
  v_name text;
  v_first text;
  v_last text;
begin
  if not coalesce((select feeds_ops from booking.settings where id), false) then
    return;
  end if;
  select * into r from booking.requests where id = p_request;
  if not found then
    return;
  end if;
  if r.status <> 'completed' or coalesce(r.attended_hours, 0) <= 0 then
    delete from ops.volunteer_hours where booking_request_id = p_request;
    return;
  end if;
  select name into v_place from booking.places where id = r.place_id;
  for m in select * from booking.volunteers where request_id = p_request and coalesce(came, true) and email is not null order by position loop
    v_name := regexp_replace(btrim(m.name), '\s+', ' ', 'g');
    select id into v_person from ops.volunteers
     where lower(email) = lower(m.email) and lower(regexp_replace(btrim(first_name || ' ' || last_name), '\s+', ' ', 'g')) = lower(v_name)
     order by created_at limit 1;
    if v_person is null then
      v_last := coalesce((regexp_match(v_name, '(\S+)$'))[1], v_name);
      v_first := btrim(regexp_replace(v_name, '\s*\S+$', ''));
      if v_first = '' then
        v_first := v_last;
        v_last := '';
      end if;
      insert into ops.volunteers (first_name, last_name, focus_area, email, active)
      values (left(v_first, 120), left(v_last, 120), 'Activity Center', lower(m.email), true)
      returning id into v_person;
    end if;
    if m.person_id is distinct from v_person then
      update booking.volunteers set person_id = v_person where id = m.id;
    end if;
    if not exists (select 1 from ops.volunteer_hours where booking_request_id = p_request and volunteer_id = v_person) then
      insert into ops.volunteer_hours (volunteer_id, date, hours, activity, note, place, source, booking_request_id)
      values (v_person, r.date, least(r.attended_hours, 24), 'Activity Center', left(r.requestor_name || ' (' || r.seq_no || ')', 200), left(v_place, 120), 'booking', p_request);
    end if;
  end loop;
  -- Lines of people who are no longer counted as having come.
  delete from ops.volunteer_hours h
   where h.booking_request_id = p_request
     and not exists (select 1 from booking.volunteers bv where bv.request_id = p_request and bv.person_id = h.volunteer_id and coalesce(bv.came, true) and bv.email is not null);
end;
$$;
revoke all on function booking.sync_volunteer_log(uuid) from public, anon, authenticated;

create or replace function booking.sync_volunteer_log_on_request() returns trigger
language plpgsql security definer set search_path to 'booking', 'pg_temp' as $$
begin
  if new.status is distinct from old.status or new.attended_hours is distinct from old.attended_hours then
    perform booking.sync_volunteer_log(new.id);
  end if;
  return null;
end;
$$;
revoke all on function booking.sync_volunteer_log_on_request() from public, anon, authenticated;
drop trigger if exists sync_volunteer_log on booking.requests;
create trigger sync_volunteer_log after update of status, attended_hours on booking.requests
  for each row execute function booking.sync_volunteer_log_on_request();

create or replace function booking.sync_volunteer_log_on_member() returns trigger
language plpgsql security definer set search_path to 'booking', 'pg_temp' as $$
begin
  perform booking.sync_volunteer_log(coalesce(new.request_id, old.request_id));
  return null;
end;
$$;
revoke all on function booking.sync_volunteer_log_on_member() from public, anon, authenticated;
drop trigger if exists sync_volunteer_log on booking.volunteers;
-- Not on person_id: the log itself writes it.
create trigger sync_volunteer_log after insert or delete or update of came, name, email on booking.volunteers
  for each row execute function booking.sync_volunteer_log_on_member();

-- ---- 4. The Volunteers menu (module "volunteers") ----
alter table shared.module_access drop constraint if exists module_access_module_check;
alter table shared.module_access add constraint module_access_module_check
  check (module = any (array['executive', 'dashboard', 'calendar', 'staff', 'hr', 'patients', 'house_ops', 'donors', 'inventory', 'finance', 'compliance',
    'analytics', 'reports', 'settings', 'transport', 'inventory_stock', 'inventory_given_out', 'requests', 'shop', 'bookings', 'volunteers']));
alter table shared.staff_module_access drop constraint if exists staff_module_access_module_check;
alter table shared.staff_module_access add constraint staff_module_access_module_check
  check (module = any (array['executive', 'dashboard', 'calendar', 'staff', 'hr', 'patients', 'house_ops', 'donors', 'inventory', 'finance', 'compliance',
    'analytics', 'reports', 'transport', 'requests', 'shop', 'bookings', 'volunteers']));
alter table shared.role_page_access drop constraint if exists role_page_access_page_check;
alter table shared.role_page_access add constraint role_page_access_page_check
  check (page ~ '^(executive|dashboard|calendar|staff|hr|patients|house_ops|donors|inventory|finance|compliance|analytics|reports|transport|requests|shop|bookings|volunteers)\.[a-z_]+$');

-- Who reads and keeps volunteers: the Volunteers menu, and as before House Ops and Staff editors (House Staff keep
-- adding volunteers and logging hours by hand). Reading no longer comes with every Staff & Time
-- viewer: the list now holds people's email addresses.
drop policy if exists "module read" on ops.volunteers;
create policy "module read" on ops.volunteers for select to authenticated
  using ((select shared.module_viewable('volunteers')) or (select shared.module_editable('house_ops')) or (select shared.module_editable('staff')));
drop policy if exists "module insert" on ops.volunteers;
create policy "module insert" on ops.volunteers for insert to authenticated
  with check ((select shared.module_editable('volunteers')) or (select shared.module_editable('staff')) or (select shared.module_editable('house_ops')));
drop policy if exists "module update" on ops.volunteers;
create policy "module update" on ops.volunteers for update to authenticated
  using ((select shared.module_editable('volunteers')) or (select shared.module_editable('staff')) or (select shared.module_editable('house_ops')))
  with check ((select shared.module_editable('volunteers')) or (select shared.module_editable('staff')) or (select shared.module_editable('house_ops')));
drop policy if exists "module delete" on ops.volunteers;
create policy "module delete" on ops.volunteers for delete to authenticated
  using ((select shared.module_editable('volunteers')) or (select shared.module_editable('staff')));
drop policy if exists "volunteer hours read" on ops.volunteer_hours;
create policy "volunteer hours read" on ops.volunteer_hours for select to authenticated
  using ((select shared.module_viewable('volunteers')) or (select shared.module_editable('house_ops')) or (select shared.module_editable('staff')));
drop policy if exists "volunteer hours write" on ops.volunteer_hours;
create policy "volunteer hours write" on ops.volunteer_hours for all to authenticated
  using ((select shared.module_editable('volunteers')) or (select shared.module_editable('staff')) or (select shared.module_editable('house_ops')))
  with check ((select shared.module_editable('volunteers')) or (select shared.module_editable('staff')) or (select shared.module_editable('house_ops')));

-- The Volunteers page shows the groups, their bookings and members: its readers read those too.
alter table booking.groups enable row level security;
grant select, update on booking.groups to authenticated;
grant all on booking.groups to service_role;
drop policy if exists "volunteers readers read" on booking.groups;
create policy "volunteers readers read" on booking.groups for select to authenticated
  using ((select shared.module_viewable(variadic array['bookings', 'volunteers'])));
drop policy if exists "volunteers editors change" on booking.groups;
create policy "volunteers editors change" on booking.groups for update to authenticated
  using ((select shared.module_editable('bookings')) or (select shared.module_editable('volunteers')))
  with check ((select shared.module_editable('bookings')) or (select shared.module_editable('volunteers')));
do $$
declare
  t text;
begin
  foreach t in array array['places', 'requests', 'request_items', 'volunteers'] loop
    execute format('drop policy if exists "volunteers readers read" on booking.%I', t);
    execute format('create policy "volunteers readers read" on booking.%I for select to authenticated using ((select shared.module_viewable(''volunteers'')))', t);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'booking' and tablename = 'groups') then
    alter publication supabase_realtime add table booking.groups;
  end if;
end $$;

-- The page rows, on production only (the same test as 0174): Social Worker and Office Admin edit; CEO and
-- Accounting view; House Staff edit, as House Ops editors kept volunteers before (the Driver has only viewed House
-- Ops since 0130, so could not add volunteers, and gets no row). The old Staff & Time page
-- goes (its address forwards to the new menu).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'house-sheet-sync') then
    insert into shared.role_page_access (role, page, level)
    select r.role, p.page, r.level from (values ('volunteers.list')) p(page)
    cross join (values ('social_worker', 'edit'), ('office_admin', 'edit'), ('house_staff', 'edit'), ('finance', 'view'), ('ceo', 'view')) r(role, level)
    where exists (select 1 from shared.roles where key = r.role)
    on conflict do nothing;
    delete from shared.role_page_access where page = 'staff.volunteers';
  end if;
end $$;

-- ---- 5. The privacy notice: the line the owner approved ----
update booking.settings
   set privacy_notice = btrim(privacy_notice) || E'\n\n' || 'We keep the full names and email addresses of your volunteers to record their volunteer service with Little Ark Foundation: the dates and the places they volunteered. For a volunteer under 18, give a parent''s or guardian''s email address.',
       updated_at = now()
 where id and position('the dates and the places they volunteered' in privacy_notice) = 0;

notify pgrst, 'reload schema';
