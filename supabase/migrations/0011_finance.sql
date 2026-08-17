-- Phase 4 (human-reconciliation boundary): cash ledger, accounts, budget
-- lines, programs. Real historical data exists for cash_entries (816 rows,
-- 424 flagged needs_review) -- see lib/mock-data/finance.ts's own provenance
-- comment. accounts and budget_lines are BOTH 100% rng-fabricated in the
-- mock layer (confirmed by reading the generator: 3 hardcoded demo account
-- balances, budget amounts drawn from rng.int/rng.random) -- presenting
-- fabricated bank balances as real would be actively misleading, not just
-- incomplete, so neither is migrated. Both start empty; staff enter real
-- account/budget data going forward. programs is a small, genuinely real
-- organizational taxonomy (6 real program areas), not spreadsheet-derived
-- but not fabricated either -- migrated the same way provinces/diagnoses
-- were in Phase 0.
--
-- Boundary, stated plainly: migrating cash_entries does not resolve the 424
-- needs_review rows. Those need an actual bookkeeper's judgment call
-- (duplicate donation logs, ambiguous bank-statement rows) -- no script
-- should pretend to make that call. needs_review/review_reason/
-- duplicate_of_id are preserved as-is so the review queue is real, not
-- fabricated as "resolved."

create table ops.programs (
  id text primary key,
  name text not null,
  description text
);

create table ops.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  entity text not null check (entity in ('US_501C3', 'PH_SEC')),
  currency text not null check (currency in ('USD', 'PHP')),
  balance numeric(14, 2),
  type text not null check (type in ('bank', 'cash_on_hand')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ops.budget_lines (
  id uuid primary key default gen_random_uuid(),
  program_id text not null references ops.programs (id),
  month text not null,
  budgeted numeric(12, 2) not null default 0,
  actual numeric(12, 2) not null default 0,
  unique (program_id, month)
);

create table ops.cash_entries (
  id uuid primary key default gen_random_uuid(),
  source_id text unique, -- original cash-real-N id, the stable migration key
  date date not null,
  direction text not null check (direction in ('inflow', 'outflow')),
  source text not null,
  entity text not null check (entity in ('US_501C3', 'PH_SEC')),
  currency text not null check (currency in ('USD', 'PHP')),
  amount numeric(12, 2) not null,
  program_id text references ops.programs (id),
  description text not null,
  approval_status text not null check (approval_status in ('pending', 'approved', 'rejected')) default 'pending',
  donor_name text,
  source_sheet text,
  needs_review boolean not null default false,
  review_reason text,
  duplicate_of_id uuid references ops.cash_entries (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table ops.programs enable row level security;
alter table ops.accounts enable row level security;
alter table ops.budget_lines enable row level security;
alter table ops.cash_entries enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['programs', 'accounts', 'budget_lines', 'cash_entries']
  loop
    execute format(
      'create policy "authenticated staff full access" on ops.%I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

create trigger set_updated_at before update on ops.accounts for each row execute function shared.set_updated_at();
create trigger set_updated_at before update on ops.cash_entries for each row execute function shared.set_updated_at();

create index on ops.cash_entries (date);
create index on ops.cash_entries (needs_review);
create index on ops.budget_lines (program_id);
