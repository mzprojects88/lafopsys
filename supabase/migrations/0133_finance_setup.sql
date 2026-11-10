-- 0133 Voucher System, phase 1: Financial Settings and the chart of accounts (decided 10 Nov 2026).
--
-- Every payment line will carry an account (the chart), a cost center and program (QuickBooks Class: T1 and
-- T3), a donor fund (QuickBooks Project: T2) and, for staff costs, the employee code (T4 = hr.employees).
-- This migration holds the lists and the policy figures the vouchers need, all set on Finance > Financial
-- Settings by whoever holds the new "Sets up Finance" power (the Super Admin always does):
--   1. the chart, imported from the LAF COA QB Standard COA workbook (LAF COA tab, 18 Aug) as it stands;
--   2. the T codes (LAF Cost Center tab, 10 Nov) with the codes the app proposes;
--   3. the expense types a requester picks from, each pointing at an account per use;
--   4. the general settings, the approval authority, the cash funds, payees and withholding rates;
--   5. a change log of all of the above, and the setup checklist that must be complete before the first
--      payment request (decided 10 Nov).
-- Imported rows the Super Admin must settle carry a review note (the user's decision: the workbook's
-- placeholders and inconsistencies are resolved in the app). Seeded rows have fixed ids so the development
-- and production copies hold the same rows for the hourly sync.

-- 1. The chart. A code is unique only once its note is settled, so the workbook's two 5204s wait side by side.
create table if not exists ops.coa_accounts (
  id uuid primary key default gen_random_uuid(),
  code text check (code ~ '^\d{4}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  account_type text check (length(account_type) <= 60),
  detail_type text check (length(detail_type) <= 60),
  description text check (length(description) <= 500),
  parent_id uuid references ops.coa_accounts(id) on delete restrict deferrable initially immediate,
  is_header boolean not null default false,
  old_qb_name text check (length(old_qb_name) <= 200),
  sort integer not null default 0,
  active boolean not null default true,
  review_note text check (length(review_note) <= 1000),
  updated_at timestamptz not null default now(),
  check (code is not null or review_note is not null),
  check (parent_id is distinct from id)
);
create unique index if not exists coa_accounts_code on ops.coa_accounts (code) where review_note is null;
comment on column ops.coa_accounts.review_note is 'Something the Super Admin must settle (0133): set by the workbook import, cleared when settled. Requests stay closed while any is open.';
comment on column ops.coa_accounts.old_qb_name is 'The account''s name in LAF''s old QuickBooks file (workbook column K).';

-- 2. The T codes: T1 cost centers (QuickBooks Classes), T2 donor funds (Projects), T3 programs (sub-classes,
-- under a T1). account_prefixes: for a T3, the account groups that belong to the program (52 = 5200s); for a
-- restricted T2, the accounts it may pay for (empty = any).
create table if not exists ops.fin_codes (
  id uuid primary key default gen_random_uuid(),
  tier text not null check (tier in ('T1', 'T2', 'T3')),
  code text not null check (code ~ '^[A-Z0-9]{2,8}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  parent_id uuid references ops.fin_codes(id) on delete restrict deferrable initially immediate,
  restricted boolean not null default false,
  account_prefixes text[] not null default '{}' check (array_to_string(account_prefixes, ',') ~ '^(\d{1,4}(,\d{1,4})*)?$'),
  sort integer not null default 0,
  active boolean not null default true,
  review_note text check (length(review_note) <= 1000),
  updated_at timestamptz not null default now(),
  unique (tier, code),
  check (restricted = false or tier = 'T2')
);

alter table ops.programs add column if not exists t3_id uuid references ops.fin_codes(id) on delete set null deferrable initially immediate;
comment on column ops.programs.t3_id is 'The voucher program (T3) this ArkOS program''s spending counts under (0133).';

-- 3. What a requester picks ("Gasoline", "Cooking gas"), and the account it means for each use (the T3
-- program it serves, or the T1 Admin cost center).
create table if not exists ops.expense_types (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(btrim(label)) between 1 and 80),
  use_id uuid not null references ops.fin_codes(id) on delete cascade deferrable initially immediate,
  account_id uuid not null references ops.coa_accounts(id) on delete cascade deferrable initially immediate,
  sort integer not null default 0,
  active boolean not null default true,
  review_note text check (length(review_note) <= 1000),
  updated_at timestamptz not null default now(),
  unique (label, use_id)
);

-- 4a. The general settings: one row.
create table if not exists ops.finance_settings (
  id boolean primary key default true check (id),
  start_date date,
  liquidation_days smallint check (liquidation_days between 1 and 90),
  history_to_cash_book boolean not null default false,
  updated_at timestamptz not null default now()
);
comment on column ops.finance_settings.start_date is 'The first day of payment requests in ArkOS; older vouchers come from the registers (0133).';
comment on column ops.finance_settings.history_to_cash_book is 'Whether imported (history) vouchers post to the cash book. Off until the accountant decides (10 Nov 2026).';
insert into ops.finance_settings (id) values (true) on conflict do nothing;

-- 4b. Who signs each step, for which amounts. An endorse row names the requester's main role; an endorse row
-- with nobody means that role's requests need no endorsement. Amounts: from min_amount to under max_amount
-- (no max = no limit). The urgent approver signs urgent requests between the weekly approvals.
create table if not exists ops.voucher_authority (
  id uuid primary key default gen_random_uuid(),
  step text not null check (step in ('endorse', 'validate', 'review', 'approve', 'approve_payment', 'release')),
  requester_role text references shared.roles(key) on delete cascade deferrable initially immediate,
  min_amount numeric(12, 2) not null default 0 check (min_amount >= 0),
  max_amount numeric(12, 2) check (max_amount is null or max_amount > min_amount),
  staff_id uuid references shared.staff(id) on delete cascade deferrable initially immediate,
  alternate_staff_id uuid references shared.staff(id) on delete set null deferrable initially immediate,
  urgent boolean not null default false,
  updated_at timestamptz not null default now(),
  check ((step = 'endorse') = (requester_role is not null)),
  check (staff_id is not null or step = 'endorse'),
  check (urgent = false or step = 'approve'),
  check (alternate_staff_id is null or alternate_staff_id <> staff_id)
);

-- 4c. Petty cash and the GCash fund, each a fixed float (imprest).
create table if not exists ops.cash_funds (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('petty_cash', 'gcash')),
  name text not null check (length(btrim(name)) between 1 and 80),
  account_id uuid references ops.coa_accounts(id) on delete restrict deferrable initially immediate,
  float_amount numeric(12, 2) check (float_amount > 0),
  top_up_below numeric(12, 2) check (top_up_below >= 0),
  custodian_staff_id uuid references shared.staff(id) on delete set null deferrable initially immediate,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  check (top_up_below is null or float_amount is null or top_up_below < float_amount)
);

