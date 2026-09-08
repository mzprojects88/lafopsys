-- Payroll: the money side of the HR module.
--
-- hr.pay_items: what a payslip carries besides salary and the statutory
-- lines -- a one-off taxable allowance, a salary advance being repaid, an
-- SSS or Pag-IBIG loan amortisation, retro pay. A deduction must carry the
-- date the person authorised it in writing (Labor Code Arts. 113-116:
-- nothing comes off wages without the worker's written authorisation or a
-- law that says so). Loan balances are never decremented at compute time;
-- the balance is amount_total minus what approved payslips already
-- applied, so recomputing a draft run can never double-count.
--
-- hr.payroll_runs: one computation of a period (kind regular), or a 13th
-- month, final pay or adjustment run. Status draft -> computed -> approved
-- -> paid -> closed, or cancelled. Compute and approve must be two people
-- (the segregation trigger); a single-admin foundation can pass with a
-- logged waiver. rate_snapshot records which hr.rate_tables versions were
-- used, so a payslip can always be explained even after the tables change.
--
-- hr.payslips: one per employee per run, the engine's lines plus the
-- statutory amounts as real columns so the SSS/PhilHealth/Pag-IBIG lists,
-- 1601-C and 13th month aggregate in SQL. Append-only money: HR may
-- rewrite a payslip only while the run is draft or computed; once
-- approved, only the acknowledgement and the bank link may change, and
-- nothing is ever deleted. An employee reads their own and may only set
-- acknowledged_at. period_id and pay_date are denormalised because an
-- employee cannot read payroll_runs.
--
-- hr.ytd_openings: the year's figures paid before the system went live
-- (January to August 2026 were paid from a spreadsheet), so December
-- annualisation, the 90,000 ceiling and the 2316 see the whole year.
--
-- Paid runs write nothing to ops.cash_entries: the bank statement (0033)
-- is the cleared money the finance summary already counts. A payslip is
-- linked to its bank row when that statement is imported (P4).

-- ---------------------------------------------------------------------------
-- hr.pay_items
-- ---------------------------------------------------------------------------

create table hr.pay_items (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  kind text not null check (kind in ('earning', 'deduction')),
  code text not null check (code in ('allowance_taxable', 'de_minimis', 'salary_advance', 'sss_loan', 'pagibig_loan', 'retro', 'other_earning', 'other_authorized')),
  label text not null,
  -- Per cutoff when recurring; the whole amount when one-off.
  amount numeric(12, 2) not null check (amount > 0),
  -- One-off: the period it lands in. Recurring: null, applied every
  -- cutoff from starts_on until ends_on or the balance is exhausted.
  period_id uuid references hr.pay_periods (id),
  is_recurring boolean not null default false,
  starts_on date,
  ends_on date,
  -- A running balance (loan principal, advance): null when not tracked.
  amount_total numeric(12, 2) check (amount_total is null or amount_total > 0),
  authorized_on date,
  reference text,
  de_minimis_kind text,
  notes text,
  active boolean not null default true,
  created_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_recurring and period_id is null) or (not is_recurring and period_id is not null)),
  check (kind = 'earning' or authorized_on is not null),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index pay_items_employee_idx on hr.pay_items (employee_id) where active;
create index pay_items_period_idx on hr.pay_items (period_id) where period_id is not null;

alter table hr.pay_items enable row level security;

create policy "hr manage pay items" on hr.pay_items
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create policy "own pay items" on hr.pay_items
  for select to authenticated
  using (employee_id = hr.current_employee_id());

create trigger set_updated_at
  before update on hr.pay_items
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.pay_items;

-- ---------------------------------------------------------------------------
-- hr.payroll_runs
-- ---------------------------------------------------------------------------

create table hr.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'regular' check (kind in ('regular', 'thirteenth_month', 'final_pay', 'adjustment')),
  period_id uuid references hr.pay_periods (id),
  year integer not null check (year between 2020 and 2100),
  -- Final pay is for one person.
  employee_id uuid references hr.employees (id),
  status text not null default 'draft'
    check (status in ('draft', 'computed', 'approved', 'paid', 'closed', 'cancelled')),
  label text,
  computed_by uuid references shared.staff (id),
  computed_at timestamptz,
  approved_by uuid references shared.staff (id),
  approved_at timestamptz,
  paid_on date,
  paid_by uuid references shared.staff (id),
  paid_reference text,
  -- Register totals (lib/utils/payroll.ts registerTotals), pesos, plus
  -- who was skipped and why.
  totals jsonb not null default '{}'::jsonb,
  -- [{kind, id, effectiveFrom, status}] of the hr.rate_tables rows used.
  rate_snapshot jsonb not null default '[]'::jsonb,
  segregation_waiver text,
  cancel_reason text,
  notes text,
  created_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'regular' or period_id is not null),
  check (kind <> 'final_pay' or employee_id is not null),
  check ((status in ('approved', 'paid', 'closed')) = (approved_at is not null)),
  check ((status in ('paid', 'closed')) = (paid_on is not null))
);

