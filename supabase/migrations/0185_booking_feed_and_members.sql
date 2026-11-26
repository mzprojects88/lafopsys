-- 0185: two follow-ups to 0184 (26 Nov 2026).
--   * The Calendar entry of a booking follows it back out of "approved": a group that changes the date of an approved
--     booking puts it back to pending (0184), and a pending request may then be declined or close unconfirmed. Before,
--     only a cancellation took the entry off; now leaving "approved" for pending, declined or cancelled does, and a new
--     approval puts it back on the right day. (feeds_ops is on only on production; the Calendar is copied hourly.)
--   * Staff may add the people who turn up on the day beyond the number booked: the booking's number of volunteers
--     follows its members upward (never down), up to the 100 the table allows. Staff edits only.

create or replace function booking.feed_ops() returns trigger
language plpgsql security definer set search_path to 'booking', 'ops', 'pg_temp' as $function$
declare
  v_place booking.places;
  v_title text;
  v_time text := to_char(current_date + new.start_time, 'FMHH12:MI AM') || ' - ' || to_char(current_date + new.end_time, 'FMHH12:MI AM');
begin
  if not coalesce((select feeds_ops from booking.settings where id), false) then
    return new;
  end if;
  select * into v_place from booking.places where id = new.place_id;
  select left(new.requestor_name || ': ' || coalesce(string_agg(i.activity, ', ' order by i.position), 'Activity'), 200)
    into v_title from booking.request_items i where i.request_id = new.id;

  -- The Calendar: there from approval, moved with the booking, gone when it is no longer approved (0185).
  if new.status = 'approved' and old.status is distinct from 'approved' and new.calendar_event_id is null then
    insert into ops.calendar_events (date, time, title, venue, booked_by, contact_info, remarks, program, source, created_by)
    values (new.date, v_time, v_title, v_place.name, new.requestor_name, left(new.contact_person || ', ' || new.mobile, 200),
            'LAF Activity Center booking ' || new.seq_no || ' (' || new.volunteers_count || ' volunteers). Managed on the Bookings page.',
            'activity_center', 'app', new.decided_by)
    returning id into new.calendar_event_id;
  elsif new.status = 'approved' and new.calendar_event_id is not null
        and (new.date, new.start_time, new.end_time) is distinct from (old.date, old.start_time, old.end_time) then
    update ops.calendar_events set date = new.date, time = v_time, updated_at = now() where id = new.calendar_event_id;
  elsif new.status in ('cancelled', 'pending', 'declined') and new.calendar_event_id is not null then
    delete from ops.calendar_events where id = new.calendar_event_id and source = 'app' and program = 'activity_center';
    new.calendar_event_id := null;
  end if;

  -- The visit: one Activity Center session, with who came and for how long.
  if new.status = 'completed' and old.status is distinct from 'completed' and new.session_id is null then
    insert into ops.activity_sessions (date, title, participants, volunteer_count, facilitator, hours, source, site)
    values (new.date, v_title, coalesce(new.attended_children, 0), coalesce(new.attended_volunteers, 0), left(new.requestor_name, 200),
            coalesce(new.attended_hours, 0), 'app', v_place.site)
    returning id into new.session_id;
  end if;
  return new;
end;
$function$;

-- The count rises for a staff edit made on the Bookings page (signed in, through the table rules). The trigger runs
-- as the person acting, so the public doors (which write as the database owner, through 0184's put_members) keep
-- their own "no more names than volunteers" rule; the raise itself is a staff-only step.
create or replace function booking.raise_count(p_request uuid) returns void
language plpgsql security definer set search_path to 'booking', 'pg_temp' as $function$
begin
  if not shared.module_editable('bookings') then
    return;
  end if;
  update booking.requests r set volunteers_count = least(m.n, 100), updated_at = now()
    from (select count(*)::integer n from booking.volunteers where request_id = p_request) m
   where r.id = p_request and m.n > r.volunteers_count;
end;
$function$;
revoke all on function booking.raise_count(uuid) from public, anon;
grant execute on function booking.raise_count(uuid) to authenticated;

create or replace function booking.count_follows_members() returns trigger
language plpgsql security invoker set search_path to 'booking', 'pg_temp' as $function$
begin
  if current_user = 'authenticated' then
    perform booking.raise_count(new.request_id);
  end if;
  return null;
end;
$function$;
drop trigger if exists count_follows_members on booking.volunteers;
create trigger count_follows_members after insert on booking.volunteers
  for each row execute function booking.count_follows_members();
