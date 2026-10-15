-- 0098: NCH Cancer Assistance Fund billing (user, 2026-10-15).
--
-- Each month LAF bills National Children's Hospital for the nights CAF children stayed: a Billing
-- Statement, and per child a Statement of Account and an Endorsement Letter. The rules, from the
-- September 2026 package (P188,000): one night = one stay; at most 15 billable stays per child per
-- month -- the first 15 nights; P1,000 per stay; 20% off for a PWD.
--
--   1. ops.patients: pwd, pwd_id_no, caf_billing (on for every cancer patient, changeable).
--   2. shared.app_settings.caf: rate, cap, discount, payer, bank, signatories, NCH letterhead --
--      management figures live in Settings, never in code.
--   3. ops.caf_billings (one per month: draft -> final -> sent -> paid) and ops.caf_billing_lines
--      (the child, the nights, PWD as it was). Amounts are computed from these, never stored.
--      Written only through the functions below; a final bill can't change, only the Super
--      Admin reopens it, with a reason.
--   4. Powers: "Prepares NCH billing" (caf_billing: social worker, Office Admin) and "Sees NCH
--      billing" (caf_billing_view: also the CEO). The Super Admin always has both. Partners never.

-- ---- 1. who is billed ----
alter table ops.patients
  add column if not exists pwd boolean not null default false,
  add column if not exists pwd_id_no text check (pwd_id_no is null or char_length(pwd_id_no) <= 40),
  add column if not exists caf_billing boolean not null default false;
comment on column ops.patients.caf_billing is 'Billed to NCH''s Cancer Assistance Fund (0098); on for cancer patients, changeable.';
update ops.patients set caf_billing = true where illness_code = 'C' and not caf_billing;
grant select, insert, update (pwd, pwd_id_no, caf_billing) on ops.patients to authenticated;

create or replace function ops.default_caf_billing()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.illness_code = 'C' then
    new.caf_billing := true;
  elsif tg_op = 'UPDATE' and new.illness_code = 'C' and old.illness_code is distinct from 'C' and new.caf_billing = old.caf_billing then
    new.caf_billing := true;
  end if;
  return new;
end;
$$;
drop trigger if exists default_caf_billing on ops.patients;
create trigger default_caf_billing before insert or update of illness_code on ops.patients
  for each row execute function ops.default_caf_billing();

-- ---- 2. the figures and the letterheads ----
alter table shared.app_settings add column if not exists caf jsonb not null default jsonb_build_object(
  'rate', 1000,
  'cap', 15,
  'discount_pct', 20,
  'program', 'Transient House Cancer Assistance Fund',
  'payer_name', 'NATIONAL CHILDREN''S HOSPITAL',
  'payer_address', 'E. Rodriguez, Sr. Ave., Q. C.',
  'bank_name', 'BDO',
  'bank_account_name', 'LITTLE ARK FOUNDATION INC.',
  'bank_account_no', '008838006247',
  'bank_account_type', 'Savings',
  'prepared_by', null,
  'approved_by', null,
  'nch_letterhead', jsonb_build_array(
    'Republic of the Philippines', 'Department of Health', 'National Children''s Hospital',
    'CANCER ASSISTANCE FUND PROGRAM', '264 E. Rodriguez Sr. Ave. Damayang Lagi, Quezon City',
    'Telephone Nos. +63 8720656 to 59 Loc. 152', 'e-mail: cspmap@nch.doh.gov.ph')
);

