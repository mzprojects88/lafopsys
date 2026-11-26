-- 0184: no more last-minute changes (Builds/Activity Center Booking/CHANGE-DATE-PLAN.md v3, approved 26 Nov 2026).
--   * The public gives its volunteers' names when it files a request (required whenever the form sends them; the
--     form before this release sends none and keeps working until the push). Staff may file with names missing.
--   * Each request the public files gets a confirm-by date: the visit less `names_due_days` (3). Staff must approve
--     by then; the next morning's job closes what was not confirmed ("Not confirmed in time"). Staff bookings and
--     staff moves carry no confirm-by date: staff took them on themselves.
--   * The group may change its date itself, until the confirm-by date, at most `max_date_changes` (2) times, to a
--     day open on the booking page. An approved booking goes back to pending approval, with a new confirm-by date.
--   * Booking alerts for staff by email (both off): a new request, and a morning summary of what waits.
-- Booking schema only (not copied between the databases). The 8 AM job (0178) now also runs on days when only
-- pending requests wait, so the expiry and the summary are not skipped.

alter table booking.settings
  add column if not exists max_date_changes integer not null default 2 check (max_date_changes between 0 and 5),
  add column if not exists alert_emails text not null default '' check (length(alert_emails) <= 600),
  add column if not exists alert_new_request boolean not null default false,
  add column if not exists alert_morning boolean not null default false;

alter table booking.requests add column if not exists confirm_by date;
update booking.requests r set confirm_by = r.date - st.names_due_days
  from booking.settings st where st.id and r.status = 'pending' and r.channel = 'web' and r.confirm_by is null;

-- The members of a request, written from a list of {name, email, under18}: used when the request is filed and when
-- the group corrects its names. An email shown with stars (as the group's page shows it) keeps the one on file.
create or replace function booking.put_members(p_request uuid, p_names jsonb) returns integer
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $$
declare
  v_old jsonb;
  v_entry jsonb;
  v_name text;
  v_email text;
  v_i integer := 0;
begin
  if jsonb_typeof(p_names) is distinct from 'array' then
    raise exception 'The volunteers could not be read. Please try again.' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(lower(btrim(name)), email), '{}'::jsonb) into v_old from booking.volunteers where request_id = p_request and email is not null;
  delete from booking.volunteers where request_id = p_request;
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
    values (p_request, v_i, v_name, v_email, case when jsonb_typeof(v_entry) = 'object' then coalesce((v_entry->>'under18')::boolean, false) else false end);
  end loop;
  return v_i;
end;
$$;
revoke all on function booking.put_members(uuid, jsonb) from public, anon, authenticated;

-- Moves a request's program to another slot of the same length (staff Move and the group's change of date). Items
-- taken from the NCH-approved plan stay "in the plan" only when that day's approved plan has them; otherwise they
-- count as off-plan, so staff coordinate with NCH again before approving.
create or replace function booking.shift_to(p_request uuid, p_date date, p_slot booking.slots) returns boolean
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $$
declare
  r booking.requests;
  v_off boolean;
begin
  select * into r from booking.requests where id = p_request;
  update booking.request_items set start_time = start_time + (p_slot.start_time - r.start_time), end_time = end_time + (p_slot.start_time - r.start_time) where request_id = r.id;
  update booking.request_items i set source = 'list'
   where i.request_id = r.id and i.source = 'plan'
     and not exists (select 1 from booking.plan_items pi join booking.plans pl on pl.id = pi.plan_id
                      where pl.place_id = r.place_id and pl.status = 'approved' and pl.month = date_trunc('month', p_date)::date
                        and pi.on_date = p_date and lower(pi.activity) = lower(i.activity));
  v_off := exists (select 1 from booking.request_items where request_id = r.id and source <> 'plan');
  update booking.requests set date = p_date, start_time = p_slot.start_time, end_time = p_slot.end_time, off_plan = v_off, updated_at = now() where id = r.id;
  return v_off;
end;
$$;
revoke all on function booking.shift_to(uuid, date, booking.slots) from public, anon, authenticated;

