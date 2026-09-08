-- The compliance calendar: every recurring government obligation, its due
-- rule, and what has been filed.
--
-- hr.compliance_items is seeded from the foundation's "LAF List of Govt
-- Compliances" workbook, one row per line, with the prose due date kept in
-- `notes` and the rule the calendar computes from in `due_rule`
-- (lib/utils/compliance.ts parseDueRule validates the shape on save).
-- `applies` is the workbook's column: YES, YES if employees, CONDITIONAL,
-- NOT REQUIRED. Conditional items start switched off; HR turns them on.
--
-- hr.compliance_filings: one row per item per period ("2026-08", "2026-Q3",
-- "2026") once HR touches it -- in progress, filed with the reference and
-- amount, or not applicable. Nothing per employee lives here, so the
-- policies are HR-only; there is no own-read.
--
-- shared.app_settings gains the three numbers the rules need: the last
-- digit of the PhilHealth Employer Number (PEN 0-4 pays by the 15th, 5-9
-- by the 20th), the employer name's first character (Pag-IBIG's schedule
-- runs A-D / E-L / M-Q / R-Z), and the date the calendar starts, so the
-- months before the system existed are not shown as overdue.
--
-- Year attribution, for every report built on payslips: a payslip belongs
-- to its RUN's year (hr.payroll_runs.year), never its pay date -- the
-- Dec 16-31 cutoff pays on Jan 5. Monthly remittance figures group by the
-- pay period's month (hr.pay_periods.starts_on).

alter table shared.app_settings
  add column compliance_pen_last_digit smallint
    check (compliance_pen_last_digit is null or compliance_pen_last_digit between 0 and 9),
  add column compliance_employer_initial text
    check (compliance_employer_initial is null or length(compliance_employer_initial) = 1),
  add column compliance_tracking_from date not null default '2026-08-01';

-- ---------------------------------------------------------------------------
-- hr.compliance_items
-- ---------------------------------------------------------------------------

create table hr.compliance_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  agency text not null,
  name text not null,
  form text,
  category text not null check (category in ('employment', 'corporate', 'lgu', 'data_privacy', 'osh')),
  frequency text not null check (frequency in ('monthly', 'quarterly', 'annual', 'as_needed')),
  due_rule jsonb not null default '{"kind": "as_needed"}'::jsonb,
  applies text not null default 'yes' check (applies in ('yes', 'if_employees', 'conditional', 'not_required')),
  active boolean not null default true,
  portal_url text,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table hr.compliance_items enable row level security;

-- Everyone on staff may read the calendar's definitions; HR shapes them.
create policy "staff read compliance items" on hr.compliance_items
  for select to authenticated
  using (shared.current_staff_role() is not null);

create policy "hr manage compliance items" on hr.compliance_items
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create trigger set_updated_at
  before update on hr.compliance_items
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.compliance_items;

