-- VIP Donors Portal, part 1: recurring giving commitments. Staff-recorded,
-- not inferred from donation cadence -- a donor becomes VIP-eligible once
-- they have 3+ past gifts (ops.donors.gift_count) AND an active row here.
-- This table is staff-only for now; the donor-facing read-only policy is
-- added in 0023 once shared.current_donor_id() exists.

create table ops.donor_pledges (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references ops.donors (id) on delete cascade,
  kind text not null check (kind in ('cash', 'in_kind')),
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'annual')),
  amount numeric(12, 2),
  currency text check (currency in ('USD', 'PHP')),
  item_description text,
  status text not null check (status in ('active', 'paused', 'cancelled')) default 'active',
  started_at date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint donor_pledges_amount_or_item check (
    (kind = 'cash' and amount is not null) or (kind = 'in_kind' and item_description is not null)
  )
);

alter table ops.donor_pledges enable row level security;

-- Same role list and shape as every other ops.* table post-0015 ("lafopsys
-- staff full access") -- 0015 only backfilled tables that existed at the
-- time, so a new table gets no staff policy for free and has to state this
-- explicitly.
create policy "lafopsys staff full access" on ops.donor_pledges
  for all
  to authenticated
  using (shared.current_staff_role() in ('admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer'))
  with check (shared.current_staff_role() in ('admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer'));

create trigger set_updated_at before update on ops.donor_pledges for each row execute function shared.set_updated_at();

create index on ops.donor_pledges (donor_id);