create or replace function booking.file_request(p jsonb, p_caller text, p_staff uuid) returns jsonb
language plpgsql security definer set search_path to 'booking', 'pg_temp' as $function$
declare
  st booking.settings;
  v_place booking.places;
  v_slot booking.slots;
  v_date date;
  v_start time;
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_count integer;
  v_items jsonb := coalesce(p->'items', '[]'::jsonb);
  v_item jsonb;
  v_i integer := 0;
  v_from time;
  v_to time;
  v_prev_end time;
  v_source text;
  v_activity text;
  v_off_plan boolean := false;
  v_id uuid;
  v_ref text;
  v_seq text;
  v_state text;
  v_named integer;
begin
  select * into st from booking.settings where id;
  if p_staff is null and (not booking.within_limit('request', p_caller, 6, interval '1 hour') or not booking.within_limit('request-day', p_caller, 20, interval '1 day')) then
    raise exception 'Too many requests were sent from here. Please try again later.' using errcode = '53400';
  end if;
  if coalesce((p->>'agree_guidelines')::boolean, false) is not true or coalesce((p->>'agree_privacy')::boolean, false) is not true then
    raise exception 'Please tick both boxes: the visit guidelines and the privacy notice.' using errcode = '22023';
  end if;
  if (p_staff is null or v_email <> '') and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200) then
    raise exception 'Please give an email address we can write to.' using errcode = '22023';
  end if;
  if p_staff is null and not booking.within_limit('request-email', v_email, 4, interval '1 hour') then
    raise exception 'Too many requests were sent for this email address. Please try again later.' using errcode = '53400';
  end if;

  begin
    v_date := (p->>'date')::date;
    v_start := (p->>'start_time')::time;
  exception when others then
    raise exception 'Please choose a day and a time slot.' using errcode = '22023';
  end;
  select * into v_place from booking.places where id = nullif(p->>'place_id', '')::uuid and open;
  if not found then
    raise exception 'That place is not open for booking.' using errcode = '22023';
  end if;
  select * into v_slot from booking.slots where place_id = v_place.id and active and weekday = extract(dow from v_date)::integer and start_time = v_start;
  if not found then
    raise exception 'That time slot is not offered on that day.' using errcode = '22023';
  end if;

  v_count := coalesce(nullif(p->>'volunteers_count', '')::integer, 0);
  if v_count < 1 or v_count > st.max_volunteers then
    raise exception 'A group is 1 to % volunteers.', st.max_volunteers using errcode = '22023';
  end if;

  -- One at a time per slot: two people sending at the same moment get one yes and one "just taken".
  perform pg_advisory_xact_lock(hashtext('booking.slot:' || v_place.id::text || v_date::text || v_start::text));
  select state into v_state from booking.slot_states(v_place.id, v_date, v_date) where start_time = v_start;
  if v_state is distinct from 'open' and not (p_staff is not null and v_state in ('too_soon', 'too_far')) then
    raise exception '%', case v_state
      when 'pending' then 'That slot has just been asked for by another group. Please choose another.'
      when 'booked' then 'That slot is already booked. Please choose another.'
      when 'too_soon' then format('Please book at least %s days ahead.', st.min_days_ahead)
      when 'too_far' then format('Bookings open %s days ahead. Please choose an earlier day.', st.max_days_ahead)
      else 'That day is not open for booking. Please choose another.' end
      using errcode = '22023';
  end if;

  select count(*) into v_count from booking.requests where lower(email) = v_email and status in ('pending', 'approved') and date >= booking.today();
  if p_staff is null and v_count >= st.max_open_requests then
    raise exception 'This email address already has % requests waiting or approved. Please wait for those, or write to us.', v_count using errcode = '22023';
  end if;

  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) not between 1 and 3 then
    raise exception 'The program flow needs 1 to 3 activities.' using errcode = '22023';
  end if;

  v_ref := booking.new_ref();
  v_seq := 'LAF-ACB-' || to_char(booking.today(), 'YYYY') || '-' || lpad(nextval('booking.request_seq')::text, 4, '0');
  insert into booking.requests (ref, seq_no, place_id, date, start_time, end_time, requestor_name, requestor_kind, contact_person, email, mobile, volunteers_count, has_minors, consent_at, caller_hash, channel, filed_by, confirm_by)
  values (v_ref, v_seq, v_place.id, v_date, v_slot.start_time, v_slot.end_time, btrim(p->>'requestor_name'), coalesce(nullif(p->>'requestor_kind', ''), 'person'), btrim(p->>'contact_person'), nullif(v_email, ''),
          btrim(p->>'mobile'), coalesce(nullif(p->>'volunteers_count', '')::integer, 0), coalesce((p->>'has_minors')::boolean, false), now(), left(p_caller, 64),
          case when p_staff is null then 'web' when p->>'channel' = 'walk_in' then 'walk_in' else 'phone' end, p_staff,
          case when p_staff is null then v_date - st.names_due_days end)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(v_items) loop
    v_i := v_i + 1;
    begin
      v_from := (v_item->>'start_time')::time;
      v_to := (v_item->>'end_time')::time;
    exception when others then
      raise exception 'Activity %: please give its start and end time.', v_i using errcode = '22023';
    end;
    if v_from is null or v_to is null or v_to <= v_from then
      raise exception 'Activity %: the end time must be after the start time.', v_i using errcode = '22023';
    end if;
    if v_from < v_slot.start_time or v_to > v_slot.end_time then
      raise exception 'Activity %: it must fit inside the slot (% to %).', v_i, to_char(current_date + v_slot.start_time, 'FMHH12:MI AM'), to_char(current_date + v_slot.end_time, 'FMHH12:MI AM') using errcode = '22023';
    end if;
    if v_prev_end is not null and v_from < v_prev_end then
      raise exception 'Activity %: it starts before the one before it has ended.', v_i using errcode = '22023';
    end if;
    v_prev_end := v_to;

    v_source := coalesce(v_item->>'source', 'suggested');
    v_activity := btrim(coalesce(v_item->>'activity', ''));
    if v_source = 'plan' then
      -- Must really be in the approved plan of that place, for that very day (0176); its name is taken from the plan.
      select i.activity into v_activity from booking.plan_items i join booking.plans pl on pl.id = i.plan_id
       where i.id = nullif(v_item->>'plan_item_id', '')::uuid and pl.place_id = v_place.id and pl.status = 'approved' and pl.month = date_trunc('month', v_date)::date and i.on_date = v_date;
      if not found then
        raise exception 'Activity %: that activity is not in the approved plan for that day. Please choose again.', v_i using errcode = '22023';
      end if;
    elsif v_source = 'list' then
      if not exists (select 1 from booking.activity_types a where a.active and lower(a.name) = lower(v_activity)) then
        raise exception 'Activity %: please choose an activity from the list, or suggest one.', v_i using errcode = '22023';
      end if;
      v_off_plan := true;
    else
      v_source := 'suggested';
      v_off_plan := true;
    end if;
    if length(v_activity) not between 2 and 80 then
      raise exception 'Activity %: please name the activity.', v_i using errcode = '22023';
    end if;

    insert into booking.request_items (request_id, position, activity, source, purpose, who, ages, gender, participants_note, start_time, end_time, materials)
    values (v_id, v_i, v_activity, v_source, left(btrim(coalesce(v_item->>'purpose', '')), 300), coalesce(nullif(v_item->>'who', ''), 'patients'), left(btrim(coalesce(v_item->>'ages', '')), 40),
            coalesce(nullif(v_item->>'gender', ''), 'all'), left(btrim(coalesce(v_item->>'note', '')), 200), v_from, v_to, left(btrim(coalesce(v_item->>'materials', '')), 500));
  end loop;

  -- The volunteers' names (0184). From the booking page every volunteer is named; staff may leave some for later.
  if p ? 'members' then
    v_named := booking.put_members(v_id, p->'members');
    if v_named > (select volunteers_count from booking.requests where id = v_id) then
      raise exception 'More names than volunteers. Please check the number of volunteers.' using errcode = '22023';
    end if;
    if p_staff is null and v_named <> (select volunteers_count from booking.requests where id = v_id) then
      raise exception 'Please give the full name and email of each volunteer.' using errcode = '22023';
    end if;
    update booking.requests set has_minors = has_minors or exists (select 1 from booking.volunteers where request_id = v_id and under_18) where id = v_id;
  end if;

  update booking.requests set off_plan = v_off_plan where id = v_id;
  insert into booking.events (request_id, actor, by_requestor, action, detail)
  values (v_id, p_staff, p_staff is null, 'requested',
          btrim(case when p_staff is null then '' when p->>'channel' = 'walk_in' then 'Filed by staff for a walk-in. ' else 'Filed by staff for a phone request. ' end
                || case when v_off_plan then 'An activity is not in the approved plan.' else '' end));
  return jsonb_build_object('id', v_id, 'ref', v_ref, 'seqNo', v_seq, 'offPlan', v_off_plan, 'replyDays', st.reply_days,
                            'confirmBy', case when p_staff is null then v_date - st.names_due_days end);
