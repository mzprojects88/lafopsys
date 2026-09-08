-- Retires two ops tables the HR module replaces, tightens the DTR summary
-- table's policies, and gives the roster a staff-readable view.
--
-- ops.shifts (0013) was never written to: no screen ever created a shift,
-- and the roster page drew a seeded week around a frozen demo date. The
-- weekly pattern in hr.work_schedules plus hr.schedule_overrides (0036,
-- 0039) is what the roster reads now.
--
-- ops.timesheet_approvals (0013) was never inserted into either: the
-- approval queue on /staff/timesheets showed nothing, forever. Approval is
-- per employee per pay period in hr.period_timesheets (0039).
--
-- ops.time_entries carried 0015's blanket "lafopsys staff full access"
-- policy -- a driver or a volunteer could read and rewrite anyone's daily
-- summary. Replaced with: everyone on staff reads (the roster card shows
-- who is clocked in), each person writes their own row (the punch route
-- inserts, updates, and DELETES the row it just inserted when a punch
-- fails -- app/api/dtr/punch/route.ts), admins keep their update (0029),
-- and HR reads and updates any row. 0018's inventory-role own policies
-- stay and gain the same own delete.
--
-- ops.time_punches: HR-flagged people who are not admins must read every
-- punch to compute a timesheet (hr.period_timesheets); 0017 let only
-- admin and finance. The append-only rule is untouched.

drop table if exists ops.timesheet_approvals;
drop table if exists ops.shifts;

-- ---------------------------------------------------------------------------
-- ops.time_entries
-- ---------------------------------------------------------------------------

drop policy if exists "lafopsys staff full access" on ops.time_entries;

create policy "staff read time entries" on ops.time_entries
  for select to authenticated
  using (shared.current_staff_role() is not null);

create policy "own time entry insert" on ops.time_entries
  for insert to authenticated
  with check (staff_id = auth.uid());

create policy "own time entry update" on ops.time_entries
  for update to authenticated
  using (staff_id = auth.uid())
  with check (staff_id = auth.uid());

-- The punch route's rollback path: delete the summary row it just created
-- when the punch insert behind it fails, so a half-written day never stands.
create policy "own time entry delete" on ops.time_entries
  for delete to authenticated
  using (staff_id = auth.uid());

create policy "hr manage time entries" on ops.time_entries
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

-- 0018's inventory-role policies are now subsumed by the own-row ones above
-- (they were only ever a carve-out from the lafopsys-roles gate).
drop policy if exists "inventory roles read own time entry" on ops.time_entries;
drop policy if exists "inventory roles insert own time entry" on ops.time_entries;
drop policy if exists "inventory roles update own time entry" on ops.time_entries;

-- ---------------------------------------------------------------------------
-- ops.time_punches
-- ---------------------------------------------------------------------------

create policy "hr reads all punches" on ops.time_punches
  for select to authenticated
  using (hr.is_hr_staff());

-- ---------------------------------------------------------------------------
-- The roster view
-- ---------------------------------------------------------------------------

-- Who is on the roster: name, position and the login id for every working
-- employee, readable by everyone on staff. hr.employees itself stays HR +
-- own-row; the roster only needs what shared.staff already shows about a
-- colleague. Runs with the definer's privileges (a plain view), which is
-- the point: it is the one sanctioned window onto the table.
create view hr.v_roster as
  select id as employee_id, staff_id, first_name, last_name, position, status
  from hr.employees
  where status in ('active', 'on_leave');

grant select on hr.v_roster to authenticated, service_role;
