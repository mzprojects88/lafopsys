-- The bank's own record of the foundation's money, and a place for the
-- monthly narrative that goes with it. Together they are the CEO's
-- "Income and Expenses Tracking" sheet, built from what actually cleared.
--
-- WHY A SECOND LEDGER. ops.cash_entries already holds 298 rows imported from
-- the Bank Statement tab -- and 518 more imported from the CASH, BDO and
-- reimbursement tabs, which re-record the SAME money from the donor's side
-- (Manny Chan's ₱30,000 is there twice, on the 2nd and the 3rd of July).
-- Adding them up triples the year's income. The summary sheet only ever
-- summed the bank tab: its monthly Expenses equal the bank's debits to the
-- peso. So the rule from here on is stated once, here:
--
--   ops.bank_transactions = cleared money, as the bank saw it.
--                           -> monthly totals, cash in bank.
--   ops.cash_entries       = receipts and attribution: who gave, what for.
--                           -> the donor breakdown. Never summed with the above.
--
-- matched_cash_entry_id is the hook for reconciling the two later. A
-- QuickBooks sync, when it exists, inserts into bank_transactions with
-- source = 'quickbooks' on its import batch and the QBO id in external_ref;
-- the summary code does not know or care which feed a row came from.
--
-- The source tab also carries two columns the earlier import discarded: the
-- running balance on every line (that IS "cash in bank") and a hand-written
-- memo per line ("RIZA SALARY", "BUTCH") that explains the bank's opaque
-- descriptions. Both are kept here.
--
-- Append-only. There is no DELETE policy for anyone. A statement that was
-- imported wrongly is corrected by importing the right one -- the natural
-- key skips what is already there -- never by deleting rows from the
-- record of what the bank did.

-- ---------------------------------------------------------------------
-- 1. The account. ops.accounts has existed since 0011 and been empty by
--    design (its mock balances were fabricated). One real row now, with a
--    fixed id so the backfill script needs no lookup.
-- ---------------------------------------------------------------------

insert into ops.accounts (id, name, entity, currency, balance, type)
values ('00000000-0000-4000-8000-00000000bd01', 'BDO Peso Current Account', 'PH_SEC', 'PHP', null, 'bank')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Statement imports: one row per upload, so the history says when each
--    month arrived, who brought it, and what it claimed to cover.
-- ---------------------------------------------------------------------

create table ops.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references ops.accounts (id),
  file_name text not null,
  source text not null default 'csv_upload'
    check (source in ('csv_upload', 'workbook_backfill', 'quickbooks')),
  covers_from date not null,
  covers_to date not null,
  opening_balance numeric(14,2),
  closing_balance numeric(14,2),
  row_count integer not null,
  inserted_count integer not null,
  skipped_count integer not null,
  continuity_warnings integer not null default 0,
  imported_by uuid references shared.staff (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. The transactions themselves.
-- ---------------------------------------------------------------------

create table ops.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references ops.accounts (id),
  import_id uuid not null references ops.bank_statement_imports (id),
  -- Position in the statement. The bank posts several lines a day and this
  -- is the only ordering it gives; the running balance depends on it.
  row_seq integer not null,
  posting_date date not null,
  branch text,
  description text not null,
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  running_balance numeric(14,2) not null,
  check_number text,
  memo text,
  -- Set by keyword at import, editable by finance. 'interest' is what keeps
  -- the bank's own credits out of "Donation".
  category text check (category is null or category in ('interest', 'transfer', 'fee')),
  needs_review boolean not null default false,
  review_reason text,
  matched_cash_entry_id uuid references ops.cash_entries (id),
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Idempotency. The running balance is part of the key on purpose: on
  -- 6 April the bank posted two identical reversal pairs, distinguishable
  -- only by the balance each left behind.
  constraint bank_transactions_natural_key
    unique (account_id, posting_date, description, debit, credit, running_balance)
);

create index bank_transactions_account_date_idx on ops.bank_transactions (account_id, posting_date, row_seq);
create index bank_transactions_import_idx on ops.bank_transactions (import_id);

-- ---------------------------------------------------------------------
-- 4. Key Monthly Drivers: the paragraph a person writes about each month.
-- ---------------------------------------------------------------------

create table ops.finance_month_notes (
  month text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  drivers text not null default '',
  updated_by uuid references shared.staff (id),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. Access. Money tables follow the Financial nav: admin, finance and board
--    read; admin and finance write; nobody deletes. The notes are readable
--    by any staff member (decided with the foundation) and written by
--    admin and finance.
-- ---------------------------------------------------------------------

alter table ops.bank_statement_imports enable row level security;
alter table ops.bank_transactions enable row level security;
alter table ops.finance_month_notes enable row level security;

create policy "finance readers" on ops.bank_statement_imports
  for select to authenticated
  using (shared.current_staff_role() in ('admin', 'finance', 'board'));
create policy "finance writers" on ops.bank_statement_imports
  for insert to authenticated
  with check (shared.current_staff_role() in ('admin', 'finance'));

create policy "finance readers" on ops.bank_transactions
  for select to authenticated
  using (shared.current_staff_role() in ('admin', 'finance', 'board'));
create policy "finance writers" on ops.bank_transactions
  for insert to authenticated
  with check (shared.current_staff_role() in ('admin', 'finance'));
create policy "finance edit" on ops.bank_transactions
  for update to authenticated
  using (shared.current_staff_role() in ('admin', 'finance'))
  with check (shared.current_staff_role() in ('admin', 'finance'));

create policy "staff read month notes" on ops.finance_month_notes
  for select to authenticated
  using (shared.current_staff_role() is not null);
create policy "finance write month notes" on ops.finance_month_notes
  for all to authenticated
  using (shared.current_staff_role() in ('admin', 'finance'))
  with check (shared.current_staff_role() in ('admin', 'finance'));

-- 0003's default privileges granted DELETE along with everything else.
-- Take it back on the two money tables: the policy above already refuses
-- it, and this makes that refusal not depend on the policy.
revoke delete on ops.bank_statement_imports, ops.bank_transactions from authenticated;

create trigger set_updated_at
  before update on ops.bank_transactions
  for each row execute function shared.set_updated_at();
create trigger set_updated_at
  before update on ops.finance_month_notes
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table ops.bank_statement_imports;
alter publication supabase_realtime add table ops.bank_transactions;
alter publication supabase_realtime add table ops.finance_month_notes;