exception
  when check_violation or not_null_violation or invalid_text_representation then
    raise exception 'Some details are missing or too long. Please check the form and send it again.' using errcode = '22023';
  when unique_violation then
    raise exception 'That slot has just been taken. Please choose another.' using errcode = '22023';
end;
$function$;

-- The group corrects its names while the booking is pending or approved, until the names are due.
create or replace function booking.web_names(p_ref text, p_names jsonb, p_caller text) returns jsonb
language plpgsql security definer set search_path to 'booking', 'pg_temp' as $function$
declare
  r booking.requests;
  v_due integer;
  v_i integer;
begin
  if not booking.within_limit('names', p_caller, 20, interval '1 hour') then
    raise exception 'Too many changes from here. Please try again later.' using errcode = '53400';
  end if;
  select * into r from booking.requests where ref = upper(regexp_replace(coalesce(p_ref, ''), '\s+', '', 'g')) for update;
  if not found then
    return null;
  end if;
  select names_due_days into v_due from booking.settings where id;
  if r.status not in ('pending', 'approved') then
    raise exception 'The names of this booking can no longer be changed here. Please write to us.' using errcode = '22023';
  end if;
  if booking.today() > r.date - v_due then
    raise exception 'The names were due % days before the visit. Please write to us to change them.', v_due using errcode = '22023';
  end if;
  if jsonb_typeof(p_names) is distinct from 'array' or jsonb_array_length(p_names) > r.volunteers_count then
    raise exception 'This booking is for % volunteers. Please write to us if the number changed.', r.volunteers_count using errcode = '22023';
  end if;
  v_i := booking.put_members(r.id, p_names);
  insert into booking.events (request_id, by_requestor, action, detail) values (r.id, true, 'names', v_i || ' name(s) given.');
  return booking.request_view(r.id);
