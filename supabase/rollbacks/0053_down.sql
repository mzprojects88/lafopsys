-- Undo 0053. record_arrival goes back to 0052's five-argument body: re-run
-- that create-or-replace from 0052 after this.
drop function if exists ops.record_arrival(uuid, text, text, uuid, numeric, uuid);
drop function if exists ops.create_pickup(date, text, uuid, uuid[]);
alter publication supabase_realtime drop table ops.trip_manifest;
drop table if exists ops.trip_manifest;
drop function if exists ops.guard_trip_manifest();
drop trigger if exists stamp_trip_progress on ops.trips;
drop function if exists ops.stamp_trip_progress();
alter table ops.trips drop column if exists arrived_at, drop column if exists departed_at;
do $$
declare
  t text;
begin
  foreach t in array array['trips', 'trip_passengers'] loop
    execute format('drop policy "module read" on ops.%I', t);
    execute format('drop policy "module insert" on ops.%I', t);
    execute format('drop policy "module update" on ops.%I', t);
    execute format('drop policy "module delete" on ops.%I', t);
    execute format($p$create policy "module read" on ops.%I for select to authenticated using ((select shared.module_viewable(variadic '{house_ops}'::text[])))$p$, t);
    execute format($p$create policy "module insert" on ops.%I for insert to authenticated with check ((select shared.module_editable('house_ops')))$p$, t);
    execute format($p$create policy "module update" on ops.%I for update to authenticated using ((select shared.module_editable('house_ops'))) with check ((select shared.module_editable('house_ops')))$p$, t);
    execute format($p$create policy "module delete" on ops.%I for delete to authenticated using ((select shared.module_editable('house_ops')))$p$, t);
  end loop;
end $$;
delete from shared.module_access where module = 'transport';
alter table shared.module_access drop constraint module_access_module_check;
alter table shared.module_access add constraint module_access_module_check check (module in (
  'executive', 'dashboard', 'calendar', 'staff', 'hr', 'patients', 'house_ops', 'donors',
  'inventory', 'finance', 'compliance', 'analytics', 'reports', 'settings'));
notify pgrst, 'reload schema';
