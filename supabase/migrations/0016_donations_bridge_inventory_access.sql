-- Activates the Donations Bridge contract documented in ops.donations' own
-- migration comment since Phase 3 ("laf-inventory inserts as
-- 'pending_review', lafopsys/finance reviews and finalizes") -- never
-- activated until now because laf-inventory had no insert side, and because
-- migration 0015 (correctly) role-gated every ops.* table to lafopsys-only
-- roles, which also locked out the bridge this table was always meant to
-- allow.
--
-- Additive, not a rollback of 0015: adds a second, narrower policy per
-- table for the laf-inventory-specific roles, scoped to exactly the access
-- the bridge contract needs and no more.
--   ops.donations -- insert only. Inventory roles log a donation; they
--     never read, revise, or delete the ledger.
--   ops.donors -- select + insert. Needed to find an existing real donor
--     or register a new one at the moment of logging an in-kind donation.
--     No update/delete -- an existing donor's real details stay lafopsys's
--     to edit.

create policy "inventory roles insert donations" on ops.donations
  for insert
  to authenticated
  with check (shared.current_staff_role() in ('chef', 'inventory_staff', 'nutritionist', 'inventory_lead'));

create policy "inventory roles read and add donors" on ops.donors
  for select
  to authenticated
  using (shared.current_staff_role() in ('chef', 'inventory_staff', 'nutritionist', 'inventory_lead'));

create policy "inventory roles insert donors" on ops.donors
  for insert
  to authenticated
  with check (shared.current_staff_role() in ('chef', 'inventory_staff', 'nutritionist', 'inventory_lead'));