end;
$function$;

-- What the group's own page shows. Its history is the action and the day only: never a staff name or a note.
create or replace function booking.request_view(p_id uuid) returns jsonb
language sql stable security definer set search_path to 'booking', 'pg_temp' as $function$
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
    'canEditNames', r.status in ('pending', 'approved') and booking.today() <= r.date - st.names_due_days,
    'canCancel', r.status in ('pending', 'approved') and r.date > booking.today(),
    'confirmBy', case when r.status = 'pending' then r.confirm_by end,
    'dateChangesLeft', greatest(st.max_date_changes - (select count(*) from booking.events e where e.request_id = r.id and e.action = 'date_changed'), 0),
    'canChangeDate', r.status in ('pending', 'approved') and booking.today() <= r.date - st.names_due_days
      and (select count(*) from booking.events e where e.request_id = r.id and e.action = 'date_changed') < st.max_date_changes,
    'history', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'on', (e.at at time zone 'Asia/Manila')::date, 'byYou', e.by_requestor) order by e.at, e.id), '[]'::jsonb)
      from booking.events e where e.request_id = r.id and e.action in ('requested', 'approved', 'declined', 'cancelled', 'moved', 'date_changed', 'names', 'expired', 'completed', 'no_show')),
    'declineReason', case when r.status = 'declined' then r.decline_reason end,
    'approved', case when r.status in ('approved', 'completed') then jsonb_build_object(
        'instructions', pl.instructions, 'bookingInstructions', r.instructions,
        'coordinatorName', pl.coordinator_name, 'coordinatorPhone', pl.coordinator_phone) end,
    'replyDays', st.reply_days
  )
  from booking.requests r join booking.places pl on pl.id = r.place_id cross join (select * from booking.settings where id) st
  where r.id = p_id;
