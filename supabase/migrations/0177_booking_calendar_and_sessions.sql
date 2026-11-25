-- 0177: what a booking leaves in the rest of ArkOS (the approved plan, part "after the visit"):
--   * an APPROVED booking is on the ArkOS Calendar, under the program LAF Activity Center, and so in the copy
--     sheet's "LAF Activity Center" tab; it follows the booking when it is moved and leaves when it is cancelled;
--   * a RECORDED visit becomes an Activity Center session (children, volunteers, hours), which is what the
--     Program Impact report counts.
--
-- Both are written by one trigger on booking.requests, so every door that changes a booking (a staff step, the
-- group cancelling from its own page) is covered once.
--
-- ops.calendar_events and ops.activity_sessions are copied between development and production every hour. A
-- test booking on development must never reach production's Calendar or its report, so the trigger writes only
-- where booking.settings.feeds_ops is on, and this migration turns it on only on production (the database
-- that runs the scheduled jobs, the same test as 0161 and 0174).

alter table booking.settings add column if not exists feeds_ops boolean not null default false;
comment on column booking.settings.feeds_ops is 'On production only: approved bookings are written to the Calendar and recorded visits to the Activity Center sessions (both are copied between the databases).';

-- Plain ids, not links: the rows live in tables the hourly copy rewrites.
alter table booking.requests
  add column if not exists calendar_event_id uuid,
  add column if not exists session_id uuid;

create or replace function booking.feed_ops() returns trigger
language plpgsql security definer set search_path to 'booking', 'ops', 'pg_temp' as $$
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

  -- The Calendar: there from approval, moved with the booking, gone when it is cancelled.
  if new.status = 'approved' and old.status is distinct from 'approved' and new.calendar_event_id is null then
    insert into ops.calendar_events (date, time, title, venue, booked_by, contact_info, remarks, program, source, created_by)
    values (new.date, v_time, v_title, v_place.name, new.requestor_name, left(new.contact_person || ', ' || new.mobile, 200),
            'LAF Activity Center booking ' || new.seq_no || ' (' || new.volunteers_count || ' volunteers). Managed on the Bookings page.',
            'activity_center', 'app', new.decided_by)
    returning id into new.calendar_event_id;
  elsif new.status = 'approved' and new.calendar_event_id is not null
        and (new.date, new.start_time, new.end_time) is distinct from (old.date, old.start_time, old.end_time) then
    update ops.calendar_events set date = new.date, time = v_time, updated_at = now() where id = new.calendar_event_id;
  elsif new.status = 'cancelled' and new.calendar_event_id is not null then
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
$$;
-- A trigger function: nobody calls it directly.
revoke all on function booking.feed_ops() from public, anon, authenticated;

drop trigger if exists feed_ops on booking.requests;
create trigger feed_ops before update of status, date, start_time, end_time on booking.requests
  for each row execute function booking.feed_ops();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'house-sheet-sync') then
    update booking.settings set feeds_ops = true where id;
  end if;
end $$;
