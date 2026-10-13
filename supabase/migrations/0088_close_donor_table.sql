-- 0088: the donor table is closed to inventory roles (second half of 0087).
--
-- Apply only after LAF Inventory's release that names donors through ops.donor_directory /
-- ops.add_donor_basic (Inventory 0062 + its sprint_7 code) is live on production: from then on
-- chef, inventory_staff, nutritionist and inventory_lead can't read email, phone, TIN or address,
-- nor insert donors directly. Donors editors (admin, finance, office_admin) are unchanged.

drop policy if exists "inventory roles read and add donors" on ops.donors;
drop policy if exists "inventory roles insert donors" on ops.donors;

notify pgrst, 'reload schema';