$function$;

-- The group changes its own date: to a slot open on the booking page, of the same length, at the same place.
create or replace function booking.web_change_date(p_ref text, p_date date, p_start time, p_caller text) returns jsonb
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $function$
declare
  r booking.requests;
  st booking.settings;
  v_slot booking.slots;
  v_state text;
  v_changes integer;
  v_from text;
begin
  if not booking.within_limit('change-date', p_caller, 10, interval '1 hour') then
    raise exception 'Too many changes from here. Please try again later.' using errcode = '53400';
  end if;
  select * into r from booking.requests where ref = upper(regexp_replace(coalesce(p_ref, ''), '\s+', '', 'g')) for update;
  if not found then
    return null;
  end if;
  select * into st from booking.settings where id;
  if r.status not in ('pending', 'approved') then
    raise exception 'The date of this booking can no longer be changed.' using errcode = '22023';
  end if;
  if booking.today() > r.date - st.names_due_days then
    raise exception 'The date can be changed until % days before the visit. Please cancel instead, or write to us.', st.names_due_days using errcode = '22023';
  end if;
  select count(*) into v_changes from booking.events where request_id = r.id and action = 'date_changed';
  if v_changes >= st.max_date_changes then
    raise exception 'This booking''s date was already changed % times. Please cancel it and book again, or write to us.', v_changes using errcode = '22023';
  end if;
  if p_date is null or p_start is null then
    raise exception 'Please choose a day and a time slot.' using errcode = '22023';
  end if;
  if p_date = r.date and p_start = r.start_time then
    raise exception 'That is the day and time you already have.' using errcode = '22023';
  end if;
  select * into v_slot from booking.slots where place_id = r.place_id and active and weekday = extract(dow from p_date)::integer and start_time = p_start;
  if not found then
    raise exception 'That time slot is not offered on that day.' using errcode = '22023';
  end if;
  if (v_slot.end_time - v_slot.start_time) <> (r.end_time - r.start_time) then
    raise exception 'That slot is a different length, so your program would not fit. Please choose another.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('booking.slot:' || r.place_id::text || p_date::text || p_start::text));
  select state into v_state from booking.slot_states(r.place_id, p_date, p_date) where start_time = p_start;
  if v_state is distinct from 'open' then
    raise exception '%', case v_state
      when 'pending' then 'That slot has just been asked for by another group. Please choose another.'
      when 'booked' then 'That slot is already booked. Please choose another.'
      when 'too_soon' then format('Please choose a day at least %s days ahead.', st.min_days_ahead)
      when 'too_far' then format('Bookings open %s days ahead. Please choose an earlier day.', st.max_days_ahead)
      else 'That day is not open for booking. Please choose another.' end
      using errcode = '22023';
  end if;
  v_from := to_char(r.date, 'Mon DD, YYYY') || ' ' || to_char(current_date + r.start_time, 'FMHH12:MI AM');
  perform booking.shift_to(r.id, p_date, v_slot);
  -- Back to pending approval on the new day: staff confirm it again (and coordinate with NCH again if needed).
  update booking.requests set status = 'pending', decided_by = null, decided_at = null,
         nch_contact = null, nch_coordinated_at = null, nch_notes = null,
         confirm_by = p_date - st.names_due_days, updated_at = now()
   where id = r.id;
  insert into booking.events (request_id, by_requestor, action, detail)
  values (r.id, true, 'date_changed', 'From ' || v_from || ' to ' || to_char(p_date, 'Mon DD, YYYY') || ' ' || to_char(current_date + v_slot.start_time, 'FMHH12:MI AM')
          || case when r.status = 'approved' then '. It was approved: back to pending approval.' else '.' end);
  return booking.request_view(r.id) || jsonb_build_object('id', r.id);
