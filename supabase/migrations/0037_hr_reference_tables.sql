-- The reference data payroll and leave are computed against: holidays, the
-- government contribution and tax tables, the minimum wage, and the leave
-- types. All editable by HR at runtime -- a new proclamation or circular is
-- a row, not a deploy -- and all effective-dated where the law is.
--
-- hr.rate_tables holds one row per VERSION of a table (a circular, a wage
-- order, a revenue regulation), with the brackets in `rows` and scalar
-- parameters in `params`. lib/utils/statutory.ts validates the shape on
-- save and is the only reader. `status` matters: only `in_force` versions
-- price a payslip; `enjoined` is for an order that exists but is stayed by
-- a court -- Wage Order NCR-27 (P755 from 25 Jul 2026, P780 from 20 Jan
-- 2027) is under a Pasig RTC preliminary injunction (13 Aug 2026) as this is
-- written, and if the injunction is lifted the differential falls due
-- retroactively. Seeding it as enjoined keeps that fact in the data.
-- Every payroll run records which versions it used (0042 rate_snapshot).

-- ---------------------------------------------------------------------------
-- Holidays
-- ---------------------------------------------------------------------------

create table hr.holidays (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  name text not null,
  -- Art. 94 (regular: paid unworked, 200% worked); special non-working
  -- (no work, no pay; 130% worked); special working (an ordinary day).
  kind text not null check (kind in ('regular', 'special_non_working', 'special_working')),
  -- null = nationwide. Local holidays apply where the person works.
  scope_city text,
  source text,
  created_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, name)
);

create index holidays_date_idx on hr.holidays (date);

-- Proclamation No. 1006, s. 2025 (2026 holidays), plus Proclamations 1189
-- (Eid'l Fitr) and 1264 (Eid'l Adha). Local: Manila Day (Jun 24, city
-- ordinance), Quezon City Day (Aug 19).
insert into hr.holidays (date, name, kind, scope_city, source) values
  ('2026-01-01', 'New Year''s Day', 'regular', null, 'Proclamation 1006 s.2025'),
  ('2026-02-17', 'Chinese New Year', 'special_non_working', null, 'Proclamation 1006 s.2025'),
  ('2026-02-25', 'EDSA People Power Revolution Anniversary', 'special_working', null, 'Proclamation 1006 s.2025'),
  ('2026-03-20', 'Eid''l Fitr', 'regular', null, 'Proclamation 1189 s.2026'),
  ('2026-04-02', 'Maundy Thursday', 'regular', null, 'Proclamation 1006 s.2025'),
  ('2026-04-03', 'Good Friday', 'regular', null, 'Proclamation 1006 s.2025'),
  ('2026-04-04', 'Black Saturday', 'special_non_working', null, 'Proclamation 1006 s.2025'),
  ('2026-04-09', 'Araw ng Kagitingan', 'regular', null, 'Proclamation 1006 s.2025'),
  ('2026-05-01', 'Labor Day', 'regular', null, 'Proclamation 1006 s.2025'),
  ('2026-05-27', 'Eid''l Adha', 'regular', null, 'Proclamation 1264 s.2026'),
  ('2026-06-12', 'Independence Day', 'regular', null, 'Proclamation 1006 s.2025'),
  ('2026-06-24', 'Manila Day', 'special_non_working', 'Manila', 'City of Manila'),
  ('2026-08-19', 'Quezon City Day', 'special_non_working', 'Quezon City', 'Quezon City'),
  ('2026-08-21', 'Ninoy Aquino Day', 'special_non_working', null, 'Proclamation 1006 s.2025'),
  ('2026-08-31', 'National Heroes Day', 'regular', null, 'Proclamation 1006 s.2025'),
  ('2026-11-01', 'All Saints'' Day', 'special_non_working', null, 'Proclamation 1006 s.2025'),
  ('2026-11-02', 'All Souls'' Day', 'special_non_working', null, 'Proclamation 1006 s.2025'),
  ('2026-11-30', 'Bonifacio Day', 'regular', null, 'Proclamation 1006 s.2025'),
  ('2026-12-08', 'Feast of the Immaculate Conception', 'special_non_working', null, 'Proclamation 1006 s.2025'),
  ('2026-12-24', 'Christmas Eve', 'special_non_working', null, 'Proclamation 1006 s.2025'),
  ('2026-12-25', 'Christmas Day', 'regular', null, 'Proclamation 1006 s.2025'),
  ('2026-12-30', 'Rizal Day', 'regular', null, 'Proclamation 1006 s.2025'),
  ('2026-12-31', 'Last Day of the Year', 'special_non_working', null, 'Proclamation 1006 s.2025');

