-- 0180: staff file a booking for someone who phoned or walked in (owner, 26 Nov 2026).
--
-- The rules of a request live in one function, booking.file_request, with two doors:
--   * booking.web_request (the public page): exactly as before;
--   * booking.staff_request (the Bookings page, for those who process bookings): the same rules for the slot, the
--     group and the program flow, but no limit per caller or per email address, an email address only if the
--     person has one, and a day inside the 14 days or beyond the 60 may be taken (never a booked, held, closed
--     or past one).
-- A request filed by staff starts as "pending approval" like any other, so an activity outside the NCH-approved
-- plan still needs the coordination note before it is approved. The request remembers how it came (web, phone,
-- walk-in) and who filed it.

alter table booking.requests
  add column if not exists channel text not null default 'web' check (channel in ('web', 'phone', 'walk_in')),
  add column if not exists filed_by uuid references shared.staff (id) deferrable initially immediate;
alter table booking.requests alter column email drop not null;
comment on column booking.requests.channel is 'How the request came: the public page, or filed by staff for a phone call or a walk-in.';
comment on column booking.requests.email is 'Empty only on a request staff filed for someone without an email address; no email is then sent.';

create or replace function booking.file_request(p jsonb, p_caller text, p_staff uuid) returns jsonb
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $$
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
  insert into booking.requests (ref, seq_no, place_id, date, start_time, end_time, requestor_name, requestor_kind, contact_person, email, mobile, volunteers_count, has_minors, consent_at, caller_hash, channel, filed_by)
  values (v_ref, v_seq, v_place.id, v_date, v_slot.start_time, v_slot.end_time, btrim(p->>'requestor_name'), coalesce(nullif(p->>'requestor_kind', ''), 'person'), btrim(p->>'contact_person'), nullif(v_email, ''),
          btrim(p->>'mobile'), coalesce(nullif(p->>'volunteers_count', '')::integer, 0), coalesce((p->>'has_minors')::boolean, false), now(), left(p_caller, 64),
          case when p_staff is null then 'web' when p->>'channel' = 'walk_in' then 'walk_in' else 'phone' end, p_staff)
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

  update booking.requests set off_plan = v_off_plan where id = v_id;
  insert into booking.events (request_id, actor, by_requestor, action, detail)
  values (v_id, p_staff, p_staff is null, 'requested',
          btrim(case when p_staff is null then '' when p->>'channel' = 'walk_in' then 'Filed by staff for a walk-in. ' else 'Filed by staff for a phone request. ' end
                || case when v_off_plan then 'An activity is not in the approved plan.' else '' end));
  return jsonb_build_object('id', v_id, 'ref', v_ref, 'seqNo', v_seq, 'offPlan', v_off_plan, 'replyDays', st.reply_days);
exception
  when check_violation or not_null_violation or invalid_text_representation then
    raise exception 'Some details are missing or too long. Please check the form and send it again.' using errcode = '22023';
  when unique_violation then
    raise exception 'That slot has just been taken. Please choose another.' using errcode = '22023';
end;
$$;

-- The public page's door: unchanged in what it accepts.
create or replace function booking.web_request(p jsonb, p_caller text) returns jsonb
language sql volatile security definer set search_path to 'booking', 'pg_temp' as $$
  select booking.file_request(p, p_caller, null);
$$;

-- The staff's door.
create or replace function booking.staff_request(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $$
begin
  if not shared.module_editable('bookings') then
    raise exception 'Only the people who process bookings can do that.' using errcode = '42501';
  end if;
  return booking.file_request(p, 'staff:' || auth.uid()::text, auth.uid());
end;
$$;

revoke all on function booking.file_request(jsonb, text, uuid) from public, anon, authenticated;
grant execute on function booking.file_request(jsonb, text, uuid) to service_role;
revoke all on function booking.staff_request(jsonb) from public, anon;
grant execute on function booking.staff_request(jsonb) to authenticated, service_role;
