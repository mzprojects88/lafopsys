-- 0186: a group cancels its own booking only until the names are due, 3 days before the visit (owner, 27 Nov 2026),
-- the same cut-off as changing the date and the names. After that its page and the reminders say to contact Little
-- Ark Foundation; staff can still cancel at any time. Booking schema only.

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
    'canCancel', r.status in ('pending', 'approved') and booking.today() <= r.date - st.names_due_days,
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

CREATE OR REPLACE FUNCTION booking.web_cancel(p_ref text, p_caller text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'booking', 'pg_temp'
AS $function$
declare
  r booking.requests;
begin
  if not booking.within_limit('cancel', p_caller, 10, interval '1 hour') then
    raise exception 'Too many changes from here. Please try again later.' using errcode = '53400';
  end if;
  select * into r from booking.requests where ref = upper(regexp_replace(coalesce(p_ref, ''), '\s+', '', 'g')) for update;
  if not found then
    return null;
  end if;
  if r.status not in ('pending', 'approved') then
    raise exception 'This booking can no longer be cancelled here. Please write to us.' using errcode = '22023';
  end if;
  -- 0186: until the names are due (3 days before); after that the group tells Little Ark Foundation directly.
  if booking.today() > r.date - (select names_due_days from booking.settings where id) then
    raise exception 'Your visit is less than % days away, so it can no longer be cancelled here. Please contact Little Ark Foundation at info@littlearkfoundation.org as soon as you can.', (select names_due_days from booking.settings where id) using errcode = '22023';
  end if;
  update booking.requests set status = 'cancelled', updated_at = now() where id = r.id;
  insert into booking.events (request_id, by_requestor, action) values (r.id, true, 'cancelled');
  return booking.request_view(r.id);
end;
$function$;