alter table hr.holidays enable row level security;

create policy "staff read holidays" on hr.holidays
  for select to authenticated
  using (shared.current_staff_role() is not null);

create policy "hr manage holidays" on hr.holidays
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create trigger set_updated_at
  before update on hr.holidays
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.holidays;

-- ---------------------------------------------------------------------------
-- Rate tables (SSS, PhilHealth, Pag-IBIG, withholding tax, minimum wage)
-- ---------------------------------------------------------------------------

create table hr.rate_tables (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('sss', 'philhealth', 'pagibig', 'tax_semi_monthly', 'tax_monthly', 'tax_annual', 'minimum_wage')),
  effective_from date not null,
  effective_to date,
  status text not null default 'in_force' check (status in ('draft', 'in_force', 'enjoined', 'superseded')),
  source text not null,
  params jsonb not null default '{}'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  notes text,
  created_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

create index rate_tables_kind_idx on hr.rate_tables (kind, effective_from desc);

-- SSS Circular 2024-006 (contribution schedule effective January 2025;
-- unchanged for 2026). Generated by lib/utils/statutory.ts
-- buildSssBrackets2025(): 61 brackets, MSC 5,000-35,000 in 500 steps.
insert into hr.rate_tables (kind, effective_from, status, source, params, rows, notes) values
  ('sss', '2025-01-01', 'in_force', 'SSS Circular 2024-006 (RA 11199 s.4(a))',
   '{"regularMscCap": 20000}'::jsonb,
   '[{"from":0,"to":5250,"msc":5000,"ee":250,"er":500,"ec":10,"mpfEe":0,"mpfEr":0},{"from":5250,"to":5750,"msc":5500,"ee":275,"er":550,"ec":10,"mpfEe":0,"mpfEr":0},{"from":5750,"to":6250,"msc":6000,"ee":300,"er":600,"ec":10,"mpfEe":0,"mpfEr":0},{"from":6250,"to":6750,"msc":6500,"ee":325,"er":650,"ec":10,"mpfEe":0,"mpfEr":0},{"from":6750,"to":7250,"msc":7000,"ee":350,"er":700,"ec":10,"mpfEe":0,"mpfEr":0},{"from":7250,"to":7750,"msc":7500,"ee":375,"er":750,"ec":10,"mpfEe":0,"mpfEr":0},{"from":7750,"to":8250,"msc":8000,"ee":400,"er":800,"ec":10,"mpfEe":0,"mpfEr":0},{"from":8250,"to":8750,"msc":8500,"ee":425,"er":850,"ec":10,"mpfEe":0,"mpfEr":0},{"from":8750,"to":9250,"msc":9000,"ee":450,"er":900,"ec":10,"mpfEe":0,"mpfEr":0},{"from":9250,"to":9750,"msc":9500,"ee":475,"er":950,"ec":10,"mpfEe":0,"mpfEr":0},{"from":9750,"to":10250,"msc":10000,"ee":500,"er":1000,"ec":10,"mpfEe":0,"mpfEr":0},{"from":10250,"to":10750,"msc":10500,"ee":525,"er":1050,"ec":10,"mpfEe":0,"mpfEr":0},{"from":10750,"to":11250,"msc":11000,"ee":550,"er":1100,"ec":10,"mpfEe":0,"mpfEr":0},{"from":11250,"to":11750,"msc":11500,"ee":575,"er":1150,"ec":10,"mpfEe":0,"mpfEr":0},{"from":11750,"to":12250,"msc":12000,"ee":600,"er":1200,"ec":10,"mpfEe":0,"mpfEr":0},{"from":12250,"to":12750,"msc":12500,"ee":625,"er":1250,"ec":10,"mpfEe":0,"mpfEr":0},{"from":12750,"to":13250,"msc":13000,"ee":650,"er":1300,"ec":10,"mpfEe":0,"mpfEr":0},{"from":13250,"to":13750,"msc":13500,"ee":675,"er":1350,"ec":10,"mpfEe":0,"mpfEr":0},{"from":13750,"to":14250,"msc":14000,"ee":700,"er":1400,"ec":10,"mpfEe":0,"mpfEr":0},{"from":14250,"to":14750,"msc":14500,"ee":725,"er":1450,"ec":10,"mpfEe":0,"mpfEr":0},{"from":14750,"to":15250,"msc":15000,"ee":750,"er":1500,"ec":30,"mpfEe":0,"mpfEr":0},{"from":15250,"to":15750,"msc":15500,"ee":775,"er":1550,"ec":30,"mpfEe":0,"mpfEr":0},{"from":15750,"to":16250,"msc":16000,"ee":800,"er":1600,"ec":30,"mpfEe":0,"mpfEr":0},{"from":16250,"to":16750,"msc":16500,"ee":825,"er":1650,"ec":30,"mpfEe":0,"mpfEr":0},{"from":16750,"to":17250,"msc":17000,"ee":850,"er":1700,"ec":30,"mpfEe":0,"mpfEr":0},{"from":17250,"to":17750,"msc":17500,"ee":875,"er":1750,"ec":30,"mpfEe":0,"mpfEr":0},{"from":17750,"to":18250,"msc":18000,"ee":900,"er":1800,"ec":30,"mpfEe":0,"mpfEr":0},{"from":18250,"to":18750,"msc":18500,"ee":925,"er":1850,"ec":30,"mpfEe":0,"mpfEr":0},{"from":18750,"to":19250,"msc":19000,"ee":950,"er":1900,"ec":30,"mpfEe":0,"mpfEr":0},{"from":19250,"to":19750,"msc":19500,"ee":975,"er":1950,"ec":30,"mpfEe":0,"mpfEr":0},{"from":19750,"to":20250,"msc":20000,"ee":1000,"er":2000,"ec":30,"mpfEe":0,"mpfEr":0},{"from":20250,"to":20750,"msc":20500,"ee":1000,"er":2000,"ec":30,"mpfEe":25,"mpfEr":50},{"from":20750,"to":21250,"msc":21000,"ee":1000,"er":2000,"ec":30,"mpfEe":50,"mpfEr":100},{"from":21250,"to":21750,"msc":21500,"ee":1000,"er":2000,"ec":30,"mpfEe":75,"mpfEr":150},{"from":21750,"to":22250,"msc":22000,"ee":1000,"er":2000,"ec":30,"mpfEe":100,"mpfEr":200},{"from":22250,"to":22750,"msc":22500,"ee":1000,"er":2000,"ec":30,"mpfEe":125,"mpfEr":250},{"from":22750,"to":23250,"msc":23000,"ee":1000,"er":2000,"ec":30,"mpfEe":150,"mpfEr":300},{"from":23250,"to":23750,"msc":23500,"ee":1000,"er":2000,"ec":30,"mpfEe":175,"mpfEr":350},{"from":23750,"to":24250,"msc":24000,"ee":1000,"er":2000,"ec":30,"mpfEe":200,"mpfEr":400},{"from":24250,"to":24750,"msc":24500,"ee":1000,"er":2000,"ec":30,"mpfEe":225,"mpfEr":450},{"from":24750,"to":25250,"msc":25000,"ee":1000,"er":2000,"ec":30,"mpfEe":250,"mpfEr":500},{"from":25250,"to":25750,"msc":25500,"ee":1000,"er":2000,"ec":30,"mpfEe":275,"mpfEr":550},{"from":25750,"to":26250,"msc":26000,"ee":1000,"er":2000,"ec":30,"mpfEe":300,"mpfEr":600},{"from":26250,"to":26750,"msc":26500,"ee":1000,"er":2000,"ec":30,"mpfEe":325,"mpfEr":650},{"from":26750,"to":27250,"msc":27000,"ee":1000,"er":2000,"ec":30,"mpfEe":350,"mpfEr":700},{"from":27250,"to":27750,"msc":27500,"ee":1000,"er":2000,"ec":30,"mpfEe":375,"mpfEr":750},{"from":27750,"to":28250,"msc":28000,"ee":1000,"er":2000,"ec":30,"mpfEe":400,"mpfEr":800},{"from":28250,"to":28750,"msc":28500,"ee":1000,"er":2000,"ec":30,"mpfEe":425,"mpfEr":850},{"from":28750,"to":29250,"msc":29000,"ee":1000,"er":2000,"ec":30,"mpfEe":450,"mpfEr":900},{"from":29250,"to":29750,"msc":29500,"ee":1000,"er":2000,"ec":30,"mpfEe":475,"mpfEr":950},{"from":29750,"to":30250,"msc":30000,"ee":1000,"er":2000,"ec":30,"mpfEe":500,"mpfEr":1000},{"from":30250,"to":30750,"msc":30500,"ee":1000,"er":2000,"ec":30,"mpfEe":525,"mpfEr":1050},{"from":30750,"to":31250,"msc":31000,"ee":1000,"er":2000,"ec":30,"mpfEe":550,"mpfEr":1100},{"from":31250,"to":31750,"msc":31500,"ee":1000,"er":2000,"ec":30,"mpfEe":575,"mpfEr":1150},{"from":31750,"to":32250,"msc":32000,"ee":1000,"er":2000,"ec":30,"mpfEe":600,"mpfEr":1200},{"from":32250,"to":32750,"msc":32500,"ee":1000,"er":2000,"ec":30,"mpfEe":625,"mpfEr":1250},{"from":32750,"to":33250,"msc":33000,"ee":1000,"er":2000,"ec":30,"mpfEe":650,"mpfEr":1300},{"from":33250,"to":33750,"msc":33500,"ee":1000,"er":2000,"ec":30,"mpfEe":675,"mpfEr":1350},{"from":33750,"to":34250,"msc":34000,"ee":1000,"er":2000,"ec":30,"mpfEe":700,"mpfEr":1400},{"from":34250,"to":34750,"msc":34500,"ee":1000,"er":2000,"ec":30,"mpfEe":725,"mpfEr":1450},{"from":34750,"to":null,"msc":35000,"ee":1000,"er":2000,"ec":30,"mpfEe":750,"mpfEr":1500}]'::jsonb,
   'ER 10% / EE 5% of MSC; MPF (WISP) above MSC 20,000; EC P10 up to MSC 14,500, P30 from 15,000.');

