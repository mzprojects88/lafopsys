-- Phase 3 (lafopsys-side boundary): donors, donations, and the Donations
-- Bridge contract's receiving table. Real historical data exists for donors
-- (242) and donations (785, all real in-kind, no cash donations in the
-- source) -- see lib/mock-data/donors.ts's own provenance comment. campaigns,
-- acknowledgment_receipts, and donee_certificates are ALL rng-fabricated in
-- the mock layer (confirmed by reading the generator: campaigns is a fixed
-- demo array, AR/cert statuses are randomly assigned on top of real
-- donations) -- none of that is migrated as real. All three start empty;
-- staff create real ones going forward.
--
-- Bridge boundary, stated plainly: this migration creates ops.donations with
-- the shape the Inventory Build Plan's contract describes (laf-inventory
-- inserts as status='pending_review', finance reviews/finalizes), but
-- laf-inventory's own repo has not built the insert side yet (confirmed:
-- its Phase 0 is only partially done, no inventory.* tables exist per
-- wiring-up-progress.md Part 2). This migration cannot activate the bridge
-- end-to-end by itself -- it only makes the lafopsys side ready to receive.
-- created_inventory_lot_id is deliberately a plain nullable column, not an
-- FK -- inventory.* is laf-inventory's schema to own, not lafopsys's to
-- constrain into.

create table ops.donors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('individual', 'corporate', 'foundation', 'government', 'anonymous')),
  email text,
  phone text,
  tax_jurisdiction text not null check (tax_jurisdiction in ('US', 'PH')),
  tin text,
  first_gift_date date,
  last_gift_date date,
  lifetime_value numeric(12, 2) not null default 0,
  gift_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ops.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_amount numeric(12, 2) not null default 0,
  raised_amount numeric(12, 2) not null default 0,
  start_date date not null,
  end_date date,
  created_at timestamptz not null default now()
);

create table ops.donations (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references ops.donors (id) on delete cascade,
  date date not null,
  receiving_entity text not null check (receiving_entity in ('US_501C3', 'PH_SEC')),
  kind text not null check (kind in ('cash', 'in_kind')),
  item_description text,
  item_type text,
  quantity numeric(12, 2),
  uom_id text,
  unit_value numeric(12, 2),
  total_value numeric(12, 2) not null,
  currency text not null check (currency in ('USD', 'PHP')),
  campaign_id uuid references ops.campaigns (id),
  -- Bridge field -- set once laf-inventory's own Intake flow (Inventory Build
  -- Plan Phase 1) actually inserts a lot and links back. No FK: inventory.*
  -- belongs to laf-inventory.
  created_inventory_lot_id text,
  -- Donations Bridge contract: laf-inventory inserts as 'pending_review',
  -- lafopsys/finance reviews and finalizes. Real historical rows migrated
  -- here are already-known, so they're seeded 'finalized', not pending.
  status text not null check (status in ('pending_review', 'reviewed', 'finalized')) default 'finalized',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ops.acknowledgment_receipts (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references ops.donations (id) on delete cascade,
  sequence_number text not null unique,
  entity text not null check (entity in ('US_501C3', 'PH_SEC')),
  status text not null check (status in ('draft', 'issued', 'sent', 'acknowledged')) default 'draft',
  issued_at timestamptz,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create table ops.donee_certificates (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references ops.donations (id) on delete cascade,
  control_number text not null unique,
  status text not null check (status in ('requested', 'prepared', 'approved', 'released', 'filed')) default 'requested',
  requested_at timestamptz not null default now(),
  released_at timestamptz,
  created_at timestamptz not null default now()
);

alter table ops.donors enable row level security;
alter table ops.campaigns enable row level security;
alter table ops.donations enable row level security;
alter table ops.acknowledgment_receipts enable row level security;
alter table ops.donee_certificates enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'donors', 'campaigns', 'donations', 'acknowledgment_receipts', 'donee_certificates'
  ]
  loop
    execute format(
      'create policy "authenticated staff full access" on ops.%I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

create trigger set_updated_at before update on ops.donors for each row execute function shared.set_updated_at();
create trigger set_updated_at before update on ops.donations for each row execute function shared.set_updated_at();

create index on ops.donations (donor_id);
create index on ops.donations (date);
create index on ops.acknowledgment_receipts (donation_id);
create index on ops.donee_certificates (donation_id);