-- ---- 3. bills and their lines ----
create table if not exists ops.caf_billings (
  id uuid primary key default gen_random_uuid(),
  month date not null unique check (extract(day from month) = 1),
  status text not null default 'draft' check (status in ('draft', 'final', 'sent', 'paid')),
  rate numeric(12, 2) not null check (rate >= 0),
  cap integer not null check (cap between 1 and 31),
  discount_pct numeric(5, 2) not null check (discount_pct between 0 and 100),
  invoice_date date,
  finalised_by uuid references shared.staff (id),
  finalised_at timestamptz,
  sent_at timestamptz,
  paid_on date,
  paid_ref text check (paid_ref is null or char_length(paid_ref) <= 80),
  reopen_reason text,
  created_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists ops.caf_billing_lines (
  id uuid primary key default gen_random_uuid(),
  billing_id uuid not null references ops.caf_billings (id) on delete cascade,
  patient_id uuid not null references ops.patients (id),
  nights date[] not null default '{}',
  pwd boolean not null default false,
  -- Set when someone added or removed a night by hand; such a line keeps its nights on refresh.
  manual_reason text check (manual_reason is null or char_length(manual_reason) <= 200),
  changed_by uuid references shared.staff (id),
  changed_at timestamptz not null default now(),
  unique (billing_id, patient_id)
);
create index if not exists caf_billing_lines_billing_idx on ops.caf_billing_lines (billing_id);

-- ---- 4. powers ----
alter table shared.role_powers drop constraint if exists role_powers_power_check;
alter table shared.role_powers add constraint role_powers_power_check
  check (power in ('runs_hr', 'finance_work', 'bed_exception', 'floor_plan_layout', 'driver', 'clinical_detail', 'caf_billing', 'caf_billing_view'));
insert into shared.role_powers (role, power) values
  ('social_worker', 'caf_billing'), ('office_admin', 'caf_billing'),
  ('social_worker', 'caf_billing_view'), ('office_admin', 'caf_billing_view'), ('ceo', 'caf_billing_view')
on conflict do nothing;

alter table ops.caf_billings enable row level security;
alter table ops.caf_billing_lines enable row level security;
drop policy if exists "billing readers" on ops.caf_billings;
create policy "billing readers" on ops.caf_billings for select to authenticated
  using ((select shared.has_power('caf_billing')) or (select shared.has_power('caf_billing_view')));
drop policy if exists "billing readers" on ops.caf_billing_lines;
create policy "billing readers" on ops.caf_billing_lines for select to authenticated
  using ((select shared.has_power('caf_billing')) or (select shared.has_power('caf_billing_view')));
revoke all on ops.caf_billings, ops.caf_billing_lines from anon, authenticated;
grant select on ops.caf_billings, ops.caf_billing_lines to authenticated;

-- ---- the steps ----
create or replace function ops.caf_require(p_power text) returns void
language plpgsql stable security definer set search_path = ops, shared, pg_temp as $$
begin
  if not shared.has_power(p_power) then
    raise exception 'NCH billing is prepared by the social worker or the Office Admin' using errcode = '42501';
  end if;
end;
$$;
revoke all on function ops.caf_require(text) from public;

-- The month's draft: made, or refreshed from the nights at LAF. Lines changed by hand keep their nights.
create or replace function ops.caf_draft(p_month date)
returns uuid
language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_caf jsonb := (select caf from shared.app_settings where id = true);
  v_bill ops.caf_billings%rowtype;
begin
  perform ops.caf_require('caf_billing');
  if p_month is null then
    raise exception 'Choose the month' using errcode = '22023';
  end if;
  select * into v_bill from ops.caf_billings where month = v_month for update;
  if v_bill.id is not null and v_bill.status <> 'draft' then
    raise exception 'This month''s bill is final; the Super Admin can reopen it' using errcode = '42501';
  end if;
  if v_bill.id is null then
    insert into ops.caf_billings (month, rate, cap, discount_pct, created_by)
    values (v_month, (v_caf->>'rate')::numeric, (v_caf->>'cap')::int, (v_caf->>'discount_pct')::numeric, auth.uid())
    returning * into v_bill;
  else
    -- A draft follows today's figures.
    update ops.caf_billings set rate = (v_caf->>'rate')::numeric, cap = (v_caf->>'cap')::int,
           discount_pct = (v_caf->>'discount_pct')::numeric, updated_at = now()
     where id = v_bill.id;
  end if;

  delete from ops.caf_billing_lines where billing_id = v_bill.id and manual_reason is null;
  insert into ops.caf_billing_lines (billing_id, patient_id, nights, pwd, changed_by)
  select v_bill.id, s.patient_id, array_agg(distinct bn.night order by bn.night), bool_or(p.pwd), auth.uid()
    from ops.bed_nights bn
    join ops.stays s on s.id = bn.stay_id
    join ops.patients p on p.id = s.patient_id
   where bn.night between v_month and v_end and p.caf_billing
   group by s.patient_id
  on conflict (billing_id, patient_id) do nothing;
  -- PWD as the record says today, for every line of a draft.
  update ops.caf_billing_lines l set pwd = p.pwd from ops.patients p where l.billing_id = v_bill.id and p.id = l.patient_id;
  return v_bill.id;
end;
$$;

-- A child's nights set by hand, with the reason (e.g. nights before the app was used).
create or replace function ops.caf_set_nights(p_billing_id uuid, p_patient_id uuid, p_nights date[], p_reason text)
returns void
language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  v_bill ops.caf_billings%rowtype;
  v_nights date[] := (select coalesce(array_agg(distinct n order by n), '{}') from unnest(coalesce(p_nights, '{}')) n);
begin
  perform ops.caf_require('caf_billing');
  select * into v_bill from ops.caf_billings where id = p_billing_id for update;
  if v_bill.id is null then
    raise exception 'No such bill' using errcode = 'P0002';
  end if;
  if v_bill.status <> 'draft' then
    raise exception 'This month''s bill is final; the Super Admin can reopen it' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why the nights changed' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_nights) n where n < v_bill.month or n >= (v_bill.month + interval '1 month')::date) then
    raise exception 'Every night must be in the bill''s month' using errcode = '22023';
  end if;
  if not exists (select 1 from ops.patients where id = p_patient_id) then
    raise exception 'No such patient' using errcode = 'P0002';
  end if;
  if cardinality(v_nights) = 0 then
    delete from ops.caf_billing_lines where billing_id = p_billing_id and patient_id = p_patient_id;
    return;
  end if;
  insert into ops.caf_billing_lines (billing_id, patient_id, nights, pwd, manual_reason, changed_by, changed_at)
  values (p_billing_id, p_patient_id, v_nights, (select pwd from ops.patients where id = p_patient_id), btrim(p_reason), auth.uid(), now())
  on conflict (billing_id, patient_id) do update
    set nights = excluded.nights, manual_reason = excluded.manual_reason, changed_by = excluded.changed_by, changed_at = excluded.changed_at;
end;
$$;

-- draft -> final -> sent -> paid. Final locks the numbers.
create or replace function ops.caf_set_status(p_billing_id uuid, p_status text, p_date date default null, p_ref text default null)
returns void
language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  v_bill ops.caf_billings%rowtype;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  perform ops.caf_require('caf_billing');
  select * into v_bill from ops.caf_billings where id = p_billing_id for update;
  if v_bill.id is null then
    raise exception 'No such bill' using errcode = 'P0002';
  end if;
  if (v_bill.status, p_status) not in (('draft', 'final'), ('final', 'sent'), ('sent', 'paid')) then
    raise exception 'A bill goes draft, final, sent, paid -- one step at a time' using errcode = '22023';
  end if;
  if p_status = 'final' and not exists (select 1 from ops.caf_billing_lines where billing_id = p_billing_id) then
    raise exception 'The bill has no child on it' using errcode = '22023';
  end if;
  update ops.caf_billings set
    status = p_status,
    invoice_date = case when p_status = 'final' then coalesce(p_date, v_today) else invoice_date end,
    finalised_by = case when p_status = 'final' then auth.uid() else finalised_by end,
    finalised_at = case when p_status = 'final' then now() else finalised_at end,
    sent_at = case when p_status = 'sent' then now() else sent_at end,
    paid_on = case when p_status = 'paid' then coalesce(p_date, v_today) else paid_on end,
    paid_ref = case when p_status = 'paid' then nullif(btrim(p_ref), '') else paid_ref end,
    updated_at = now()
  where id = p_billing_id;
end;
$$;

-- Only the Super Admin takes a bill back to draft, on the record.
create or replace function ops.caf_reopen(p_billing_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ops, shared, pg_temp as $$
begin
  if not shared.has_role('admin') then
    raise exception 'Only the Super Admin reopens a bill' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why the bill is reopened' using errcode = '22023';
  end if;
  update ops.caf_billings set status = 'draft', reopen_reason = btrim(p_reason), sent_at = null, paid_on = null, paid_ref = null, updated_at = now()
   where id = p_billing_id and status <> 'draft';
  if not found then
    raise exception 'No such bill, or it is already a draft' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function ops.caf_draft(date), ops.caf_set_nights(uuid, uuid, date[], text), ops.caf_set_status(uuid, text, date, text), ops.caf_reopen(uuid, text) from public;
grant execute on function ops.caf_draft(date), ops.caf_set_nights(uuid, uuid, date[], text), ops.caf_set_status(uuid, text, date, text), ops.caf_reopen(uuid, text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table ops.caf_billings;
  alter publication supabase_realtime add table ops.caf_billing_lines;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