-- 4d. Withholding (EWT) rates as the accountant gives them, and the suppliers paid (staff are paid as
-- themselves). The TIN is kept as digits: 9, or 9 plus a 3- or 5-digit branch code.
create table if not exists ops.ewt_rates (
  atc text primary key check (atc ~ '^[A-Z]{2}\d{3}$'),
  description text not null check (length(btrim(description)) between 1 and 200),
  rate numeric(5, 2) not null check (rate > 0 and rate <= 32),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists ops.payees (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  tin text check (tin ~ '^\d{9}(\d{3}|\d{5})?$'),
  address text check (length(address) <= 300),
  ewt_atc text references ops.ewt_rates(atc) on update cascade on delete set null deferrable initially immediate,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- 5. The seed.
insert into ops.coa_accounts (id, code, name, account_type, detail_type, description, parent_id, is_header, old_qb_name, sort, review_note) values
  (md5('coa:6')::uuid, '1100', 'CASH AND CASH EQUIVALENTS', null, null, null, null, true, null, 6, null),
  (md5('coa:7')::uuid, '1101', 'BDO', 'Current Assets', 'Checking / Savings', null, md5('coa:6')::uuid, false, null, 7, null),
  (md5('coa:8')::uuid, '1102', 'LBP', 'Current Assets', 'Checking', null, md5('coa:6')::uuid, false, null, 8, null),
  (md5('coa:9')::uuid, '1103', 'BPI', 'Current Assets', 'Savings', null, md5('coa:6')::uuid, false, null, 9, null),
  (md5('coa:10')::uuid, '1104', 'Petty Cash', 'Current Assets', 'Cash on Hand', null, md5('coa:6')::uuid, false, null, 10, null),
  (md5('coa:12')::uuid, '1120', 'Undeposited Funds / Payments to Deposit', 'Current Assets', 'Undeposited Funds', null, null, false, null, 12, 'The workbook''s Parent Account column says 1200 Current Assets; the list files it under no parent. Confirm the parent.'),
  (md5('coa:14')::uuid, '1200', 'ACCOUNTS RECEIVABLE (A/R)', null, 'Accounts Receivable', null, null, true, null, 14, null),
  (md5('coa:16')::uuid, '1300', 'Other Receivables', null, null, null, null, false, null, 16, null),
  (md5('coa:18')::uuid, '1400', 'Advances', 'Other Current Asset', null, null, null, true, null, 18, null),
  (md5('coa:19')::uuid, '1401', 'Advances to Employees', null, null, 'Business Expenses', md5('coa:18')::uuid, false, 'Business Advances', 19, null),
  (md5('coa:21')::uuid, '1402', 'Advances to Contractors', 'Other Current Asset', null, null, md5('coa:18')::uuid, false, null, 21, null),
  (md5('coa:23')::uuid, '1403', 'Advances on Salary', null, null, null, md5('coa:18')::uuid, false, 'Advances to Employees', 23, null),
  (md5('coa:25')::uuid, '1404', 'Advances to Suppliers', null, null, null, md5('coa:18')::uuid, false, null, 25, null),
  (md5('coa:27')::uuid, '1405', 'Advances to Stockholders', null, null, null, md5('coa:18')::uuid, false, null, 27, null),
  (md5('coa:29')::uuid, '1500', 'PREPAID EXPENSES', 'Other Current Asset', 'Prepaid Expenses', null, null, true, null, 29, null),
  (md5('coa:30')::uuid, '1501', 'Prepaid Supplies', null, null, null, md5('coa:29')::uuid, false, null, 30, null),
  (md5('coa:31')::uuid, '1502', 'Prepaid Insurance', null, null, null, md5('coa:29')::uuid, false, null, 31, null),
  (md5('coa:32')::uuid, '1503', 'Prepaid Subscription / Dues / Memberships', null, null, null, md5('coa:29')::uuid, false, null, 32, null),
  (md5('coa:33')::uuid, '1504', 'Prepaid Licenses and Permits', null, null, null, md5('coa:29')::uuid, false, null, 33, null),
  (md5('coa:34')::uuid, '1505', 'Prepaid Rent', null, null, null, md5('coa:29')::uuid, false, null, 34, null),
  (md5('coa:35')::uuid, '1600', 'Inventory', 'Other Current Asset', 'Inventory', null, null, true, null, 35, null),
  (md5('coa:37')::uuid, '1700', 'Property, Plant & Equipment', 'Fixed Asset', 'Other Fixed Assets', null, null, true, null, 37, null),
  (md5('coa:38')::uuid, '1701', 'Furniture & Fixtures', 'Fixed Asset', 'Furniture & Fixtures', null, md5('coa:37')::uuid, false, null, 38, null),
  (md5('coa:39')::uuid, '1751', 'Accumulated Depreciation - Furniture & Fixture', 'Contra - Fixed Asset', 'Accumulated Depreciation', null, md5('coa:37')::uuid, false, null, 39, null),
  (md5('coa:40')::uuid, '1702', 'Machinery & Tools', 'Fixed Asset', 'Machinery & Equipment', null, md5('coa:37')::uuid, false, 'Office Equipment', 40, null),
  (md5('coa:41')::uuid, '1752', 'Accumulated Depreciation - Machinery & Tools', 'Contra - Fixed Asset', 'Accumulated Depreciation', null, md5('coa:37')::uuid, false, 'Accummulated Depreciation - Housing Facility Equipment', 41, null),
  (md5('coa:42')::uuid, '1703', 'Vehicles', 'Fixed Asset', 'Vehicles', null, md5('coa:37')::uuid, false, 'Transportation Equipment', 42, null),
  (md5('coa:43')::uuid, '1753', 'Accumulated Depreciation - Vehicles', 'Contra - Fixed Asset', 'Accumulated Depreciation', null, md5('coa:37')::uuid, false, 'Accumulated Depreciation- TE', 43, null),
  (md5('coa:44')::uuid, '1704', 'Buildings & Real Estate', 'Fixed Asset', 'Buildings', null, md5('coa:37')::uuid, false, null, 44, null),
  (md5('coa:45')::uuid, '1754', 'Accumulated Depreciation - Building REal Estate', 'Contra - Fixed Asset', 'Accumulated Depreciation', null, md5('coa:37')::uuid, false, null, 45, null),
  (md5('coa:46')::uuid, '1705', 'Capital Renovations and Repairs', 'Fixed Asset', 'Buildings', null, md5('coa:37')::uuid, false, null, 46, null),
  (md5('coa:47')::uuid, '1755', 'Accumulated Depreciation - Capital Renovations and Repairs', 'Contra - Fixed Asset', 'Accumulated Depreciation', null, md5('coa:37')::uuid, false, null, 47, null),
  (md5('coa:49')::uuid, '1800', 'Security Deposit - Rent', null, null, null, null, false, null, 49, null),
  (md5('coa:52')::uuid, null, 'Current Liabilities', 'Other Current Liability', 'Other Current Liabilities', null, null, true, null, 52, 'No code in the workbook (a QuickBooks group heading): give it a code, such as 2000 or 2500, or delete it.'),
  (md5('coa:53')::uuid, '2010', 'Accounts Payable (A/P)', 'Accounts Payable', 'Accounts Payable', null, null, false, null, 53, null),
  (md5('coa:54')::uuid, '2020', 'Business Credit Card', 'Credit Card', 'Credit Card', null, null, false, null, 54, null),
  (md5('coa:57')::uuid, '2030', 'Short-Term Bank Loans / Line of Credit', 'Other Current Liability', 'Line of Credit', null, null, false, null, 57, null),
  (md5('coa:59')::uuid, '2040', 'Accrued Salaries', 'Other Current Liability', 'Payroll Tax Payable', null, null, false, 'Payroll Liabilities', 59, null),
  (md5('coa:60')::uuid, '2050', 'SSS/EC Payable', 'Other Current Liability', null, null, null, false, null, 60, null),
  (md5('coa:61')::uuid, '2060', 'Philhealth Payable', 'Other Current Liability', null, null, null, false, null, 61, null),
  (md5('coa:62')::uuid, '2070', 'HDMF Payable', 'Other Current Liability', null, null, null, false, null, 62, null),
  (md5('coa:63')::uuid, '2080', 'Expanded W/Tax Payable', 'Other Current Liability', null, null, null, false, null, 63, null),
  (md5('coa:64')::uuid, '2090', 'Withholding Tax Payable-Compensation', 'Other Current Liability', null, null, null, false, null, 64, null),
  (md5('coa:65')::uuid, '2100', 'Other Payables', 'Other Current Liability', null, null, null, false, null, 65, null),
  (md5('coa:67')::uuid, null, 'Long-Term Liabilities', 'Long Term Liability', 'Other Long Term Liabilities', null, null, true, null, 67, 'No code in the workbook (a QuickBooks group heading): give it a code, such as 2000 or 2500, or delete it.'),
  (md5('coa:68')::uuid, '2120', 'Bank Loans Payable (> 1 yr)', 'Long Term Liability', 'Notes Payable', null, null, false, null, 68, null),
  (md5('coa:69')::uuid, '2130', 'Vehicle Loans', 'Long Term Liability', 'Notes Payable', null, null, false, null, 69, null),
  (md5('coa:70')::uuid, '2140', 'Mortgages Payable', 'Long Term Liability', 'Mortgage Payable', null, null, false, null, 70, null),
  (md5('coa:73')::uuid, '3000', 'Net Assets', null, null, null, null, true, 'Retained Earnings', 73, null),
  (md5('coa:74')::uuid, '3100', 'Net Assets Without Donor Restrictions', 'Equity', null, 'Unrestricted general operating fund reserves available for any foundation operational use.', null, false, null, 74, null),
  (md5('coa:75')::uuid, '3200', 'Net Assets With Donor Restrictions', 'Equity', null, 'Unrestricted general operating fund reserves available for any foundation operational use.', null, false, null, 75, 'Its description is a copy of 3100''s ("Unrestricted general operating fund reserves"): write what restricted net assets cover.'),
  (md5('coa:76')::uuid, '3300', 'Net Assets - Initial Contribution', 'Equity', null, 'Common Stock / Owner''s Equity', null, false, 'Paid-in Capital', 76, null),
  (md5('coa:79')::uuid, '4100', 'CASH REVENUE – UNRESTRICTED', 'Main', null, null, null, true, null, 79, null),
  (md5('coa:80')::uuid, '4101', 'Cash Donations - Local (Unrestricted)', 'Sub Revenue', null, 'Local cash contributions with no donor constraints.', md5('coa:79')::uuid, false, 'Cash Donations', 80, 'The revenue accounts document (COA Revenue Accounts, 11 Aug) numbers the revenue accounts 4110, 4111 and on; this workbook uses 4101/4102. Keep one numbering.'),
  (md5('coa:84')::uuid, '4102', 'Cash Donations - International (Unrestricted)', 'Revenue', null, 'Foreign cash contributions with no donor constraints.', md5('coa:79')::uuid, false, null, 84, 'The revenue accounts document (COA Revenue Accounts, 11 Aug) numbers the revenue accounts 4110, 4111 and on; this workbook uses 4101/4102. Keep one numbering.'),
  (md5('coa:89')::uuid, '4200', 'CASH REVENUE – RESTRICTED', 'Main', null, null, null, true, null, 89, null),
  (md5('coa:90')::uuid, '4201', 'Restricted Cash - Local', 'Revenue', null, 'Philippine restricted funding sources.', md5('coa:89')::uuid, false, null, 90, null),
  (md5('coa:95')::uuid, '4202', 'Restricted Cash - International', 'Revenue', null, 'Foreign restricted funding sources.', md5('coa:89')::uuid, false, null, 95, null),
  (md5('coa:99')::uuid, '4300', 'GIFTS-IN-KIND (GIK) / NON-CASH DONATIONS', 'Main', null, null, null, true, 'Non-Cash Donations', 99, null),
  (md5('coa:100')::uuid, '4301', 'GIK - Food', 'Revenue', null, 'Donated food items, groceries, and feeding program supplies.', md5('coa:99')::uuid, false, null, 100, null),
  (md5('coa:103')::uuid, '4302', 'GIK - Non-Food Items', 'Revenue', null, 'Donated physical goods, school supplies, clothes, or equipment.', md5('coa:99')::uuid, false, null, 103, null),
  (md5('coa:106')::uuid, '4303', 'GIK - Pro-Bono Services', 'Revenue', null, 'Fair market value of donated professional services.', md5('coa:99')::uuid, false, null, 106, null),
  (md5('coa:110')::uuid, '4400', 'PROGRAM SERVICES & OTHER REVENUE', 'Main', null, null, null, true, 'Feeding Program Donations', 110, null),
  (md5('coa:111')::uuid, '4401', 'Program Services Revenue (PSR)', 'Revenue', null, 'Fees earned under specific program service agreements (e.g., PSR - CAF).', md5('coa:110')::uuid, false, null, 111, null),
  (md5('coa:112')::uuid, '4402', 'Training & Seminar Fees', 'Revenue', null, 'Nominal registration fees from workshops and community modules.', md5('coa:110')::uuid, false, null, 112, null),
  (md5('coa:113')::uuid, '4403', 'Interest Income', 'Revenue', null, 'Interest earned on savings/time deposit bank accounts (e.g., BPI, BDO, Landbank).', md5('coa:110')::uuid, false, null, 113, null),
  (md5('coa:114')::uuid, '4404', 'Miscellaneous Income', 'Revenue', null, 'Incidental income like scrap sales or asset disposal gains.', md5('coa:110')::uuid, false, null, 114, null),
  (md5('coa:118')::uuid, '5100', 'GIK EXPENSES', 'Expense', null, null, null, true, null, 118, null),
  (md5('coa:119')::uuid, '5101', 'Food', 'Sub Expense', null, 'Value of donated food items distributed to beneficiaries.', md5('coa:118')::uuid, false, 'Program Services:1-Patient Care:6-Non-Cash Expenses:Meal/Food Support_NC', 119, 'The workbook''s Parent Account column says 5300 GIK EXPENSES; the list files it under 5100 GIK EXPENSES. Confirm the parent.'),
  (md5('coa:120')::uuid, '5102', 'Care Cart', 'Sub Expense', null, 'Value of donated meals and snacks distributed through the Care Cart', md5('coa:118')::uuid, false, 'Program Services:2-Care Cart:Food & Distribution Cost', 120, null),
  (md5('coa:121')::uuid, '5103', 'Non-Food', 'Sub Expense', null, 'Value of donated school supplies, clothes, and hygiene kits handed out.', md5('coa:118')::uuid, false, 'Program Services:1-Patient Care:6-Non-Cash Expenses:Non-Food Support_NC', 121, 'The workbook''s Parent Account column says 5300 GIK EXPENSES; the list files it under 5100 GIK EXPENSES. Confirm the parent.'),
  (md5('coa:122')::uuid, '5104', 'Medical Supplies', 'Sub Expense', null, 'Value of donated medicines and health equipment provided to patients.', md5('coa:118')::uuid, false, null, 122, 'The workbook''s Parent Account column says 5300 GIK EXPENSES; the list files it under 5100 GIK EXPENSES. Confirm the parent.'),
  (md5('coa:123')::uuid, '5105', 'Pro-Bono Services', 'Sub Expense', null, 'Value of volunteer medical care, legal counsel, or technical services utilized.', md5('coa:118')::uuid, false, 'Program Services:2-Care Cart:Volunteer Support', 123, 'The workbook''s Parent Account column says 5300 GIK EXPENSES; the list files it under 5100 GIK EXPENSES. Confirm the parent.'),
  (md5('coa:124')::uuid, '5106', 'Ed', 'Sub Expense', null, 'Value of pro-bono Executive Director services provided.', md5('coa:118')::uuid, false, null, 124, 'The account is named "Ed" (pro-bono Executive Director services): give it its full name.'),
  (md5('coa:125')::uuid, '5107', 'Part time CFO', 'Sub Expense', null, 'Value of pro-bono part-time CFO services provided.', md5('coa:118')::uuid, false, null, 125, null),
  (md5('coa:126')::uuid, '5108', 'GIK Disposal', 'Sub Expense', null, 'Sold GIK near expiry.', md5('coa:118')::uuid, false, null, 126, null),
  (md5('coa:127')::uuid, '5109', 'GIK Distribution', 'Sub Expense', null, 'Items given to patients/', md5('coa:118')::uuid, false, null, 127, null),
  (md5('coa:129')::uuid, '5200', 'Board & Lodging', 'Expense', null, 'Temporary housing, room rentals, and shelter assistance for patients/families.', null, true, null, 129, null),
  (md5('coa:130')::uuid, '5201', 'Food Non-cash', 'Sub Expense', null, 'Donated Food', md5('coa:129')::uuid, false, 'Program Services:1-Patient Care:6-Non-Cash Expenses:Meal/Food Support_NC', 130, 'The workbook''s Parent Account column says 5100 Housing & Boarding Expense; the list files it under 5200 Board & Lodging. Confirm the parent.'),
  (md5('coa:131')::uuid, '5202', 'Food Cash', 'Sub Expense', null, 'Condiments, Ingredients, drinking water', md5('coa:129')::uuid, false, 'Program Services:1-Patient Care:3-Meal/Food Support', 131, 'The workbook''s Parent Account column says 5100 Housing & Boarding Expense; the list files it under 5200 Board & Lodging. Confirm the parent.'),
  (md5('coa:132')::uuid, '5203', 'Housing Supplies', 'Sub Expense', null, 'Cleaning Supplies, Laundry, other non food (cooking gas)', md5('coa:129')::uuid, false, 'Program Services:1-Patient Care:1-Housing Support:Maintenance Supplies', 132, 'The workbook''s Parent Account column says 5100 Housing & Boarding Expense; the list files it under 5200 Board & Lodging. Confirm the parent.'),
  (md5('coa:133')::uuid, '5204', 'Repairs and Maintenance', 'Sub Expense', null, 'House, Appliances, Furniture', md5('coa:129')::uuid, false, 'Program Services:1-Patient Care:1-Housing Support:Renovation & Improvements', 133, 'Code 5204 is used by 2 accounts (Repairs and Maintenance; House Parent Housing and Expenses): give one a new code. The workbook''s Parent Account column says 5100 Housing & Boarding Expense; the list files it under 5200 Board & Lodging. Confirm the parent.'),
  (md5('coa:134')::uuid, '5204', 'House Parent Housing and Expenses', null, null, null, md5('coa:129')::uuid, false, null, 134, 'Code 5204 is used by 2 accounts (Repairs and Maintenance; House Parent Housing and Expenses): give one a new code.'),
  (md5('coa:136')::uuid, '5300', 'Patient In-house Transportation', 'Expense', null, 'Emergency cash aid, travel assistance, and patient fare to medical facilities.', null, true, null, 136, null),
  (md5('coa:137')::uuid, '5301', 'Driver''s Fee', 'Sub Expense', null, 'Patients Transportation, Logistics & Errands', md5('coa:136')::uuid, false, 'Program Services:1-Patient Care:2-Hope in Transit (Transportation Support)', 137, null),
  (md5('coa:138')::uuid, '5303', 'Gasoline - Patient', 'Sub Expense', null, 'Gasoline (Patient Transport)', md5('coa:136')::uuid, false, null, 138, null),
  (md5('coa:139')::uuid, '5304', 'Car Insurance', 'Sub Expense', null, 'Car Insurance', md5('coa:136')::uuid, false, null, 139, null),
  (md5('coa:140')::uuid, '5305', 'Car Repairs & Maintenance', 'Sub Expense', null, 'Car Repairs & Maintenance', md5('coa:136')::uuid, false, null, 140, null),
  (md5('coa:142')::uuid, '5400', 'Feeding Program', 'Expense', null, 'Purchased food supplies, cooking gas, and feeding drive logistical costs.', null, true, '(Previously Care Cart)', 142, null),
  (md5('coa:143')::uuid, '5401', 'Non Food - Cash', 'Sub Expense', null, 'Supplies, cooking gas, food delivery', md5('coa:142')::uuid, false, null, 143, null),
  (md5('coa:144')::uuid, '5402', 'Food - Non Cash', 'Sub Expense', null, 'Donated Food', md5('coa:142')::uuid, false, null, 144, null),
  (md5('coa:145')::uuid, '5403', 'Food - Cash', 'Sub Expense', null, 'Condiments, Ingredients, drinks, meals for benefiacry', md5('coa:142')::uuid, false, null, 145, null),
  (md5('coa:146')::uuid, '5404', 'Volunteer Allowances & Transportation', 'Sub Expense', null, 'On call Helper & Volunteers, Public transportation', md5('coa:142')::uuid, false, '2-Care Cart', 146, null),
  (md5('coa:148')::uuid, '5500', 'Nurture and Well Being', 'Expense', null, 'Nurture and Well Being', null, true, null, 148, null),
  (md5('coa:149')::uuid, '5501', 'Bereavement', 'Sub Expense', null, 'Burial', md5('coa:148')::uuid, false, null, 149, null),
  (md5('coa:150')::uuid, '5502', 'Counselling', 'Sub Expense', null, 'Professional Fees', md5('coa:148')::uuid, false, null, 150, null),
  (md5('coa:151')::uuid, '5503', 'Emergency Financial Assistance', 'Sub Expense', null, 'Transportation, Medical ( Chemotherapy, laboratory tests, medicines, and hospital bill payments.)', md5('coa:148')::uuid, false, null, 151, null),
  (md5('coa:152')::uuid, '5504', 'Recovery Assistance', 'Sub Expense', null, 'Tuition, school uniforms, books, and allowances', md5('coa:148')::uuid, false, null, 152, null),
  (md5('coa:153')::uuid, '5505', 'Patients Field Trip', 'Sub Expense', null, 'Visit Museums, educational trips. recreation, etc.', md5('coa:148')::uuid, false, null, 153, null),
  (md5('coa:154')::uuid, '5506', 'Spiritual', 'Sub Expense', null, 'Books, materials, volunteer allowances and other expenses', md5('coa:148')::uuid, false, null, 154, null),
  (md5('coa:155')::uuid, '5507', 'Staff Welfare and Assistance', 'Sub Expense', null, 'Emergency Financial Assistance (Death, Hospitalization, etc.)', md5('coa:148')::uuid, false, null, 155, null),
  (md5('coa:160')::uuid, '5900', 'Payroll & Personnel', 'Expense', 'Payroll Expenses', null, null, true, null, 160, 'The LAF Overview tab puts support costs at 6000-7999; this chart numbers them 5900-5963. Keep the 59xx numbers or renumber.'),
  (md5('coa:161')::uuid, '5010', 'Wages & Salaries', 'Sub Expense', 'Payroll Expenses', null, md5('coa:160')::uuid, false, 'Program Services:1-Patient Care:5-Social Worker Salaries & Benefits:Social Worker Salaries', 161, 'Filed under 5900 Payroll & Personnel but numbered outside its range (59xx): renumber it or file it elsewhere.'),
  (md5('coa:162')::uuid, '5020', 'Contracted Services', null, null, null, md5('coa:160')::uuid, false, 'Program Services:1-Patient Care:1-Housing Support:Maintenance & Security Labor Cost', 162, 'Filed under 5900 Payroll & Personnel but numbered outside its range (59xx): renumber it or file it elsewhere.'),
  (md5('coa:163')::uuid, '5030', '13th Month Pay', 'Sub Expense', 'Payroll Tax Expenses', null, md5('coa:160')::uuid, false, 'Program Services:1-Patient Care:5-Social Worker Salaries & Benefits:13th Month Pay', 163, 'Filed under 5900 Payroll & Personnel but numbered outside its range (59xx): renumber it or file it elsewhere.'),
  (md5('coa:164')::uuid, '5040', 'Employee De-menemis Benefits', 'Sub Expense', 'Employee Benefits', null, md5('coa:160')::uuid, false, 'Program Services:1-Patient Care:5-Social Worker Salaries & Benefits:Communication Allowance', 164, 'Filed under 5900 Payroll & Personnel but numbered outside its range (59xx): renumber it or file it elsewhere.'),
  (md5('coa:165')::uuid, '5050', 'SSS/EC Expense', 'Sub Expense', 'Employee Benefits', null, md5('coa:160')::uuid, false, 'Program Services:1-Patient Care:5-Social Worker Salaries & Benefits:SSS/EC Expense', 165, 'Filed under 5900 Payroll & Personnel but numbered outside its range (59xx): renumber it or file it elsewhere.'),
  (md5('coa:166')::uuid, '5060', 'PHIC Expense', null, null, null, md5('coa:160')::uuid, false, 'Program Services:1-Patient Care:5-Social Worker Salaries & Benefits:PHIC Expense', 166, 'Filed under 5900 Payroll & Personnel but numbered outside its range (59xx): renumber it or file it elsewhere.'),
  (md5('coa:167')::uuid, '5070', 'HDMF Expense', null, null, null, md5('coa:160')::uuid, false, 'Program Services:1-Patient Care:5-Social Worker Salaries & Benefits:HDMF Expense', 167, 'Filed under 5900 Payroll & Personnel but numbered outside its range (59xx): renumber it or file it elsewhere.'),
  (md5('coa:169')::uuid, '5910', 'Fundraising and Development', 'Expense', 'Advertising/Promotional', null, null, true, null, 169, null),
  (md5('coa:170')::uuid, '5901', 'Advertising & Online Marketing', 'Sub Expense', null, null, md5('coa:169')::uuid, false, 'Program Services:4-Donor Management:Marketing & Promotion', 170, null),
  (md5('coa:171')::uuid, '5902', 'Promotional Materials & Gifts', 'Sub Expense', null, null, md5('coa:169')::uuid, false, null, 171, null),
  (md5('coa:172')::uuid, '5903', 'Website Hosting & Software', 'Sub Expense', null, null, md5('coa:169')::uuid, false, null, 172, null),
  (md5('coa:173')::uuid, '5904', 'Fundraising Event Expenses', 'Sub Expense', null, 'Venue rentals, catering, event materials, and permits for benefit activities.', md5('coa:169')::uuid, false, 'Program Services:1-Patient Care:4-Activity Center', 173, null),
  (md5('coa:174')::uuid, '5905', 'Marketing & Donor Communications', 'Sub Expense', null, 'Website hosting, social media promotion, annual report printing, and newsletters.', md5('coa:169')::uuid, false, 'Program Services:4-Donor Management:Donor Relations & Communications', 174, null),
  (md5('coa:175')::uuid, '5906', 'Donor Platform & Payment Gateway Fees', 'Sub Expense', null, 'Processing fees charged by online donation platforms and payment processors.', md5('coa:169')::uuid, false, null, 175, null),
  (md5('coa:176')::uuid, '5907', 'Donor Representation Expense', 'Sub Expense', null, null, md5('coa:169')::uuid, false, null, 176, null),
  (md5('coa:177')::uuid, '5908', 'Fundraising Communication', 'Sub Expense', null, null, md5('coa:169')::uuid, false, null, 177, null),
  (md5('coa:179')::uuid, '5920', 'Professional & Legal Services', 'Expense', 'Legal & Professional Fees', null, null, true, null, 179, null),
  (md5('coa:180')::uuid, '5921', 'Accounting & Bookkeeping', 'Sub Expense', 'Accounting Fees', null, md5('coa:179')::uuid, false, null, 180, null),
  (md5('coa:181')::uuid, '5922', 'Legal Fees', 'Sub Expense', 'Legal Fees', null, md5('coa:179')::uuid, false, 'Supporting Services:Legal and professional fees', 181, 'The workbook''s Parent Account column says 5921 Professional & Legal Services; the list files it under 5920 Professional & Legal Services. Confirm the parent.'),
  (md5('coa:182')::uuid, '5923', 'Business Consultants', 'Sub Expense', 'Consultants', null, md5('coa:179')::uuid, false, 'Supporting Services:Consultancy Fee', 182, 'The workbook''s Parent Account column says 5922 Professional & Legal Services; the list files it under 5920 Professional & Legal Services. Confirm the parent.'),
  (md5('coa:184')::uuid, '5930', 'Travel & Transportation', 'Expense', 'Travel Expenses', null, null, true, null, 184, null),
  (md5('coa:185')::uuid, '5931', 'Travel - Airfare & Lodging', 'Sub Expense', 'Travel', null, md5('coa:184')::uuid, false, null, 185, null),
  (md5('coa:186')::uuid, '5932', 'Travel - Meals', 'Sub Expense', 'Meals and Entertainment', 'Staffs Meals for fieldwork/meetings', md5('coa:184')::uuid, false, 'Program Services:2-Care Cart:Travel & Meal Expense', 186, 'The workbook''s Parent Account column says 5931 Travel & Transportation; the list files it under 5930 Travel & Transportation. Confirm the parent.'),
  (md5('coa:187')::uuid, '5933', 'Public Transportation', 'Sub Expense', 'S', null, md5('coa:184')::uuid, false, 'Program Services:2-Care Cart:Shipping Fees', 187, 'The workbook''s Parent Account column says 5932 Travel & Transportation; the list files it under 5930 Travel & Transportation. Confirm the parent. Its detail type is just "S": complete or clear it.'),
  (md5('coa:188')::uuid, '5934', 'Vehicle Fuel & Gas', 'Sub Expense', null, null, md5('coa:184')::uuid, false, null, 188, 'The workbook''s Parent Account column says 5933 Travel & Transportation; the list files it under 5930 Travel & Transportation. Confirm the parent.'),
  (md5('coa:189')::uuid, '5935', 'Vehicle Maintenance & Repairs', 'Sub Expense', null, null, md5('coa:184')::uuid, false, null, 189, 'The workbook''s Parent Account column says 5934 Travel & Transportation; the list files it under 5930 Travel & Transportation. Confirm the parent.'),
  (md5('coa:190')::uuid, '5936', 'Vehicle Insurance', 'Sub Expense', null, null, md5('coa:184')::uuid, false, null, 190, 'The workbook''s Parent Account column says 5935 Travel & Transportation; the list files it under 5930 Travel & Transportation. Confirm the parent.'),
  (md5('coa:191')::uuid, '5937', 'Driver/Messenger/Logistics/Handyman', null, null, null, md5('coa:184')::uuid, false, null, 191, null),
  (md5('coa:193')::uuid, '5940', 'Office & Operating Expenses', 'Expense', 'Office/General Administrative Expenses', null, null, true, null, 193, null),
  (md5('coa:194')::uuid, '5941', 'Software Subscriptions & Tools', 'Expense', null, 'Quickbooks, Cloud, ChatGPT, gOOGLE', md5('coa:193')::uuid, false, 'Supporting Services:Software Subscriptions', 194, 'The workbook''s Parent Account column says 5920 Office & Operational Expenses; the list files it under 5940 Office & Operating Expenses. Confirm the parent.'),
  (md5('coa:195')::uuid, '5942', 'Dues, Permits, & Licenses', null, null, 'Permits & Licenses', md5('coa:193')::uuid, false, 'Supporting Services:Permits, Taxes & Licenses', 195, null),
  (md5('coa:196')::uuid, '5943', 'Training, Education & Conferences', null, null, null, md5('coa:193')::uuid, false, null, 196, null),
  (md5('coa:197')::uuid, '5944', 'Internet & Communications', 'Sub Expense', null, 'Communications - Internet, Phone', md5('coa:193')::uuid, false, 'Program Services:1-Patient Care:1-Housing Support:Internet & Communication Expense', 197, null),
  (md5('coa:198')::uuid, '5945', 'Office Supplies', 'Sub Expense', null, 'includes cleaning supplies', md5('coa:193')::uuid, false, 'Supporting Services:Office Supplies Expenses', 198, null),
  (md5('coa:200')::uuid, '5950', 'General & Administrative', 'Expense', 'Office/General Administrative Expenses', null, null, true, null, 200, null),
  (md5('coa:201')::uuid, '5951', 'Rent & Facility Lease', 'Sub Expense', null, 'Rental - Non Cash', md5('coa:200')::uuid, false, null, 201, 'Described as "Rental - Non Cash": confirm whether rent paid in cash is coded here too.'),
  (md5('coa:202')::uuid, '5952', 'Utilities', 'Sub Expense', null, 'Utilities - Water & Electricity', md5('coa:200')::uuid, false, 'Program Services:1-Patient Care:1-Housing Support:Light & Water Expenses', 202, null),
  (md5('coa:203')::uuid, '5953', 'Repairs & Maintenance', 'Sub Expense', 'Repair & Maintenance', null, md5('coa:200')::uuid, false, 'Supporting Services:Repairs and Maintenance', 203, null),
  (md5('coa:204')::uuid, '5954', 'Business Insurance', 'Sub Expense', null, 'Fire, Car, etc', md5('coa:200')::uuid, false, null, 204, null),
  (md5('coa:205')::uuid, '5955', 'Property & Other Taxes', 'Sub Expense', null, 'Real Property Tax', md5('coa:200')::uuid, false, null, 205, null),
  (md5('coa:206')::uuid, '5956', 'Bank and other fees', 'Sub Expense', 'Banks, Credit Cards', null, md5('coa:200')::uuid, false, 'Supporting Services:Bank & Service Fees', 206, null),
  (md5('coa:207')::uuid, '5957', 'Postage & Delivery', 'Sub Expense', 'Banks, Credit Cards', null, md5('coa:200')::uuid, false, 'Supporting Services:Shipping and delivery expense', 207, 'Its detail type ("Banks, Credit Cards") is copied from 5956: correct it for postage and delivery.'),
  (md5('coa:208')::uuid, '5958', 'Misc. Expenses', 'Sub Expense', null, null, md5('coa:200')::uuid, false, 'Supporting Services:Miscellaneous Expense', 208, null),
  (md5('coa:209')::uuid, '5959', 'Depreciation Expense - Furniture & Fixtures', null, null, null, md5('coa:200')::uuid, false, 'Supporting Services:Depreciation Expense - Furniture & Fixture', 209, null),
  (md5('coa:210')::uuid, '5960', 'Depreciation Expense - Machinery & Tools', null, null, null, md5('coa:200')::uuid, false, null, 210, null),
  (md5('coa:211')::uuid, '5961', 'Depreciation Expense - Vehicles', null, null, null, md5('coa:200')::uuid, false, 'Supporting Services:Depreciation Expense - Transportation Equipment', 211, null),
  (md5('coa:212')::uuid, '5962', 'Depreciation Expense - Buildings & Real Estate', null, null, null, md5('coa:200')::uuid, false, 'Supporting Services:Depreciation Expense - Housing Facility Equipment', 212, null),
  (md5('coa:213')::uuid, '5963', 'Depreciation Expense - Capital Renovations and Repairs', null, null, null, md5('coa:200')::uuid, false, null, 213, null)
on conflict (id) do nothing;

insert into ops.fin_codes (id, tier, code, name, parent_id, restricted, account_prefixes, sort, active, review_note) values
  (md5('code:T1:ADM')::uuid, 'T1', 'ADM', 'Admin', null, false, '{}', 1, true, 'Code proposed by the app (the workbook says "Mike - Create the code"): keep it or change it.'),
  (md5('code:T1:PRG')::uuid, 'T1', 'PRG', 'Program', null, false, '{}', 2, true, 'Code proposed by the app (the workbook says "Mike - Create the code"): keep it or change it.'),
  (md5('code:T1:FIN')::uuid, 'T1', 'FIN', 'Finance', md5('code:T1:ADM')::uuid, false, '{}', 3, false, null),
  (md5('code:T1:HR')::uuid, 'T1', 'HR', 'Human Resources', md5('code:T1:ADM')::uuid, false, '{}', 4, false, null),
  (md5('code:T1:IT')::uuid, 'T1', 'IT', 'Information Technology', md5('code:T1:ADM')::uuid, false, '{}', 5, false, null),
  (md5('code:T1:OPS')::uuid, 'T1', 'OPS', 'Operations', md5('code:T1:PRG')::uuid, false, '{}', 6, false, null),
  (md5('code:T1:FDC')::uuid, 'T1', 'FDC', 'Fundraising & Donor Care', md5('code:T1:PRG')::uuid, false, '{}', 7, false, null),
  (md5('code:T2:OC')::uuid, 'T2', 'OC', 'One Child', null, true, '{}', 1, true, 'Code proposed by the app: keep it or change it. Restricted: list the accounts it may pay for, or leave the list empty to allow any account.'),
  (md5('code:T2:LIFE')::uuid, 'T2', 'LIFE', 'LIFE', null, true, '{}', 2, true, 'Code proposed by the app: keep it or change it. Restricted: list the accounts it may pay for, or leave the list empty to allow any account.'),
  (md5('code:T2:UNR')::uuid, 'T2', 'UNR', 'Unrestricted', null, false, '{}', 3, true, 'Added by the app: the vouchers'' Type of Funding uses "Unrestricted" and "LAF". Keep it or change it.'),
  (md5('code:T2:DONA')::uuid, 'T2', 'DONA', 'Donor A', null, true, '{}', 4, false, 'A placeholder in the workbook: rename it to the real donor fund, or delete it.'),
  (md5('code:T3:HSG')::uuid, 'T3', 'HSG', 'Housing', md5('code:T1:PRG')::uuid, false, '{52}', 1, true, 'Code proposed by the app: keep it or change it. ArkOS programs counted here: Housing, Meals.'),
  (md5('code:T3:TRN')::uuid, 'T3', 'TRN', 'In-house Transportation', md5('code:T1:PRG')::uuid, false, '{53}', 2, true, 'Code proposed by the app: keep it or change it. ArkOS programs counted here: Transportation.'),
  (md5('code:T3:CCT')::uuid, 'T3', 'CCT', 'Care Cart (feeding program)', md5('code:T1:PRG')::uuid, false, '{54}', 3, true, 'Code proposed by the app: keep it or change it. ArkOS programs counted here: Care Cart.'),
  (md5('code:T3:NWB')::uuid, 'T3', 'NWB', 'Nurture & Well Being', md5('code:T1:PRG')::uuid, false, '{55}', 4, true, 'Code proposed by the app: keep it or change it. ArkOS programs counted here: Activities, Spiritual Care.')
on conflict (id) do nothing;

update ops.programs p set t3_id = m.t3::uuid
from (values ('prog-housing', md5('code:T3:HSG')), ('prog-meals', md5('code:T3:HSG')), ('prog-transport', md5('code:T3:TRN')),
             ('prog-carecart', md5('code:T3:CCT')), ('prog-activities', md5('code:T3:NWB')), ('prog-spiritual', md5('code:T3:NWB'))) m(id, t3)
where p.id = m.id and p.t3_id is null;

-- Proposed from the chart's own descriptions; the account row is fixed (coa:<workbook row>).
insert into ops.expense_types (id, label, use_id, account_id, sort, review_note)
select md5('exp:' || e.label || ':' || e.use_code)::uuid, e.label, md5(e.use_code)::uuid, md5('coa:' || e.coa_row)::uuid, e.sort,
       'Proposed by the app from the chart''s descriptions: confirm it or change it.'
from (values
  ('Gasoline / fuel', 'code:T3:TRN', 138, 1), ('Gasoline / fuel', 'code:T1:ADM', 188, 1),
  ('Vehicle repair and maintenance', 'code:T3:TRN', 140, 2), ('Vehicle repair and maintenance', 'code:T1:ADM', 189, 2),
  ('Vehicle insurance', 'code:T3:TRN', 139, 3), ('Vehicle insurance', 'code:T1:ADM', 190, 3),
  ('Driver''s or messenger''s fee', 'code:T3:TRN', 137, 4), ('Driver''s or messenger''s fee', 'code:T1:ADM', 191, 4),
  ('Food and ingredients', 'code:T3:HSG', 131, 5), ('Food and ingredients', 'code:T3:CCT', 145, 5),
  ('Drinking water', 'code:T3:HSG', 131, 6), ('Drinking water', 'code:T3:CCT', 145, 6),
  ('Staff meals (fieldwork, meetings)', 'code:T1:ADM', 186, 7),
  ('Cleaning and laundry supplies', 'code:T3:HSG', 132, 8), ('Cleaning and laundry supplies', 'code:T1:ADM', 198, 8),
  ('Cooking gas', 'code:T3:HSG', 132, 9), ('Cooking gas', 'code:T3:CCT', 143, 9),
  ('Kitchen and other non-food supplies', 'code:T3:HSG', 132, 10), ('Kitchen and other non-food supplies', 'code:T3:CCT', 143, 10),
  ('Food delivery', 'code:T3:CCT', 143, 11),
  ('Repairs: house, appliances, furniture', 'code:T3:HSG', 133, 12), ('Repairs: house, appliances, furniture', 'code:T1:ADM', 203, 12),
  ('House parent housing and expenses', 'code:T3:HSG', 134, 13),
  ('Volunteer allowance and transport', 'code:T3:CCT', 146, 14),
  ('Public transport fare (staff)', 'code:T1:ADM', 187, 15),
  ('Burial and bereavement', 'code:T3:NWB', 149, 16),
  ('Counselling fee', 'code:T3:NWB', 150, 17),
  ('Emergency financial or medical assistance', 'code:T3:NWB', 151, 18),
  ('Recovery assistance: tuition, uniforms, books', 'code:T3:NWB', 152, 19),
  ('Field trip and recreation', 'code:T3:NWB', 153, 20),
  ('Spiritual activities: books, materials, volunteers', 'code:T3:NWB', 154, 21),
  ('Staff welfare and assistance', 'code:T3:NWB', 155, 22),
  ('Airfare and lodging', 'code:T1:ADM', 185, 23),
  ('Software subscriptions', 'code:T1:ADM', 194, 24),
  ('Dues, permits and licenses', 'code:T1:ADM', 195, 25),
  ('Training and conferences', 'code:T1:ADM', 196, 26),
  ('Internet and phone', 'code:T1:ADM', 197, 27),
  ('Office supplies', 'code:T1:ADM', 198, 28),
  ('Rent', 'code:T1:ADM', 201, 29),
  ('Utilities: water and electricity', 'code:T1:ADM', 202, 30),
  ('Business insurance', 'code:T1:ADM', 204, 31),
  ('Property and other taxes', 'code:T1:ADM', 205, 32),
  ('Bank fees', 'code:T1:ADM', 206, 33),
  ('Postage and delivery', 'code:T1:ADM', 207, 34),
  ('Accounting and bookkeeping', 'code:T1:ADM', 180, 35),
  ('Legal fees', 'code:T1:ADM', 181, 36),
  ('Consultants', 'code:T1:ADM', 182, 37),
  ('Advertising and online marketing', 'code:T1:ADM', 170, 38),
  ('Promotional materials and gifts', 'code:T1:ADM', 171, 39),
  ('Website hosting', 'code:T1:ADM', 172, 40),
  ('Fundraising event', 'code:T1:ADM', 173, 41),
  ('Donor platform and payment fees', 'code:T1:ADM', 175, 42),
  ('Furniture and fixtures (an asset)', 'code:T1:ADM', 38, 43),
  ('Machinery and tools (an asset)', 'code:T1:ADM', 40, 44),
  ('Capital renovation (an asset)', 'code:T1:ADM', 46, 45),
  ('Miscellaneous', 'code:T1:ADM', 208, 46)
) e(label, use_code, coa_row, sort)
on conflict (id) do nothing;

-- The two funds the registers use; the floats, custodians and the GCash account are the Super Admin's to fill.
insert into ops.cash_funds (id, kind, name, account_id) values
  (md5('fund:petty_cash')::uuid, 'petty_cash', 'Petty Cash', md5('coa:10')::uuid),
  (md5('fund:gcash')::uuid, 'gcash', 'GCash fund', null)
on conflict (id) do nothing;

-- 6. Read: active staff (a requester picks from these lists), except payees (TINs), which only Finance reads.
-- Write: whoever sets up Finance. The general settings row is only ever updated.
do $$
declare t text;
begin
  foreach t in array array['coa_accounts', 'fin_codes', 'expense_types', 'finance_settings', 'voucher_authority', 'cash_funds', 'ewt_rates', 'payees'] loop
    execute format('alter table ops.%I enable row level security', t);
    execute format('drop policy if exists "staff read" on ops.%I', t);
    execute format('drop policy if exists "finance reads" on ops.%I', t);
    execute format('drop policy if exists "finance setup adds" on ops.%I', t);
    execute format('drop policy if exists "finance setup changes" on ops.%I', t);
    execute format('drop policy if exists "finance setup removes" on ops.%I', t);
    if t = 'payees' then
      execute format('create policy "finance reads" on ops.%I for select to authenticated using ((select shared.module_level(''finance'')) <> ''none'' or (select shared.has_power(''finance_setup'')))', t);
    else
      execute format('create policy "staff read" on ops.%I for select to authenticated using ((select shared.current_staff_roles()) is not null)', t);
    end if;
    execute format('create policy "finance setup changes" on ops.%I for update to authenticated using ((select shared.has_power(''finance_setup''))) with check ((select shared.has_power(''finance_setup'')))', t);
    if t <> 'finance_settings' then
      execute format('create policy "finance setup adds" on ops.%I for insert to authenticated with check ((select shared.has_power(''finance_setup'')))', t);
      execute format('create policy "finance setup removes" on ops.%I for delete to authenticated using ((select shared.has_power(''finance_setup'')))', t);
      execute format('grant select, insert, update, delete on ops.%I to authenticated', t);
    else
      execute format('grant select, update on ops.%I to authenticated', t);
    end if;
    execute format('drop trigger if exists set_updated_at on ops.%I', t);
    execute format('create trigger set_updated_at before update on ops.%I for each row execute function shared.set_updated_at()', t);
  end loop;
end $$;

-- 7. The change log: every change to the lists above, with who made it and the row before and after.
create table if not exists ops.finance_setup_log (
  id uuid primary key default gen_random_uuid(),
  changed_at timestamptz not null default now(),
  changed_by uuid default auth.uid(),
  table_name text not null,
  row_key text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  before jsonb,
  after jsonb
);
create index if not exists finance_setup_log_at on ops.finance_setup_log (changed_at desc);
alter table ops.finance_setup_log enable row level security;
drop policy if exists "finance setup reads" on ops.finance_setup_log;
create policy "finance setup reads" on ops.finance_setup_log for select to authenticated using ((select shared.has_power('finance_setup')));
grant select on ops.finance_setup_log to authenticated;

create or replace function ops.log_finance_setup()
returns trigger language plpgsql security definer set search_path = ops, pg_temp as $$
declare v jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into ops.finance_setup_log (table_name, row_key, action, before, after)
  values (tg_table_name, coalesce(v->>'id', v->>'atc'), tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
revoke all on function ops.log_finance_setup() from public;

do $$
declare t text;
begin
  foreach t in array array['coa_accounts', 'fin_codes', 'expense_types', 'finance_settings', 'voucher_authority', 'cash_funds', 'ewt_rates', 'payees'] loop
    execute format('drop trigger if exists log_finance_setup on ops.%I', t);
    execute format('create trigger log_finance_setup after insert or update or delete on ops.%I for each row execute function ops.log_finance_setup()', t);
  end loop;
end $$;

-- 8. The setup checklist (the Monthly Close pattern): what is still open before the first payment request.
-- Any staff member may ask (the request form shows whether requests are open); it answers with counts and
-- the names of roles, programs, steps and funds, never people.
create or replace function ops.finance_setup_checklist()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_items jsonb := '[]'::jsonb;
  n integer;
  v_list text;
  s ops.finance_settings;
begin
  if shared.current_staff_roles() is null then
    raise exception 'Only staff can read the finance setup.' using errcode = '42501';
  end if;

  select count(*) into n from ops.coa_accounts where review_note is not null;
  v_items := v_items || jsonb_build_object('key', 'chart', 'label', 'Chart of accounts settled', 'done', n = 0,
    'detail', case when n = 0 then 'Every account is settled.' when n = 1 then '1 account carries a note to settle.' else n || ' accounts carry a note to settle.' end);

  select count(*) into n from ops.fin_codes where review_note is not null;
  select string_agg(p.name, ', ' order by p.name) into v_list from ops.programs p where p.t3_id is null;
  v_items := v_items || jsonb_build_object('key', 'codes', 'label', 'Cost centers, funds and programs settled', 'done', n = 0 and v_list is null,
    'detail', concat_ws(' ',
      case when n = 1 then '1 code carries a note to settle.' when n > 1 then n || ' codes carry a note to settle.' end,
      case when v_list is not null then 'ArkOS programs without a voucher program: ' || v_list || '.' end,
      case when n = 0 and v_list is null then 'Every code is settled and every ArkOS program has its voucher program.' end));

  select count(*) filter (where e.review_note is not null), string_agg(distinct e.label, ', ') filter (where a.is_header or not a.active)
    into n, v_list
    from ops.expense_types e join ops.coa_accounts a on a.id = e.account_id where e.active;
  v_items := v_items || jsonb_build_object('key', 'expense_types', 'label', 'Expense types confirmed', 'done', n = 0 and v_list is null,
    'detail', concat_ws(' ',
      case when n = 1 then '1 expense type to confirm.' when n > 1 then n || ' expense types to confirm.' end,
      case when v_list is not null then 'Pointing at a heading or switched-off account: ' || v_list || '.' end,
      case when n = 0 and v_list is null then 'Every expense type is confirmed.' end));

  -- Each step must be covered from 0 up (ranges [min, max)), counting only rows whose person is active:
  -- some row starts at 0, and every finite end falls inside another row. Endorsement: per main role in use.
  with need as (
    select s2.step, null::text as role, s2.label from (values ('validate', 'Validate'), ('review', 'Review'), ('approve', 'Approve'),
      ('approve_payment', 'Approve the payment'), ('release', 'Release')) s2(step, label)
    union all
    select 'endorse', r.key, 'Endorse for ' || r.name from shared.roles r
    where r.key <> 'partner_viewer' and exists (select 1 from shared.staff st where st.active and st.role = r.key)
  ), rows_in as (
    select a.step, a.requester_role as role, a.min_amount as mn, coalesce(a.max_amount, 1e15) as mx
    from ops.voucher_authority a
    where not a.urgent and (a.staff_id is null or exists (select 1 from shared.staff st where st.id = a.staff_id and st.active))
  )
  select string_agg(need.label, ', ' order by need.label) into v_list
  from need
  where not exists (select 1 from rows_in r where r.step = need.step and r.role is not distinct from need.role and r.mn = 0)
     or exists (select 1 from rows_in r1 where r1.step = need.step and r1.role is not distinct from need.role and r1.mx < 1e15
                and not exists (select 1 from rows_in r2 where r2.step = need.step and r2.role is not distinct from need.role and r2.mn <= r1.mx and r2.mx > r1.mx));
  v_items := v_items || jsonb_build_object('key', 'authority', 'label', 'Approval authority for every step and amount', 'done', v_list is null,
    'detail', coalesce('Not covered from ₱0 up (or the person is inactive): ' || v_list || '.', 'Every step has an active signer for every amount.'));

  select string_agg(f.name || ' (' || concat_ws(', ',
           case when f.account_id is null then 'no account' when a.is_header or not a.active or a.review_note is not null then 'its account is a heading, switched off or unsettled' end,
           case when f.float_amount is null then 'no float' end,
           case when f.top_up_below is null then 'no top-up point' end,
           case when f.custodian_staff_id is null then 'no custodian' end) || ')', '; ' order by f.name)
    into v_list
    from ops.cash_funds f left join ops.coa_accounts a on a.id = f.account_id
    where f.active and (f.account_id is null or a.is_header or not a.active or a.review_note is not null or f.float_amount is null or f.top_up_below is null or f.custodian_staff_id is null);
  v_items := v_items || jsonb_build_object('key', 'funds', 'label', 'Petty cash and GCash funds set', 'done', v_list is null,
    'detail', coalesce(v_list || '.', 'Every fund has its account, float, top-up point and custodian.'));

  select * into s from ops.finance_settings;
  v_items := v_items || jsonb_build_object('key', 'general', 'label', 'Start date and liquidation deadline', 'done', s.start_date is not null and s.liquidation_days is not null,
    'detail', case when s.start_date is null and s.liquidation_days is null then 'No start date and no liquidation deadline yet.'
                   when s.start_date is null then 'No start date yet.'
                   when s.liquidation_days is null then 'No liquidation deadline yet.'
                   else 'Requests start ' || to_char(s.start_date, 'FMMonth FMDD, YYYY') || '; advances are liquidated within ' || s.liquidation_days || ' days.' end);

  return jsonb_build_object('ready', not exists (select 1 from jsonb_array_elements(v_items) i where not (i->>'done')::boolean), 'items', v_items);
end $$;
revoke all on function ops.finance_setup_checklist() from public;
grant execute on function ops.finance_setup_checklist() to authenticated, service_role;

-- 9. The two new powers: setting up Finance (nobody but the Super Admin until granted) and exporting for
-- QuickBooks (Finance Staff).
alter table shared.role_powers drop constraint if exists role_powers_power_check;
alter table shared.role_powers add constraint role_powers_power_check
  check (power in ('runs_hr', 'finance_work', 'bed_exception', 'floor_plan_layout', 'driver', 'clinical_detail', 'caf_billing', 'caf_billing_view', 'confirm_summary', 'finance_setup', 'finance_export'));
insert into shared.role_powers (role, power) values ('finance', 'finance_export') on conflict do nothing;

-- 10. Live updates for the settings screens.
do $$ begin
  alter publication supabase_realtime add table ops.coa_accounts, ops.fin_codes, ops.expense_types, ops.finance_settings,
    ops.voucher_authority, ops.cash_funds, ops.ewt_rates, ops.payees, ops.finance_setup_log;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