insert into hr.rate_tables (kind, effective_from, status, source, params, rows, notes) values
  ('philhealth', '2024-01-01', 'in_force', 'RA 11223 s.10 (Universal Health Care Act); PhilHealth Circular 2019-0009',
   '{"rate": 0.05, "floor": 10000, "ceiling": 100000}'::jsonb, '[]'::jsonb,
   '5% of basic monthly salary, shared equally; floor P10,000, ceiling P100,000.'),
  ('pagibig', '2024-02-01', 'in_force', 'RA 9679; HDMF Circular 460',
   '{"eeRateLow": 0.01, "lowThreshold": 1500, "eeRate": 0.02, "erRate": 0.02, "maxFundSalary": 10000}'::jsonb, '[]'::jsonb,
   'Employee 1% (P1,500 and below) or 2%, employer 2%, on a maximum fund salary of P10,000.'),
  ('tax_semi_monthly', '2023-01-01', 'in_force', 'RR 11-2018 Annex E (TRAIN, RA 10963), 2023 onward', '{}'::jsonb,
   '[{"over":0,"base":0,"rate":0},{"over":10417,"base":0,"rate":0.15},{"over":16667,"base":937.5,"rate":0.2},{"over":33333,"base":4270.7,"rate":0.25},{"over":83333,"base":16770.7,"rate":0.3},{"over":333333,"base":91770.7,"rate":0.35}]'::jsonb,
   'Tax = base + rate x (taxable - over).'),
  ('tax_monthly', '2023-01-01', 'in_force', 'RR 11-2018 Annex E (TRAIN, RA 10963), 2023 onward', '{}'::jsonb,
   '[{"over":0,"base":0,"rate":0},{"over":20833,"base":0,"rate":0.15},{"over":33333,"base":1875,"rate":0.2},{"over":66667,"base":8541.8,"rate":0.25},{"over":166667,"base":33541.8,"rate":0.3},{"over":666667,"base":183541.8,"rate":0.35}]'::jsonb,
   null),
  ('tax_annual', '2023-01-01', 'in_force', 'NIRC s.24(A)(2)(a) as amended by TRAIN, 2023 onward', '{}'::jsonb,
   '[{"over":0,"base":0,"rate":0},{"over":250000,"base":0,"rate":0.15},{"over":400000,"base":22500,"rate":0.2},{"over":800000,"base":102500,"rate":0.25},{"over":2000000,"base":402500,"rate":0.3},{"over":8000000,"base":2202500,"rate":0.35}]'::jsonb,
   'Used for the December annualisation and BIR 2316.'),
  ('minimum_wage', '2025-07-18', 'in_force', 'Wage Order No. NCR-26', '{}'::jsonb,
   '[{"region":"NCR","sector":"non_agri","rate":695,"wageOrder":"NCR-26"},{"region":"NCR","sector":"agri","rate":658,"wageOrder":"NCR-26"}]'::jsonb,
   'P695 non-agriculture; P658 agriculture, service and retail with up to 15 workers, manufacturing with fewer than 10.'),
  ('minimum_wage', '2026-07-25', 'enjoined', 'Wage Order No. NCR-27 (first tranche)', '{}'::jsonb,
   '[{"region":"NCR","sector":"non_agri","rate":755,"wageOrder":"NCR-27"},{"region":"NCR","sector":"agri","rate":718,"wageOrder":"NCR-27"}]'::jsonb,
   'Stayed by a Pasig RTC preliminary injunction (13 Aug 2026). Set to in_force if the injunction is lifted; a wage differential then falls due from 25 Jul 2026.'),
  ('minimum_wage', '2027-01-20', 'enjoined', 'Wage Order No. NCR-27 (second tranche)', '{}'::jsonb,
   '[{"region":"NCR","sector":"non_agri","rate":780,"wageOrder":"NCR-27"},{"region":"NCR","sector":"agri","rate":743,"wageOrder":"NCR-27"}]'::jsonb,
   'Second tranche of NCR-27; same injunction.');

