-- Lets the 4 laf-inventory-only roles (chef, inventory_staff, nutritionist,
-- inventory_lead) read and write their own ops.time_entries row once
-- lafopsys's login/nav is opened to them. Migration 0015 role-gated every
-- ops.* table to lafopsys-only roles; this is an additive carve-out in the
-- same spirit as 0016's donations bridge -- scoped to exactly one's own row
-- (staff_id = auth.uid()), never the roster.
--
-- ops.time_punches needs no equivalent policy: its 0017 policies are already
-- ownership-based (staff_id = auth.uid()), not role-gated, so inventory
-- roles already pass them once they can authenticate at all.

create policy "inventory roles read own time entry" on ops.time_entries
  for select
  to authenticated
  using (staff_id = auth.uid() and shared.current_staff_role() in ('chef', 'inventory_staff', 'nutritionist', 'inventory_lead'));

create policy "inventory roles insert own time entry" on ops.time_entries
  for insert
  to authenticated
  with check (staff_id = auth.uid() and shared.current_staff_role() in ('chef', 'inventory_staff', 'nutritionist', 'inventory_lead'));

create policy "inventory roles update own time entry" on ops.time_entries
  for update
  to authenticated
  using (staff_id = auth.uid() and shared.current_staff_role() in ('chef', 'inventory_staff', 'nutritionist', 'inventory_lead'))
  with check (staff_id = auth.uid() and shared.current_staff_role() in ('chef', 'inventory_staff', 'nutritionist', 'inventory_lead'));
