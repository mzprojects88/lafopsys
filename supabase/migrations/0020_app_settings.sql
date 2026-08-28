-- Single-row, org-wide settings table. The `id boolean primary key default
-- true check (id)` shape guarantees exactly one row can ever exist -- a
-- common Postgres idiom for "there is only one of these".
--
-- Starts with one flag: whether clock-in is mandatory for the 4
-- laf-inventory-only roles once lafopsys's login/nav is opened to them.
-- Defaults to false -- those roles currently only need lafopsys to exist,
-- not to clock in -- and is meant to be flipped on later by an admin via a
-- Settings toggle, not by another migration.

create table shared.app_settings (
  id boolean primary key default true check (id),
  require_clock_in_for_inventory_roles boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

insert into shared.app_settings (id) values (true);

alter table shared.app_settings enable row level security;

create policy "staff can read app settings" on shared.app_settings
  for select
  to authenticated
  using (true);

create policy "admins manage app settings" on shared.app_settings
  for update
  to authenticated
  using (shared.current_staff_role() = 'admin')
  with check (shared.current_staff_role() = 'admin');
