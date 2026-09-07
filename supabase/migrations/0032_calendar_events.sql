-- The foundation's master calendar, moved out of a Google Sheet.
--
-- The sheet ("LAF Master Calendar 2026") is a one-row-per-event log: Date,
-- Time, Event, Venue, Officer on Duty, Staff Needed, Booked By, Contact,
-- Remarks. lib/types/calendar.ts has mirrored it since the data-integration
-- pass, and scripts/clean-calendar-data.py has parsed it; what never existed
-- was a table to keep it in or a screen to look at it. This is the table.
-- The screen is /calendar. From here on the app is where the calendar is
-- maintained; the sheet is history.
--
-- Shapes that follow the data rather than fight it:
--   * time is TEXT, like ops.shifts.start_time and ops.appointments.time.
--     The sheet has "12:00 NN", "10:30 AM - 12:00 NN", "All day", "TBD" and a
--     dozen more forms. A time column would reject half of them.
--   * venue is advisory text. LAF / NCH / OTHER / TEAMS / ONLINE / HOLIDAY
--     are the values in use and the app offers them, but 26 events have no
--     venue at all and a CHECK would only force people to lie.
--   * officer_on_duty stays text ("Butch", "Des", "Cath", "Queen").
--     officer_staff_id is there for the day a picker maps them to accounts.
--   * is_holiday is derived at import from three inconsistent conventions
--     in the sheet, and editable afterwards.
--
-- Access: any active staff member can read it (inventory roles included --
-- the kitchen needs to know when 25 kids are coming for lunch); admins and
-- social workers, who are the people actually booking things, can write.

create table ops.calendar_events (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  time text,
  title text not null,
  venue text,
  officer_on_duty text,
  officer_staff_id uuid references shared.staff (id),
  staff_needed text,
  booked_by text,
  contact_info text,
  remarks text,
  is_holiday boolean not null default false,
  created_by uuid references shared.staff (id),
  updated_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Import idempotency. Postgres treats NULLs as distinct in a unique
-- constraint, so an untimed event needs the partial index as well.
alter table ops.calendar_events
  add constraint calendar_events_natural_key unique (date, title, time);
create unique index calendar_events_natural_key_untimed
  on ops.calendar_events (date, title) where time is null;

create index calendar_events_date_idx on ops.calendar_events (date);

alter table ops.calendar_events enable row level security;

create policy "staff read calendar" on ops.calendar_events
  for select to authenticated
  using (shared.current_staff_role() is not null);

create policy "admin and social workers manage calendar" on ops.calendar_events
  for all to authenticated
  using (shared.current_staff_role() in ('admin', 'social_worker'))
  with check (shared.current_staff_role() in ('admin', 'social_worker'));

create trigger set_updated_at
  before update on ops.calendar_events
  for each row execute function shared.set_updated_at();

-- 0027's publication loop ran once; a new table adds itself.
alter publication supabase_realtime add table ops.calendar_events;