insert into hr.compliance_items (code, agency, name, form, category, frequency, due_rule, applies, active, notes, sort_order) values
  -- SEC
  ('sec_gis', 'SEC', 'General Information Sheet (GIS), non-stock', 'SEC GIS 2026', 'corporate', 'annual', '{"kind": "fixed", "month": 1, "day": 30, "yearOffset": 1}', 'yes', true, 'Within 30 calendar days from the actual annual members'' meeting; if no annual meeting is held, by January 30 of the following year. The 2026 GIS version is used from Jan 30, 2026; filed through eFAST/HARBOR.', 10),
  ('sec_bod', 'SEC', 'Beneficial Ownership Declaration', 'BOD', 'corporate', 'annual', '{"kind": "fixed", "month": 1, "day": 30, "yearOffset": 1}', 'yes', true, 'Same date as the GIS under current SEC reportorial requirements. Now filed through HARBOR; previously part of the GIS.', 20),
  ('sec_afs', 'SEC', 'Financial Statements', 'AFS / unaudited FS if qualified', 'corporate', 'annual', '{"kind": "fixed", "month": 4, "day": 30, "yearOffset": 1}', 'yes', true, 'Generally within 120 calendar days after fiscal year-end; SEC publishes a filing schedule by last digit of the registration number each year -- verify the advisory. Non-stock corporations with total assets or liabilities below the threshold may file unaudited statements.', 30),
  ('sec_amend', 'SEC', 'Corporate changes / amendments', 'eAMEND / appropriate SEC form', 'corporate', 'as_needed', '{"kind": "as_needed"}', 'conditional', false, 'Within the period prescribed for the specific change: officers/trustees, address, purpose.', 40),
  ('sec_mc28', 'SEC', 'MC 28 contact information', 'MC 28', 'corporate', 'as_needed', '{"kind": "as_needed"}', 'conditional', false, 'Submit or update the official and alternate email and mobile number when they change.', 50),
  -- BIR
  ('bir_1702', 'BIR', 'Annual corporate income tax return', 'BIR Form 1702', 'corporate', 'annual', '{"kind": "fixed", "month": 4, "day": 15, "yearOffset": 1}', 'yes', true, 'On or before the 15th day of the 4th month following the close of the taxable year (calendar year: April 15). The Sec. 30 exemption does not remove the filing.', 100),
  ('bir_1702q', 'BIR', 'Quarterly corporate income tax return', 'BIR Form 1702Q', 'corporate', 'quarterly', '{"kind": "quarterly", "offsetDays": 60, "quarters": [1, 2, 3]}', 'yes', true, 'Within 60 calendar days following the close of each of the first three quarters.', 110),
  ('bir_2551q', 'BIR', 'Quarterly percentage tax return', 'BIR Form 2551Q', 'corporate', 'quarterly', '{"kind": "quarterly", "day": 25}', 'yes', true, 'Within 25 days after the end of each taxable quarter. Non-VAT status per the COR.', 120),
  ('bir_1601c', 'BIR', 'Monthly withholding tax on compensation', 'BIR Form 1601-C', 'employment', 'monthly', '{"kind": "day_of_month", "day": 10, "december": {"month": 1, "day": 15}}', 'if_employees', true, 'On or before the 10th of the following month; the December return is due January 15 (RR 11-2018). The figures come from the month''s approved payroll runs (HR -> Reports).', 130),
  ('bir_1604c', 'BIR', 'Annual information return on compensation', 'BIR Form 1604-C', 'employment', 'annual', '{"kind": "fixed", "month": 1, "day": 31, "yearOffset": 1}', 'if_employees', true, 'January 31 of the following year, with the alphalist of employees.', 140),
  ('bir_alphalist', 'BIR', 'Alphalist of employees (with 1604-C)', 'Alphalist data entry / eSubmission', 'employment', 'annual', '{"kind": "fixed", "month": 1, "day": 31, "yearOffset": 1}', 'if_employees', true, 'Schedules 1 and 2 of the 1604-C, submitted through eSubmission or the alphalist validation module. Generated under HR -> Reports.', 150),
  ('bir_2316', 'BIR', 'Certificate of compensation to each employee', 'BIR Form 2316', 'employment', 'annual', '{"kind": "fixed", "month": 1, "day": 31, "yearOffset": 1}', 'if_employees', true, 'Given to every employee by January 31 of the following year, or with the final pay on separation; signed copies of substituted-filing employees go to the RDO by February 28.', 160),
  ('bir_0619e', 'BIR', 'Monthly remittance of expanded withholding tax', 'BIR Form 0619-E', 'corporate', 'monthly', '{"kind": "day_of_month", "day": 10}', 'conditional', false, '10th day of the following month (eFPS filers stagger later). Applies when the foundation withholds on rent, professional fees or suppliers; a zero remittance may still be required while the tax type is on the COR.', 170),
  ('bir_1601eq', 'BIR', 'Quarterly remittance return, expanded withholding tax', 'BIR Form 1601-EQ', 'corporate', 'quarterly', '{"kind": "quarterly", "monthEnd": true}', 'conditional', false, 'Not later than the last day of the month following the close of the quarter, with the QAP.', 180),
  ('bir_1604e', 'BIR', 'Annual information return, expanded withholding', 'BIR Form 1604-E', 'corporate', 'annual', '{"kind": "fixed", "month": 3, "day": 1, "yearOffset": 1}', 'conditional', false, 'On or before March 1 of the following year, with the alphalist of payees.', 190),
  ('bir_books', 'BIR', 'Registration of books of accounts', 'ORUS registration of books', 'corporate', 'annual', '{"kind": "fixed", "month": 1, "day": 15, "yearOffset": 1}', 'yes', true, 'Manual books: before the initial ITR deadline or before use for subsequent years. Loose-leaf: January 15; computerised: January 30 of the following year. Registered through ORUS.', 200),
  ('bir_reg_update', 'BIR', 'Registration information updates', 'ORUS / RDO update', 'corporate', 'as_needed', '{"kind": "as_needed"}', 'conditional', false, 'When registered information, tax types or contact details change: address, contact person, authorised representative.', 210),
  ('bir_0605', 'BIR', 'Annual registration fee', 'BIR Form 0605 (P500 ARF)', 'corporate', 'annual', '{"kind": "as_needed"}', 'not_required', false, 'No longer required since January 22, 2024 (EOPT Act). The COR may still display the old registration-fee tax type.', 220),
  -- SSS / PhilHealth / Pag-IBIG
  ('sss_prn', 'SSS', 'Employer contribution remittance', 'SSS PRN / e-CL', 'employment', 'monthly', '{"kind": "last_day_next_month"}', 'if_employees', true, 'Last day of the month following the applicable month, through the My.SSS employer portal with a PRN. The month''s list comes from HR -> Reports.', 300),
  ('philhealth_eprs', 'PhilHealth', 'Employer premium remittance and report', 'EPRS', 'employment', 'monthly', '{"kind": "pen_digit"}', 'if_employees', true, 'PEN ending 0-4: 11th-15th of the following month; 5-9: 16th-20th. Set the PEN''s last digit in Settings for the dates to appear.', 310),
  ('pagibig_mcrf', 'HDMF / Pag-IBIG', 'Employer membership savings remittance', 'MCRF / Pag-IBIG employer remittance', 'employment', 'monthly', '{"kind": "employer_initial"}', 'if_employees', true, 'By the employer name''s first letter: A-D 10th-14th, E-L 15th-19th, M-Q 20th-24th, R-Z and numerals 25th to month-end of the following month. Set the initial in Settings. Late remittance is penalised.', 320),
  -- DOLE
  ('dole_aerw', 'DOLE / NWPC', 'Annual Establishment Report on Wages', 'AERW', 'employment', 'annual', '{"kind": "fixed", "month": 8, "day": 31, "yearOffset": 1}', 'yes', true, 'For the prior year, filed in the May 15 - August 31 window on the NWPC/DOLE portal in the prescribed Excel format. All private establishments.', 400),
  ('dole_13th_report', 'DOLE', '13th month pay compliance report', 'DOLE Online Compliance Portal', 'employment', 'annual', '{"kind": "fixed", "month": 1, "day": 15, "yearOffset": 1}', 'if_employees', true, 'Not later than January 15 of the following year. The 13th month itself is paid by December 24 (PD 851).', 410),
  ('dole_osh', 'DOLE', 'Occupational safety and health reports', 'AMR / OSH committee / WAIR / AEDR', 'osh', 'as_needed', '{"kind": "as_needed"}', 'conditional', false, 'Deadlines depend on the report and the OSH rules that apply (DO 198-18). For 1-9 workers: a first aider and a safety officer 1; report work accidents (WAIR) and the annual medical report (AMR) through the DOLE portal.', 420),
  -- LGU
  ('lgu_business_permit', 'LGU', 'Business permit / mayor''s permit renewal', 'Local business permit', 'lgu', 'annual', '{"kind": "fixed", "month": 1, "day": 20, "yearOffset": 0}', 'yes', true, 'Within the first 20 days of January unless the local ordinance says otherwise. Registered office is in Mandaluyong; verify the city''s requirements and fees.', 500),
  ('lgu_fsic', 'LGU / BFP', 'Fire safety inspection certificate', 'FSIC', 'lgu', 'annual', '{"kind": "fixed", "month": 1, "day": 20, "yearOffset": 0}', 'yes', true, 'Tied to the business permit renewal (RA 11032). Confirm the process with Mandaluyong BFP.', 510),
  ('lgu_barangay', 'LGU', 'Barangay clearance / local clearances', 'Barangay / local permit', 'lgu', 'annual', '{"kind": "fixed", "month": 1, "day": 20, "yearOffset": 0}', 'conditional', false, 'Depends on the LGU ordinance and the business permit cycle.', 520),
  ('lgu_sanitary', 'LGU', 'Sanitary / health permit', 'Sanitary permit', 'lgu', 'as_needed', '{"kind": "as_needed"}', 'conditional', false, 'Depends on the nature of operations and the local ordinance.', 530),
  -- NPC
  ('npc_asir', 'NPC', 'Annual Security Incident Report', 'NPC DBNMS', 'data_privacy', 'annual', '{"kind": "fixed", "month": 3, "day": 31, "yearOffset": 1}', 'conditional', true, 'March 31 following the reporting year. NPC requires the ASIR from personal information controllers whether or not they must register; the HR module now holds employee personal data, so it applies.', 600);

-- ---------------------------------------------------------------------------
-- hr.compliance_filings
-- ---------------------------------------------------------------------------

create table hr.compliance_filings (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references hr.compliance_items (id) on delete cascade,
  -- "2026-08", "2026-Q3", "2026"
  period_key text not null,
  due_on date not null,
  status text not null default 'in_progress' check (status in ('due', 'in_progress', 'filed', 'late', 'na')),
  filed_on date,
  reference_no text,
  amount numeric(14, 2),
  attachment_url text,
  notes text,
  filed_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, period_key),
  check ((status = 'filed') = (filed_on is not null))
);

create index compliance_filings_due_idx on hr.compliance_filings (due_on);

alter table hr.compliance_filings enable row level security;

create policy "hr manage compliance filings" on hr.compliance_filings
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create trigger set_updated_at
  before update on hr.compliance_filings
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.compliance_filings;