alter table hr.rate_tables enable row level security;

create policy "staff read rate tables" on hr.rate_tables
  for select to authenticated
  using (shared.current_staff_role() is not null);

create policy "hr manage rate tables" on hr.rate_tables
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create trigger set_updated_at
  before update on hr.rate_tables
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.rate_tables;

-- ---------------------------------------------------------------------------
-- Leave types
-- ---------------------------------------------------------------------------

create table hr.leave_types (
  id text primary key,
  name text not null,
  statutory boolean not null default false,
  paid boolean not null default true,
  -- Where the yearly entitlement comes from: the VL/SL numbers in Settings
  -- (0038), or a fixed number of days the law states.
  entitlement_source text not null check (entitlement_source in ('settings_vl', 'settings_sl', 'fixed')),
  days_default numeric(5, 2),
  -- {minServiceMonths, sex, civilStatus, maxOccurrences, perEvent}
  eligibility jsonb not null default '{}'::jsonb,
  requires_document boolean not null default false,
  law_ref text,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into hr.leave_types (id, name, statutory, paid, entitlement_source, days_default, eligibility, requires_document, law_ref, active, sort) values
  ('vl', 'Vacation leave', false, true, 'settings_vl', null, '{}'::jsonb, false,
   'Company benefit. Five or more days a year discharges the Service Incentive Leave (Labor Code Art. 95(b)).', true, 1),
  ('sl', 'Sick leave', false, true, 'settings_sl', null, '{}'::jsonb, false,
   'Company benefit.', true, 2),
  ('sil', 'Service incentive leave', true, true, 'fixed', 5, '{"minServiceMonths": 12}'::jsonb, false,
   'Labor Code Art. 95: 5 days after one year of service; employers of fewer than 10 are exempt; discharged by vacation leave of at least 5 days.', false, 3),
  ('maternity', 'Maternity leave', true, true, 'fixed', 105, '{"sex": "female", "perEvent": true}'::jsonb, true,
   'RA 11210: 105 days (plus 15 for a solo parent, up to 30 more unpaid), 60 days for miscarriage or emergency termination; SSS benefit with the employer paying the salary differential unless exempted.', true, 4),
  ('paternity', 'Paternity leave', true, true, 'fixed', 7, '{"sex": "male", "civilStatus": "married", "maxOccurrences": 4, "perEvent": true}'::jsonb, true,
   'RA 8187: 7 days for the first four deliveries of the lawful wife.', true, 5),
  ('solo_parent', 'Solo parent leave', true, true, 'fixed', 7, '{"minServiceMonths": 6}'::jsonb, true,
   'RA 8972 as amended by RA 11861: 7 days a year after six months of service; needs a Solo Parent ID; not convertible to cash.', true, 6),
  ('vawc', 'VAWC leave', true, true, 'fixed', 10, '{"sex": "female", "perEvent": true}'::jsonb, true,
   'RA 9262 s.43: up to 10 days, extendible, on a barangay or court protection order.', true, 7),
  ('mcw_special', 'Special leave for women', true, true, 'fixed', 60, '{"sex": "female", "minServiceMonths": 6, "perEvent": true}'::jsonb, true,
   'RA 9710 s.18: up to two months with full pay after surgery for a gynaecological disorder, after six months'' service in the last twelve.', true, 8),
  ('lwop', 'Leave without pay', false, false, 'fixed', null, '{}'::jsonb, false,
   'Unpaid absence with permission; no entitlement.', true, 9);

alter table hr.leave_types enable row level security;

create policy "staff read leave types" on hr.leave_types
  for select to authenticated
  using (shared.current_staff_role() is not null);

create policy "hr manage leave types" on hr.leave_types
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create trigger set_updated_at
  before update on hr.leave_types
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.leave_types;
