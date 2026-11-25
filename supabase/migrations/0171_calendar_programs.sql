-- 0171: the calendar's programs (owner, 25 Nov 2026: ArkOS is the master calendar; no sheet is used after the
-- switch except the Occupancy Tracker). The Master Calendar workbook holds more than the yearly list of events:
-- it has a tab for Spiritual Care, one for Care Cart and one for the LAF Activity Center. Each of those is a kind
-- of calendar event, so an event now says which program it belongs to, and a Care Cart event carries the two
-- columns only that tab has (Menu, Name of Volunteers). The Birthday Celebrants tab needs nothing here: it is
-- the ongoing patients' birthdays, read from Patients.
--
-- ponytail: the four programs are a fixed list; a table of programs when management wants to add its own.

alter table ops.calendar_events
  add column if not exists program text not null default 'general'
    check (program in ('general', 'spiritual_care', 'care_cart', 'activity_center')),
  add column if not exists menu text check (menu is null or char_length(menu) <= 500),
  add column if not exists volunteers text check (volunteers is null or char_length(volunteers) <= 1000);

comment on column ops.calendar_events.program is
  'Which list the event belongs to (0171): general = the yearly list; spiritual_care, care_cart, activity_center = their own tabs in the copy sheet.';
comment on column ops.calendar_events.menu is 'Care Cart only (0171): the menu of the run.';
comment on column ops.calendar_events.volunteers is 'Care Cart only (0171): the names of the volunteers, as typed.';

create index if not exists calendar_events_program_idx on ops.calendar_events (program, date) where program <> 'general';

notify pgrst, 'reload schema';