-- One live regular run per period.
create unique index payroll_runs_one_live_regular on hr.payroll_runs (period_id)
  where kind = 'regular' and status <> 'cancelled';
create index payroll_runs_year_idx on hr.payroll_runs (year, kind);

alter table hr.payroll_runs enable row level security;

create policy "hr manage payroll runs" on hr.payroll_runs
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

-- Compute and approve are two people, unless a waiver says why not: the
-- foundation has two admins, and one of them is on the payroll.
create or replace function hr.guard_payroll_run_update()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if new.approved_by is null then
      raise exception 'An approval must record who approved' using errcode = '23514';
    end if;
    if new.approved_by is not distinct from new.computed_by and coalesce(new.segregation_waiver, '') = '' then
      raise exception 'The person who computed a run cannot approve it without a logged waiver'
        using errcode = '42501';
    end if;
  end if;
  -- Once approved, the run only moves forward; its figures are fixed.
  if old.status in ('approved', 'paid', 'closed') then
    if new.totals is distinct from old.totals
       or new.rate_snapshot is distinct from old.rate_snapshot
       or new.computed_by is distinct from old.computed_by
       or new.computed_at is distinct from old.computed_at
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.period_id is distinct from old.period_id
       or new.kind is distinct from old.kind then
      raise exception 'An approved run cannot be recomputed; issue an adjustment run' using errcode = '42501';
    end if;
    if new.status = 'cancelled' or new.status = 'draft' or new.status = 'computed' then
      raise exception 'An approved run cannot go back; issue an adjustment run' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_payroll_run_update
  before update on hr.payroll_runs
  for each row execute function hr.guard_payroll_run_update();

create trigger set_updated_at
  before update on hr.payroll_runs
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.payroll_runs;

-- ---------------------------------------------------------------------------
-- hr.payslips
-- ---------------------------------------------------------------------------

create table hr.payslips (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references hr.payroll_runs (id) on delete cascade,
  employee_id uuid not null references hr.employees (id),
  period_id uuid references hr.pay_periods (id),
  pay_date date not null,
  compensation_id uuid references hr.compensation (id),
  pay_basis text not null check (pay_basis in ('monthly', 'daily')),
  -- PayLine[] from lib/utils/payroll.ts, amounts in centavos.
  lines jsonb not null default '[]'::jsonb,
  basic_earned numeric(12, 2) not null default 0,
  gross numeric(12, 2) not null default 0,
  taxable_gross numeric(12, 2) not null default 0,
  non_taxable numeric(12, 2) not null default 0,
  taxable_income numeric(12, 2) not null default 0,
  total_deductions numeric(12, 2) not null default 0,
  net numeric(12, 2) not null default 0,
  tax_withheld numeric(12, 2) not null default 0,
  sss_ee numeric(12, 2) not null default 0,
  sss_er numeric(12, 2) not null default 0,
  ec numeric(12, 2) not null default 0,
  mpf_ee numeric(12, 2) not null default 0,
  mpf_er numeric(12, 2) not null default 0,
  philhealth_ee numeric(12, 2) not null default 0,
  philhealth_er numeric(12, 2) not null default 0,
  pagibig_ee numeric(12, 2) not null default 0,
  pagibig_er numeric(12, 2) not null default 0,
  employer_total numeric(12, 2) not null default 0,
  -- YearToDate before this payslip, pesos (what the engine was given).
  ytd jsonb not null default '{}'::jsonb,
  warnings text[] not null default '{}',
  acknowledged_at timestamptz,
  bank_transaction_id uuid references ops.bank_transactions (id),
  paid_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, employee_id),
  check (net = gross - total_deductions)
);

create index payslips_employee_idx on hr.payslips (employee_id, pay_date desc);
create index payslips_period_idx on hr.payslips (period_id);

