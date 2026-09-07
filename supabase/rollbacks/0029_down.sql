-- Reverses 0029.
--
-- DESTRUCTIVE in one direction that matters: dropping `source`,
-- `adjustment_reason` and `adjusted_by` from ops.time_punches does not delete
-- the adjustment punches themselves, but it erases the fact that they WERE
-- adjustments. Afterwards a supplied clock-out is indistinguishable from one
-- somebody actually made on a device, which is the opposite of what 0029 was
-- for. Export ops.time_punches before running this if any adjustments exist:
--
--   select id, staff_id, punched_at, adjustment_reason, adjusted_by
--   from ops.time_punches where source = 'adjustment';
--
-- break_minutes and overtime_minutes come back as the all-zero columns they
-- always were. Nothing wrote to them before 0029 and nothing will after this.

drop policy "admins update any time entry" on ops.time_entries;

drop policy "admins insert adjustment punches" on ops.time_punches;

drop policy "insert own punches" on ops.time_punches;
create policy "insert own punches" on ops.time_punches
  for insert
  to authenticated
  with check (staff_id = auth.uid());

alter table ops.time_punches
  drop constraint time_punches_adjustment_complete;

alter table ops.time_punches
  drop column source,
  drop column adjustment_reason,
  drop column adjusted_by;

alter table ops.time_entries
  add column break_minutes integer not null default 0,
  add column overtime_minutes integer not null default 0;

alter table shared.app_settings
  drop column overtime_threshold_minutes;