exception
  when unique_violation then
    raise exception 'That slot has just been taken. Please choose another.' using errcode = '22023';
end;
$function$;
revoke all on function booking.web_change_date(text, date, time, text) from public, anon, authenticated;
grant execute on function booking.web_change_date(text, date, time, text) to service_role;

-- What was not confirmed by its confirm-by date is closed the next morning; the slot is free again. Returns the
-- requests closed, for their emails.
create or replace function booking.expire_unconfirmed() returns setof uuid
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $function$
declare
  v_id uuid;
begin
  for v_id in
    update booking.requests set status = 'declined', decline_reason = 'Not confirmed in time. Please choose another day on our booking page.', decided_at = now(), updated_at = now()
     where status = 'pending' and confirm_by is not null and confirm_by < booking.today()
    returning id
  loop
    insert into booking.events (request_id, action, detail) values (v_id, 'expired', 'Not confirmed by its confirm-by date.');
    return next v_id;
  end loop;
end;
$function$;
revoke all on function booking.expire_unconfirmed() from public, anon, authenticated;
grant execute on function booking.expire_unconfirmed() to service_role;

-- Staff steps: approval refuses a request past its confirm-by date (it is closed the next morning; staff may file it
-- again as a staff booking); a staff Move takes the booking on itself (no confirm-by date) and re-checks the plan.
create or replace function booking.decide(p_id uuid, p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path to 'booking', 'pg_temp' as $function$
declare
  r booking.requests;
  v_uid uuid := auth.uid();
  v_date date;
  v_start time;
  v_slot booking.slots;
  v_state text;
  v_reason text := btrim(coalesce(p->>'reason', ''));
  v_contact text := btrim(coalesce(p->>'nch_contact', ''));
begin
  if not shared.module_editable('bookings') then
    raise exception 'Only the people who process bookings can do that.' using errcode = '42501';
  end if;
  select * into r from booking.requests where id = p_id for update;
  if not found then
    raise exception 'That request was not found.' using errcode = 'P0002';
  end if;

  if p_action = 'approve' then
    if r.status <> 'pending' then
      raise exception 'Only a request that is pending approval can be approved.' using errcode = '22023';
    end if;
    if r.confirm_by is not null and booking.today() > r.confirm_by then
      raise exception 'This request had to be confirmed by %. It closes tomorrow morning; to take the group anyway, file it as a staff booking.', to_char(r.confirm_by, 'Mon DD, YYYY') using errcode = '22023';
    end if;
    if r.off_plan then
      -- Her approval says it is coordinated with NCH: who she spoke with and when must be on record first.
      v_contact := coalesce(nullif(v_contact, ''), r.nch_contact, '');
      if length(v_contact) < 2 or coalesce(nullif(p->>'nch_coordinated_at', '')::timestamptz, r.nch_coordinated_at) is null then
        raise exception 'An activity here is not in the NCH-approved plan. Record who at NCH you coordinated with, and when, before approving.' using errcode = '22023';
      end if;
      update booking.requests set nch_contact = left(v_contact, 120), nch_coordinated_at = coalesce(nullif(p->>'nch_coordinated_at', '')::timestamptz, nch_coordinated_at),
             nch_notes = coalesce(nullif(left(btrim(coalesce(p->>'nch_notes', '')), 1000), ''), nch_notes) where id = r.id;
    end if;
    update booking.requests set status = 'approved', decided_by = v_uid, decided_at = now(), updated_at = now(),
           instructions = coalesce(nullif(left(btrim(coalesce(p->>'instructions', '')), 2000), ''), instructions) where id = r.id;
    insert into booking.events (request_id, actor, action, detail) values (r.id, v_uid, 'approved', case when r.off_plan then 'Coordinated with NCH: ' || left(v_contact, 120) else '' end);

  elsif p_action = 'decline' then
    if r.status <> 'pending' then
      raise exception 'Only a request that is pending approval can be declined.' using errcode = '22023';
    end if;
    if length(v_reason) not between 5 and 500 then
      raise exception 'Say why it is declined (5 to 500 characters): the requestor is told.' using errcode = '22023';
    end if;
    update booking.requests set status = 'declined', decline_reason = v_reason, decided_by = v_uid, decided_at = now(), updated_at = now() where id = r.id;
    insert into booking.events (request_id, actor, action, detail) values (r.id, v_uid, 'declined', v_reason);

  elsif p_action = 'cancel' then
    if r.status not in ('pending', 'approved') then
      raise exception 'This booking is already closed.' using errcode = '22023';
    end if;
    update booking.requests set status = 'cancelled', decided_by = v_uid, decided_at = now(), updated_at = now() where id = r.id;
    insert into booking.events (request_id, actor, action, detail) values (r.id, v_uid, 'cancelled', left(v_reason, 500));

  elsif p_action = 'move' then
    if r.status not in ('pending', 'approved') then
      raise exception 'Only a pending or an approved booking can be moved.' using errcode = '22023';
    end if;
    v_date := (p->>'date')::date;
    v_start := (p->>'start_time')::time;
    select * into v_slot from booking.slots where place_id = r.place_id and active and weekday = extract(dow from v_date)::integer and start_time = v_start;
    if not found then
      raise exception 'That time slot is not offered on that day.' using errcode = '22023';
    end if;
    if (v_slot.end_time - v_slot.start_time) <> (r.end_time - r.start_time) then
      raise exception 'That slot is a different length, so the program flow would not fit. Ask the group to book it afresh.' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtext('booking.slot:' || r.place_id::text || v_date::text || v_start::text));
    select state into v_state from booking.slot_states(r.place_id, v_date, v_date) where start_time = v_start;
    -- Staff may move into a day that is too soon or too far for the public, never into a taken or closed one.
    if v_state not in ('open', 'too_soon', 'too_far') then
      raise exception 'That slot is not free (%).', v_state using errcode = '22023';
    end if;
    insert into booking.events (request_id, actor, action, detail) values (r.id, v_uid, 'moved', 'From ' || to_char(r.date, 'Mon DD, YYYY') || ' ' || to_char(current_date + r.start_time, 'FMHH12:MI AM'));
    perform booking.shift_to(r.id, v_date, v_slot);
    update booking.requests set confirm_by = null where id = r.id;

  elsif p_action in ('complete', 'no_show') then
    if r.status <> 'approved' then
      raise exception 'Only an approved booking can be closed after the visit.' using errcode = '22023';
    end if;
    if r.date > booking.today() then
      raise exception 'The visit has not happened yet.' using errcode = '22023';
    end if;
    if p_action = 'complete' then
      update booking.requests set status = 'completed', updated_at = now(),
             attended_children = nullif(p->>'children', '')::integer, attended_volunteers = nullif(p->>'volunteers', '')::integer, attended_hours = nullif(p->>'hours', '')::numeric
       where id = r.id;
      insert into booking.events (request_id, actor, action, detail) values (r.id, v_uid, 'completed',
        coalesce(p->>'children', '0') || ' children, ' || coalesce(p->>'volunteers', '0') || ' volunteers, ' || coalesce(p->>'hours', '0') || ' hours');
    else
      update booking.requests set status = 'no_show', updated_at = now() where id = r.id;
      insert into booking.events (request_id, actor, action) values (r.id, v_uid, 'no_show');
    end if;

  else
    raise exception 'Unknown step.' using errcode = '22023';
  end if;

  return booking.request_view(r.id) || jsonb_build_object('id', r.id);
end;
$function$;

-- The 8 AM job (0178) now also runs when only pending requests wait: the expiry and the morning summary need it.
do $$
declare
  v_job bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'house-sheet-sync') then
    select jobid into v_job from cron.job where jobname = 'booking-reminders';
    if v_job is not null then
      perform cron.alter_job(v_job, command := $job$
      select net.http_post(
        url := 'https://lafopsys.vercel.app/api/bookings/reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_sync_secret' limit 1)
        ),
        body := '{"trigger":"cron"}'::jsonb,
        timeout_milliseconds := 60000
      )
      where exists (select 1 from booking.requests where status in ('approved', 'pending') and date >= booking.today())
         or exists (select 1 from booking.outbox where status in ('queued', 'held'));
      $job$);
    end if;
  end if;
end $$;
