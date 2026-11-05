-- 0130: Driver and House Staff get only what their work needs (decided 6 Nov 2026).
--
-- Trips: writing went through House Operations OR Transport, so anyone who edits one House Operations page could
-- change trips. Trips and their passengers are now Transport's alone. Reading is unchanged.
-- Clinical detail comes off the roles that don't work with it: Driver, House Staff, Volunteer, Inventory Staff and
-- Inventory Lead. Chef and Nutritionist keep it for the doctor's food instructions.
-- A page with no access has no row; the trigger sync_module_from_pages brings shared.module_access down by itself.

-- ---- 1. trips belong to Transport ----
drop policy if exists "module insert" on ops.trips;
drop policy if exists "module update" on ops.trips;
drop policy if exists "module delete" on ops.trips;
create policy "module insert" on ops.trips for insert to authenticated with check ((select shared.module_editable('transport')));
create policy "module update" on ops.trips for update to authenticated using ((select shared.module_editable('transport'))) with check ((select shared.module_editable('transport')));
create policy "module delete" on ops.trips for delete to authenticated using ((select shared.module_editable('transport')));

drop policy if exists "module insert" on ops.trip_passengers;
drop policy if exists "module update" on ops.trip_passengers;
drop policy if exists "module delete" on ops.trip_passengers;
create policy "module insert" on ops.trip_passengers for insert to authenticated with check ((select shared.module_editable('transport')));
create policy "module update" on ops.trip_passengers for update to authenticated using ((select shared.module_editable('transport'))) with check ((select shared.module_editable('transport')));
create policy "module delete" on ops.trip_passengers for delete to authenticated using ((select shared.module_editable('transport')));

-- ---- 2. Driver: trips and fuel to edit; the rest of the house to look at ----
update shared.role_page_access set level = 'view' where role = 'driver' and page in ('transport.report', 'house_ops.overview');
delete from shared.role_page_access
 where role = 'driver' and page in (
   'house_ops.activity_center', 'house_ops.care_cart', 'house_ops.meals', 'house_ops.menu', 'house_ops.stocks',
   'analytics.dashboard', 'reports.catalogue', 'reports.generate', 'reports.programs', 'staff.volunteers');

-- ---- 3. House Staff: the Activity Center to edit; the rest of the house to look at ----
update shared.role_page_access set level = 'view'
 where role = 'house_staff' and page in ('house_ops.care_cart', 'house_ops.meals', 'house_ops.menu', 'house_ops.overview', 'house_ops.stocks');
delete from shared.role_page_access
 where role = 'house_staff' and page in (
   'transport.trips', 'transport.fuel', 'transport.report',
   'analytics.dashboard', 'reports.catalogue', 'reports.generate', 'reports.programs', 'staff.volunteers');

-- ---- 4. clinical detail ----
delete from shared.role_powers
 where power = 'clinical_detail' and role in ('driver', 'house_staff', 'volunteer', 'inventory_staff', 'inventory_lead');

-- ---- 5. the place name a bad pattern blanked every lower-case s out of (Settings saved it with /s+/, meant \s+) ----
update shared.app_settings
   set transport_places = (
     select coalesce(jsonb_agg(case when x->>'name' like 'National Children%Ho pital'
                                    then jsonb_set(x, '{name}', to_jsonb('National Children''s Hospital'::text)) else x end), '[]'::jsonb)
       from jsonb_array_elements(transport_places) x)
 where transport_places::text like '%Ho pital%';

notify pgrst, 'reload schema';
