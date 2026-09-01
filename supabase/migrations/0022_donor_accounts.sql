-- VIP Donors Portal, part 2: donor login identity. Mirrors shared.staff's
-- "one row per real auth.users login" shape, but kept structurally separate
-- -- a donor is not a staff role, never appears in shared.staff.role, and
-- never gets nav/RBAC entries in lib/rbac/roles.ts. Staff use a synthesized
-- internal email as their Auth username (never real mail); donors use their
-- own real email so they can actually be communicated with.

create table shared.donor_accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  donor_id uuid not null unique references ops.donors (id) on delete cascade,
  email text not null,
  must_change_password boolean not null default true,
  status text not null check (status in ('active', 'suspended')) default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- security definer, mirroring shared.current_staff_role() -- lets RLS
-- policies resolve "which donor is this caller" without recursing into this
-- table's own RLS. Returns null for a staff session (no row here), and
-- current_staff_role() returns null for a donor session (no shared.staff
-- row) -- the two identities never collide.
create or replace function shared.current_donor_id()
returns uuid
language sql
security definer
set search_path = shared, pg_temp
stable
as $$
  select donor_id from shared.donor_accounts where id = auth.uid();
$$;

alter table shared.donor_accounts enable row level security;

-- Provisioning is staff-only (admin/finance, matching the existing /donors
-- nav gate in lib/rbac/roles.ts).
create policy "lafopsys staff manage donor accounts" on shared.donor_accounts
  for all
  to authenticated
  using (shared.current_staff_role() in ('admin', 'finance'))
  with check (shared.current_staff_role() in ('admin', 'finance'));

-- Donor may read (never write) their own account row -- needed client-side
-- to check must_change_password after login. Deliberately NO donor UPDATE
-- policy: RLS can restrict which ROWS an UPDATE touches but not which
-- COLUMNS, so a same-shape "update own row" policy (as shared.staff already
-- has for must_change_pin) would let a donor also overwrite their own
-- donor_id and hijack current_donor_id() into reading someone else's data.
-- must_change_password is cleared server-side only, via a Server Action
-- using the service-role client (see app/(donor-portal)/portal/actions.ts).
create policy "donor can read own account" on shared.donor_accounts
  for select
  to authenticated
  using (id = auth.uid());

create trigger set_updated_at before update on shared.donor_accounts for each row execute function shared.set_updated_at();
