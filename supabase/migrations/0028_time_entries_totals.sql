-- Persisted per-day totals on the daily summary, so timesheets and payroll (which
-- read ops.time_entries, readable by every lafopsys role) can show hours without
-- reading ops.time_punches (own-row for most roles).
--
-- Source of truth stays ops.time_punches: a session is a clock_in punch paired
-- with the next clock_out for the same person, duration from punched_at, never
-- from the HH:mm text columns (an overnight session reads out "02:00" before in
-- "22:00"). The pairing rules live in lib/utils/dtr.ts and are applied by
-- app/api/dtr/punch/route.ts on every punch. From this migration on a clock-in
-- after a clock-out reopens the day (clock_out -> null) instead of overwriting
-- clock_in, so clock_in is the day's first in, clock_out its latest out, and
-- every session in between is in the punches.
--
-- Backfill below applies the same rules once to history. Old rows were written
-- by the overwriting route, so all of a day's clock_in punches carry the same
-- time_entry_id; attribution through the clock_in punch is exact. Entries with
-- HH:mm text but no punches (pre-0017 seed data) fall back to the text diff.
-- Dates of historical rows are left alone: some were recorded under the UTC
-- date and rewriting them would collide with unique (staff_id, date).

alter table ops.time_entries
  add column total_minutes integer not null default 0 check (total_minutes >= 0),
  add column session_count integer not null default 0 check (session_count >= 0);

comment on column ops.time_entries.total_minutes is
  'Minutes of completed sessions for the day, computed from ops.time_punches by the punch route (lib/utils/dtr.ts).';
comment on column ops.time_entries.session_count is
  'Clock-in sessions the day had (open ones included). Sessions themselves are in ops.time_punches.';

with ordered as (
  select staff_id, time_entry_id, punch_type, punched_at,
         lag(punch_type)    over w as prev_type,
         lag(punched_at)    over w as prev_at,
         lag(time_entry_id) over w as prev_entry
  from ops.time_punches
  window w as (partition by staff_id order by punched_at, id)
),
sessions as (
  select coalesce(prev_entry, time_entry_id) as entry_id,
         extract(epoch from (punched_at - prev_at)) / 60 as minutes
  from ordered
  where punch_type = 'clock_out'
    and prev_type = 'clock_in'
    and punched_at - prev_at <= interval '25 hours'
),
starts as (
  select time_entry_id as entry_id, count(*) as n
  from ops.time_punches
  where punch_type = 'clock_in' and time_entry_id is not null
  group by 1
)
update ops.time_entries e set
  total_minutes = coalesce(
    (select floor(sum(s.minutes))::int from sessions s where s.entry_id = e.id),
    case
      when e.clock_in ~ '^\d\d:\d\d$' and e.clock_out ~ '^\d\d:\d\d$' and e.clock_out::time > e.clock_in::time
        then (extract(epoch from (e.clock_out::time - e.clock_in::time)) / 60)::int
      else 0
    end),
  session_count = coalesce(
    (select st.n::int from starts st where st.entry_id = e.id),
    case when e.clock_in is not null then 1 else 0 end);
