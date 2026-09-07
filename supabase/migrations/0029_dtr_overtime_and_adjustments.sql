-- Three changes to time tracking, all of them about the same thing: making the
-- numbers on a timesheet mean something.
--
-- 1. OVERTIME becomes real. ops.time_entries.overtime_minutes has been `not
--    null default 0` since 0013 and nothing has ever written to it, so the
--    "Total Overtime" figure on the payroll page has always read 0h 0m. It is
--    dropped rather than filled in: overtime is total minutes past a daily
--    threshold, which is arithmetic over a number we already store, and a
--    stored copy would go stale the moment the threshold changed. The
--    threshold itself moves to app_settings so an admin can set it.
--
-- 2. BREAKS are dropped. break_minutes has the same never-written history and
--    all seven existing rows are 0. The foundation's answer was that breaks
--    are not tracked, so the column goes rather than sitting there implying
--    the system knows something it does not.
--
-- 3. A FORGOTTEN CLOCK-OUT becomes fixable. Four of the seven recorded days
--    have a clock-in and no clock-out, which reads as zero hours worked. An
--    admin can now supply the missing time -- but as an ADDITIONAL punch
--    marked `source = 'adjustment'` and signed, never by editing a punch.
--    0017 put it plainly: a time record that can be quietly edited after the
--    fact is not a time record. This keeps that, because an adjustment adds a
--    row that says what it is and who made it, rather than changing one.

-- ---------------------------------------------------------------------
-- 1. The overtime threshold
-- ---------------------------------------------------------------------

-- 480 = 8 hours, the Labor Code's normal working day (Art. 83). Bounded so a
-- typo cannot set it to a value that makes every minute overtime, or none.
alter table shared.app_settings
  add column overtime_threshold_minutes integer not null default 480
    check (overtime_threshold_minutes between 60 and 1440);

-- ---------------------------------------------------------------------
-- 2. Columns nothing ever wrote
-- ---------------------------------------------------------------------

alter table ops.time_entries
  drop column break_minutes,
  drop column overtime_minutes;

-- ---------------------------------------------------------------------
-- 3. Adjustment punches
-- ---------------------------------------------------------------------

alter table ops.time_punches
  add column source text not null default 'device'
    check (source in ('device', 'adjustment')),
  add column adjustment_reason text,
  add column adjusted_by uuid references shared.staff (id);

-- An adjustment must say why and by whom; a device punch must claim neither.
-- Both halves matter: without the second, a real punch could be given a
-- reason after the fact and read as though it had been reviewed.
alter table ops.time_punches
  add constraint time_punches_adjustment_complete check (
    (source = 'device' and adjustment_reason is null and adjusted_by is null)
    or (source = 'adjustment' and adjustment_reason is not null and adjusted_by is not null)
  );

-- Existing policy let a staff member insert any punch for themselves. Narrowed
-- to device punches, so nobody can sign their own correction.
drop policy "insert own punches" on ops.time_punches;
create policy "insert own punches" on ops.time_punches
  for insert
  to authenticated
  with check (staff_id = auth.uid() and source = 'device');

-- Admins only, and `adjusted_by = auth.uid()` means the signature is the
-- database's own account for the caller, not a name the request supplied.
-- Still no update or delete policy on this table, for anyone.
create policy "admins insert adjustment punches" on ops.time_punches
  for insert
  to authenticated
  with check (
    source = 'adjustment'
    and adjusted_by = auth.uid()
    and shared.current_staff_role() = 'admin'
  );

-- Admins already read every punch (0017). They also need to update the day's
-- summary row for a staff member who is not them, so the corrected clock-out
-- and totals land. ops.time_entries' blanket lafopsys-staff policy covers the
-- lafopsys roles; this makes the admin case explicit rather than incidental.
create policy "admins update any time entry" on ops.time_entries
  for update
  to authenticated
  using (shared.current_staff_role() = 'admin')
  with check (shared.current_staff_role() = 'admin');
