-- 0079: Fuel Monitoring, phase D -- the dashboard's settings and the driver's gauge (2026-10-03).
--
--   * ops.vehicle_service_rules: per vehicle and expense type (Change oil,
--     Tires, Maintenance / service ...), every so many km and/or months. The
--     Super Admin sets them in Settings > Vehicles; Fuel Monitoring and the
--     bell say when one is due, from the last time that expense was logged.
--     Nothing is seeded: LAF's own intervals, not a guess.
--   * ops.vehicles.efficiency_alert_pct: how far km per litre may fall below
--     the vehicle's recent average before Fuel Monitoring flags it (20% to
--     start; the Super Admin changes it).
--   * ops.fuel_level_checks: the driver's reading of the fuel gauge (E, 1/4,
--     1/2, 3/4, F) with the odometer; the estimated level starts from the
--     latest of this and the last full fill. Stamped with who read it; never
--     changed or deleted.
-- Rollback: supabase/rollbacks/0079_down.sql.

alter table ops.vehicles
  add column efficiency_alert_pct integer not null default 20 check (efficiency_alert_pct between 5 and 90);

create table ops.vehicle_service_rules (
  vehicle_id uuid not null references ops.vehicles (id),
  kind text not null references ops.vehicle_expense_kinds (id),
  every_km integer check (every_km > 0),
  every_months integer check (every_months between 1 and 60),
  updated_at timestamptz not null default now(),
  primary key (vehicle_id, kind),
  constraint vehicle_service_rules_some check (every_km is not null or every_months is not null),
  constraint vehicle_service_rules_not_fuel check (kind <> 'fuel')
);
create trigger set_updated_at before update on ops.vehicle_service_rules
  for each row execute function shared.set_updated_at();
alter table ops.vehicle_service_rules enable row level security;
create policy "module read" on ops.vehicle_service_rules for select to authenticated
  using ((select shared.module_viewable('transport', 'house_ops', 'finance')));
create policy "super admin sets" on ops.vehicle_service_rules for all to authenticated
  using ((select shared.has_role('admin'))) with check ((select shared.has_role('admin')));
revoke all on ops.vehicle_service_rules from anon, authenticated;
grant select, insert, update, delete on ops.vehicle_service_rules to authenticated;
alter publication supabase_realtime add table ops.vehicle_service_rules;

create table ops.fuel_level_checks (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references ops.vehicles (id),
  level numeric(3, 2) not null check (level in (0, 0.25, 0.5, 0.75, 1)),
  odometer integer check (odometer >= 0),
  checked_by uuid references shared.staff (id),
  checked_at timestamptz not null default now()
);
create index fuel_level_checks_vehicle_idx on ops.fuel_level_checks (vehicle_id, checked_at desc);

create or replace function ops.stamp_fuel_level_check()
returns trigger
language plpgsql
as $$
begin
  new.checked_by := coalesce(auth.uid(), new.checked_by);
  new.checked_at := now();
  return new;
end;
$$;
create trigger stamp_fuel_level_check before insert on ops.fuel_level_checks
  for each row execute function ops.stamp_fuel_level_check();

alter table ops.fuel_level_checks enable row level security;
create policy "module read" on ops.fuel_level_checks for select to authenticated
  using ((select shared.module_viewable('transport', 'house_ops', 'finance')));
create policy "transport editors read the gauge" on ops.fuel_level_checks for insert to authenticated
  with check ((select shared.module_editable('transport')));
revoke all on ops.fuel_level_checks from anon, authenticated;
grant select, insert on ops.fuel_level_checks to authenticated;
alter publication supabase_realtime add table ops.fuel_level_checks;

notify pgrst, 'reload schema';