alter table hr.payslips enable row level security;

create policy "hr read payslips" on hr.payslips
  for select to authenticated
  using (hr.is_hr_staff());

create policy "hr insert payslips" on hr.payslips
  for insert to authenticated
  with check (hr.is_hr_staff());

create policy "hr update payslips" on hr.payslips
  for update to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

-- Append-only money: a payslip goes only while its run is still being
-- computed. Nobody deletes an approved one.
create policy "hr delete draft payslips" on hr.payslips
  for delete to authenticated
  using (
    hr.is_hr_staff()
    and exists (select 1 from hr.payroll_runs r where r.id = run_id and r.status in ('draft', 'computed'))
  );

-- Whether a run's figures are final. A definer function because the
-- employee cannot read hr.payroll_runs, and a policy's subquery would run
-- under that same RLS.
create or replace function hr.run_is_settled(run uuid)
returns boolean
language sql
stable
security definer
set search_path = hr, pg_temp
as $$
  select exists (select 1 from hr.payroll_runs r where r.id = run and r.status in ('approved', 'paid', 'closed'));
$$;

revoke all on function hr.run_is_settled(uuid) from public;
grant execute on function hr.run_is_settled(uuid) to authenticated, service_role;

-- An employee sees their own payslip once it is final -- never a draft
-- that may still change.
create policy "own payslips" on hr.payslips
  for select to authenticated
  using (employee_id = hr.current_employee_id() and hr.run_is_settled(run_id));

-- The one thing an employee writes: that they have seen it. The trigger
-- below is what limits the update to that column.
create policy "own payslip acknowledge" on hr.payslips
  for update to authenticated
  using (employee_id = hr.current_employee_id())
  with check (employee_id = hr.current_employee_id());

create or replace function hr.guard_payslip_write()
returns trigger
language plpgsql
as $$
declare
  run_status text;
  changed jsonb;
begin
  select status into run_status from hr.payroll_runs where id = new.run_id;
  if tg_op = 'INSERT' then
    if run_status not in ('draft', 'computed') then
      raise exception 'Payslips can only be added while the run is being computed' using errcode = '42501';
    end if;
    return new;
  end if;
  -- What changed, ignoring the columns anyone may touch. A signed-in
  -- non-HR person is the employee; a connection without a JWT (a script
  -- run by an admin on the database) is treated as HR and still meets
  -- the approved-run lock below.
  changed := (to_jsonb(new) - 'acknowledged_at' - 'updated_at');
  if auth.uid() is not null and not hr.is_hr_staff() then
    if changed is distinct from (to_jsonb(old) - 'acknowledged_at' - 'updated_at') then
      raise exception 'You can only acknowledge your payslip' using errcode = '42501';
    end if;
    return new;
  end if;
  if run_status in ('approved', 'paid', 'closed') then
    changed := changed - 'bank_transaction_id' - 'paid_reference';
    if changed is distinct from (to_jsonb(old) - 'acknowledged_at' - 'updated_at' - 'bank_transaction_id' - 'paid_reference') then
      raise exception 'An approved payslip cannot be changed; issue an adjustment run' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_payslip_write
  before insert or update on hr.payslips
  for each row execute function hr.guard_payslip_write();

create trigger set_updated_at
  before update on hr.payslips
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.payslips;

-- ---------------------------------------------------------------------------
-- hr.ytd_openings
-- ---------------------------------------------------------------------------

create table hr.ytd_openings (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  year integer not null check (year between 2020 and 2100),
  -- Figures cover January 1 up to and including this date.
  as_of date not null,
  basic_earned numeric(12, 2) not null default 0,
  taxable_income numeric(12, 2) not null default 0,
  non_taxable numeric(12, 2) not null default 0,
  tax_withheld numeric(12, 2) not null default 0,
  sss_ee numeric(12, 2) not null default 0,
  philhealth_ee numeric(12, 2) not null default 0,
  pagibig_ee numeric(12, 2) not null default 0,
  thirteenth_month_paid numeric(12, 2) not null default 0,
  source text,
  created_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, year)
);

alter table hr.ytd_openings enable row level security;

create policy "hr manage ytd openings" on hr.ytd_openings
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create policy "own ytd openings" on hr.ytd_openings
  for select to authenticated
  using (employee_id = hr.current_employee_id());

create trigger set_updated_at
  before update on hr.ytd_openings
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.ytd_openings;
