-- Phase 0: schema foundation + real staff auth.
--
-- Three-schema ownership model per LAF_Inventory_Build_Plan.md §2-3:
--   ops.*      owned by lafopsys (this repo) -- patients, stays, referrals, donations, finance, etc.
--   inventory.* owned by laf-inventory (a separate repo/deploy) -- items, lots, transactions, etc.
--   shared.*   both apps depend on -- staff, roles, donors, audit_log, uom, categories.
--
-- This migration creates all three schema namespaces (someone has to run the
-- first migration on a fresh project) but only defines tables inside
-- shared.* and ops.* -- inventory.* is left empty for laf-inventory's own
-- migrations to own, per the "each app migrates only its own schema" rule.

create schema if not exists ops;
create schema if not exists inventory;
create schema if not exists shared;

-- shared.staff -- one row per real login. id = auth.users.id so RLS can key off auth.uid().
-- Auth model (per project decision): Super Admin creates accounts with a temporary PIN;
-- PIN is stored as the Supabase Auth password (auth.users), not duplicated here. Staff
-- have no real email in the source data, so login uses a synthesized internal address
-- ({staffId}@staff.lafopsys.internal) purely as the Auth username -- never used to send mail.
create table shared.staff (
  id uuid primary key references auth.users (id) on delete cascade,
  staff_code text not null unique, -- stable human-facing id used to build the synthesized login email
  first_name text not null,
  last_name text not null,
  role text not null check (role in ('admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer')),
  position text not null,
  photo_url text,
  active boolean not null default true,
  hire_date date not null default current_date,
  must_change_pin boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- security definer function so RLS policies can check "is the caller an admin"
-- without recursively re-triggering RLS on shared.staff itself.
create or replace function shared.current_staff_role()
returns text
language sql
security definer
set search_path = shared, pg_temp
stable
as $$
  select role from shared.staff where id = auth.uid();
$$;

alter table shared.staff enable row level security;

-- Every authenticated staff member can see the roster (name/role/position) --
-- matches current app behavior (roster, approvals, volunteer lists are visible
-- app-wide today). No anonymous access.
create policy "staff can read all staff" on shared.staff
  for select
  to authenticated
  using (true);

-- Only admins can create/edit/deactivate other staff accounts.
create policy "admins manage staff" on shared.staff
  for all
  to authenticated
  using (shared.current_staff_role() = 'admin')
  with check (shared.current_staff_role() = 'admin');

-- A staff member may always update their own row (used for the forced
-- PIN-change-on-first-login flow, and future profile-settings edits) even
-- if they aren't an admin.
create policy "staff can update own row" on shared.staff
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Plain trigger function (no extension dependency) reused by every table
-- across ops.*/shared.* that has an updated_at column.
create or replace function shared.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at
  before update on shared.staff
  for each row execute function shared.set_updated_at();
