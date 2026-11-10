-- 0134 Voucher System, phase 2: payment requests and vouchers (decided 10-11 Nov 2026).
--
-- One record carries a payment from the staff member's request (Step 1) to the approved voucher:
--   draft -> submitted -> endorsed -> prepared -> reviewed -> approved, or returned / rejected / cancelled.
-- The requester files it (REQ-YYYY-NNNN); the supervisor endorses it; Finance checks it, codes it and gives it
-- its voucher number (PV / PCV / GCV-YYYY-NNNN); the reviewer reviews it; the approver approves it. Who signs
-- each step, for which amounts, is the approval authority set in Financial Settings (0133); nobody signs a step
-- of their own request, and the preparer, the reviewer and the approver are three different people.
-- Payment, release and posting come in phase 5; funds top-ups, advances' liquidation and withholding in phase 4.
-- Every change goes through the functions below; the tables are read-only to the app.

-- 1. The Payment Requests menu, open to every staff role (not under Finance: a Finance page for every role would
-- lift their Finance menu level, and Finance viewers read the cash book).
alter table shared.module_access drop constraint if exists module_access_module_check;
alter table shared.module_access add constraint module_access_module_check
  check (module = any (array['executive', 'dashboard', 'calendar', 'staff', 'hr', 'patients', 'house_ops', 'donors', 'inventory', 'finance', 'compliance',
    'analytics', 'reports', 'settings', 'transport', 'inventory_stock', 'inventory_given_out', 'requests']));
alter table shared.staff_module_access drop constraint if exists staff_module_access_module_check;
alter table shared.staff_module_access add constraint staff_module_access_module_check
  check (module = any (array['executive', 'dashboard', 'calendar', 'staff', 'hr', 'patients', 'house_ops', 'donors', 'inventory', 'finance', 'compliance',
    'analytics', 'reports', 'transport', 'requests']));
alter table shared.role_page_access drop constraint if exists role_page_access_page_check;
alter table shared.role_page_access add constraint role_page_access_page_check
  check (page ~ '^(executive|dashboard|calendar|staff|hr|patients|house_ops|donors|inventory|finance|compliance|analytics|reports|transport|requests)\.[a-z_]+$');

insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level from (values ('requests.all')) p(page)
cross join (values ('ceo', 'edit'), ('chef', 'edit'), ('driver', 'edit'), ('finance', 'edit'), ('house_staff', 'edit'), ('inventory_lead', 'edit'),
  ('inventory_staff', 'edit'), ('nutritionist', 'edit'), ('office_admin', 'edit'), ('social_worker', 'edit'), ('board', 'view')) r(role, level)
where exists (select 1 from shared.roles where key = r.role)
on conflict do nothing;

-- 2. The records.
create table if not exists ops.vouchers (
  id uuid primary key default gen_random_uuid(),
  request_number text unique,
  voucher_type text check (voucher_type in ('PV', 'PCV', 'GCV')),
  voucher_number text unique,
  kind text not null check (kind in ('reimbursement', 'cash_advance', 'supplier', 'petty_cash')),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'endorsed', 'prepared', 'reviewed', 'approved', 'returned', 'rejected', 'cancelled')),
  purpose text not null check (length(btrim(purpose)) between 1 and 500),
  requested_by uuid references shared.staff(id) on delete restrict deferrable initially immediate,
  requester_role text,
  payee_id uuid references ops.payees(id) on delete restrict deferrable initially immediate,
  fund_id uuid references ops.cash_funds(id) on delete restrict deferrable initially immediate,
  t2_id uuid references ops.fin_codes(id) on delete restrict deferrable initially immediate,
  t4_staff_id uuid references shared.staff(id) on delete restrict deferrable initially immediate,
  t4_code text check (length(t4_code) <= 20),
  pay_method text not null default 'cash' check (pay_method in ('cash', 'check', 'bank_transfer', 'gcash')),
  needed_by date,
  urgent boolean not null default false,
  urgent_reason text check (length(urgent_reason) <= 300),
  total numeric(12, 2) not null default 0 check (total >= 0),
  submitted_at timestamptz,
  -- History (phase 3): vouchers read from the registers.
  source text not null default 'app' check (source in ('app', 'sheet')),
  legacy_number text check (length(legacy_number) <= 40),
  legacy_link text check (length(legacy_link) <= 500),
  payee_text text check (length(payee_text) <= 200),
  needs_cleanup boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source = 'sheet' or requested_by is not null),
  check (not urgent or length(btrim(coalesce(urgent_reason, ''))) > 0),
  check ((voucher_number is null) = (voucher_type is null))
);
create index if not exists vouchers_status on ops.vouchers (status);
create index if not exists vouchers_requested_by on ops.vouchers (requested_by);
comment on column ops.vouchers.t4_code is 'The employee code (EMP-30xx) of t4_staff_id when it was set: Finance can''t read hr.employees (0134).';

create table if not exists ops.voucher_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references ops.vouchers(id) on delete cascade deferrable initially immediate,
  sort smallint not null default 0,
  description text not null check (length(btrim(description)) between 1 and 300),
  qty numeric(12, 3) not null default 1 check (qty > 0),
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  amount numeric(12, 2) not null check (amount >= 0),
  or_number text check (length(or_number) <= 60),
  expense_type_id uuid references ops.expense_types(id) on delete restrict deferrable initially immediate,
  account_id uuid references ops.coa_accounts(id) on delete restrict deferrable initially immediate,
  t1_id uuid references ops.fin_codes(id) on delete restrict deferrable initially immediate,
  t3_id uuid references ops.fin_codes(id) on delete restrict deferrable initially immediate,
  legacy_code text check (length(legacy_code) <= 20),
  legacy_account_name text check (length(legacy_account_name) <= 200)
);
create index if not exists voucher_lines_voucher on ops.voucher_lines (voucher_id, sort);

-- The signatures and every change of state, never edited.
create table if not exists ops.voucher_events (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references ops.vouchers(id) on delete cascade deferrable initially immediate,
  action text not null check (action in ('submit', 'skip_endorse', 'endorse', 'prepare', 'review', 'approve', 'return', 'reject', 'cancel', 'history')),
  from_status text,
  to_status text,
  actor uuid references shared.staff(id) on delete set null deferrable initially immediate,
  signer_text text check (length(signer_text) <= 120),
  note text check (length(note) <= 1000),
  source text not null default 'app' check (source in ('app', 'sheet')),
  at timestamptz not null default now()
);
create index if not exists voucher_events_voucher on ops.voucher_events (voucher_id, at);

-- Receipts, invoices and quotations, in the private file store (written by /api/requests/file).
create table if not exists ops.voucher_files (
  id uuid primary key,
  voucher_id uuid not null references ops.vouchers(id) on delete cascade deferrable initially immediate,
  kind text not null check (kind in ('receipt', 'invoice', 'quotation', 'other')),
  object_key text not null unique,
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'application/pdf')),
  bytes integer not null check (bytes between 1 and 3145728),
  uploaded_by uuid references shared.staff(id) on delete set null deferrable initially immediate,
  uploaded_at timestamptz not null default now()
);
create index if not exists voucher_files_voucher on ops.voucher_files (voucher_id);

drop trigger if exists set_updated_at on ops.vouchers;
create trigger set_updated_at before update on ops.vouchers for each row execute function shared.set_updated_at();

-- 3. Who may read: the requester; and, once it is sent (a draft is the requester's alone), Finance (anyone with the
-- Finance menu) and the signers (endorsers only for the roles they endorse).
create or replace function ops.can_read_voucher(p_requested_by uuid, p_status text, p_requester_role text)
returns boolean language sql stable security definer set search_path = ops, shared, pg_temp as $$
  select shared.current_staff_roles() is not null and (
    p_requested_by = auth.uid()
    or (p_status <> 'draft' and shared.module_level('finance') <> 'none')
    or (p_status <> 'draft' and exists (
      select 1 from ops.voucher_authority a
      where auth.uid() in (a.staff_id, a.alternate_staff_id) and (a.step <> 'endorse' or a.requester_role = p_requester_role))));
$$;
revoke all on function ops.can_read_voucher(uuid, text, text) from public;
grant execute on function ops.can_read_voucher(uuid, text, text) to authenticated, service_role;

alter table ops.vouchers enable row level security;
alter table ops.voucher_lines enable row level security;
alter table ops.voucher_events enable row level security;
alter table ops.voucher_files enable row level security;
drop policy if exists "readers read" on ops.vouchers;
create policy "readers read" on ops.vouchers for select to authenticated using (ops.can_read_voucher(requested_by, status, requester_role));
drop policy if exists "readers read" on ops.voucher_lines;
create policy "readers read" on ops.voucher_lines for select to authenticated using (exists (select 1 from ops.vouchers v where v.id = voucher_id));
drop policy if exists "readers read" on ops.voucher_events;
create policy "readers read" on ops.voucher_events for select to authenticated using (exists (select 1 from ops.vouchers v where v.id = voucher_id));
drop policy if exists "readers read" on ops.voucher_files;
create policy "readers read" on ops.voucher_files for select to authenticated using (exists (select 1 from ops.vouchers v where v.id = voucher_id));
revoke all on ops.vouchers, ops.voucher_lines, ops.voucher_events, ops.voucher_files from authenticated;
grant select on ops.vouchers, ops.voucher_lines, ops.voucher_events, ops.voucher_files to authenticated;

-- 4. The signing rule, in one place: an authority row for the step and the amount (an endorse row for the
-- requester's role; an urgent row only on an urgent request), naming the person or their alternate; never the
-- requester; and the preparer, the reviewer and the approver are three different people.
create or replace function ops.voucher_may_sign(p_v ops.vouchers, p_step text, p_actor uuid)
returns boolean language sql stable security definer set search_path = ops, pg_temp as $$
  select p_actor is not null and p_actor is distinct from p_v.requested_by
    and exists (
      select 1 from ops.voucher_authority a
      where a.step = p_step
        and (p_step <> 'endorse' or a.requester_role = p_v.requester_role)
        and p_v.total >= a.min_amount and (a.max_amount is null or p_v.total < a.max_amount)
        and (not a.urgent or p_v.urgent)
        and p_actor in (a.staff_id, a.alternate_staff_id))
    and not (p_step in ('review', 'approve') and exists (
      select 1 from ops.voucher_events e where e.voucher_id = p_v.id and e.action = 'prepare' and e.actor = p_actor
        and e.at = (select max(e2.at) from ops.voucher_events e2 where e2.voucher_id = p_v.id and e2.action = 'prepare')))
    and not (p_step = 'approve' and exists (
      select 1 from ops.voucher_events e where e.voucher_id = p_v.id and e.action = 'review' and e.actor = p_actor
        and e.at = (select max(e2.at) from ops.voucher_events e2 where e2.voucher_id = p_v.id and e2.action = 'review')));
$$;
revoke all on function ops.voucher_may_sign(ops.vouchers, text, uuid) from public;

-- The step a request waits for, by its status.
create or replace function ops.voucher_step(p_status text)
returns text language sql immutable set search_path = pg_temp as $$
  select case p_status when 'submitted' then 'endorse' when 'endorsed' then 'validate' when 'prepared' then 'review' when 'reviewed' then 'approve' end;
$$;
grant execute on function ops.voucher_step(text) to authenticated, service_role;

-- 5. The requester saves a draft (or a returned request): the header and all its lines at once. The account
-- and the cost center / program of each line come from the expense type, never from the browser.
create or replace function ops.voucher_save(p_id uuid, p_voucher jsonb, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  me uuid := auth.uid();
  v ops.vouchers;
  v_kind text := p_voucher->>'kind';
  v_payee uuid := nullif(p_voucher->>'payee_id', '')::uuid;
  v_t2 uuid := nullif(p_voucher->>'t2_id', '')::uuid;
  v_fund uuid;
  v_code text;
  l jsonb;
  n integer := 0;
begin
  if shared.current_staff_roles() is null then
    raise exception 'Only staff can file payment requests.' using errcode = '42501';
  end if;
  if shared.module_level('requests') <> 'edit' then
    raise exception 'Your role can''t file payment requests.' using errcode = '42501';
  end if;
  if p_id is not null then
    select * into v from ops.vouchers where id = p_id for update;
    if not found or v.requested_by is distinct from me then
      raise exception 'No such request of yours.' using errcode = 'P0002';
    end if;
    if v.status not in ('draft', 'returned') then
      raise exception 'This request is with Finance now and can''t be changed.' using errcode = '23514';
    end if;
  end if;
  if length(btrim(coalesce(p_voucher->>'purpose', ''))) not between 1 and 500 then
    raise exception 'Say what the payment is for (up to 500 characters).' using errcode = '23514';
  end if;
  if v_kind is null or v_kind not in ('reimbursement', 'cash_advance', 'supplier', 'petty_cash') then
    raise exception 'Pick what kind of request this is.' using errcode = '23514';
  end if;
  if coalesce((p_voucher->>'urgent')::boolean, false) and length(btrim(coalesce(p_voucher->>'urgent_reason', ''))) = 0 then
    raise exception 'Say why it is urgent.' using errcode = '23514';
  end if;
  if v_kind = 'supplier' and v_payee is null then
    raise exception 'Pick the supplier to be paid.' using errcode = '23514';
  end if;
  if v_payee is not null and not exists (select 1 from ops.payees where id = v_payee and active) then
    raise exception 'That payee is not in use.' using errcode = '23514';
  end if;
  if v_t2 is null or not exists (select 1 from ops.fin_codes where id = v_t2 and tier = 'T2' and active) then
    raise exception 'Pick which fund pays.' using errcode = '23514';
  end if;
  if v_kind = 'petty_cash' then
    select id into v_fund from ops.cash_funds where kind = 'petty_cash' and active order by name limit 1;
    if v_fund is null then
      raise exception 'There is no petty cash fund in use.' using errcode = '23514';
    end if;
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'Add between 1 and 50 items.' using errcode = '23514';
  end if;
  -- A staff member's own advance or reimbursement carries their employee code (T4).
  if v_kind in ('cash_advance', 'reimbursement') then
    select e.employee_code into v_code from hr.employees e where e.staff_id = me;
  end if;

  if p_id is null then
    insert into ops.vouchers (kind, purpose, requested_by, payee_id, fund_id, t2_id, t4_staff_id, t4_code, pay_method, needed_by, urgent, urgent_reason)
    values (v_kind, btrim(coalesce(p_voucher->>'purpose', '')), me, v_payee, v_fund, v_t2,
            case when v_kind in ('cash_advance', 'reimbursement') then me end, v_code,
            coalesce(nullif(p_voucher->>'pay_method', ''), 'cash'), nullif(p_voucher->>'needed_by', '')::date,
            coalesce((p_voucher->>'urgent')::boolean, false), nullif(btrim(coalesce(p_voucher->>'urgent_reason', '')), ''))
    returning * into v;
  else
    update ops.vouchers set kind = v_kind, purpose = btrim(coalesce(p_voucher->>'purpose', '')), payee_id = v_payee, fund_id = v_fund, t2_id = v_t2,
      t4_staff_id = case when v_kind in ('cash_advance', 'reimbursement') then me end, t4_code = v_code,
      pay_method = coalesce(nullif(p_voucher->>'pay_method', ''), 'cash'), needed_by = nullif(p_voucher->>'needed_by', '')::date,
      urgent = coalesce((p_voucher->>'urgent')::boolean, false), urgent_reason = nullif(btrim(coalesce(p_voucher->>'urgent_reason', '')), '')
    where id = v.id returning * into v;
    delete from ops.voucher_lines where voucher_id = v.id;
  end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    if length(btrim(coalesce(l->>'description', ''))) not between 1 and 300 or coalesce((l->>'qty')::numeric, 1) <= 0 or (l->>'unit_cost')::numeric is null or (l->>'unit_cost')::numeric < 0 then
      raise exception 'Item %: describe it and give its quantity and unit cost.', n using errcode = '23514';
    end if;
    insert into ops.voucher_lines (voucher_id, sort, description, qty, unit_cost, amount, or_number, expense_type_id, account_id, t1_id, t3_id)
    select v.id, n, btrim(coalesce(l->>'description', '')), coalesce((l->>'qty')::numeric, 1), (l->>'unit_cost')::numeric,
           round(coalesce((l->>'qty')::numeric, 1) * (l->>'unit_cost')::numeric, 2), nullif(btrim(coalesce(l->>'or_number', '')), ''),
           et.id, et.account_id, case when u.tier = 'T1' then u.id else u.parent_id end, case when u.tier = 'T3' then u.id end
    from ops.expense_types et join ops.fin_codes u on u.id = et.use_id
    where et.id = nullif(l->>'expense_type_id', '')::uuid and et.active;
    if not found then
      raise exception 'Item %: pick what it is for.', n using errcode = '23514';
    end if;
  end loop;
  update ops.vouchers set total = (select coalesce(sum(amount), 0) from ops.voucher_lines where voucher_id = v.id) where id = v.id;
  return v.id;
end $$;
revoke all on function ops.voucher_save(uuid, jsonb, jsonb) from public;
grant execute on function ops.voucher_save(uuid, jsonb, jsonb) to authenticated;

-- 6. Finance prepares the voucher: confirms the fund, the employee code and each line's account and cost center /
-- program, and the voucher gets its number. A restricted fund pays only the accounts it allows.
create or replace function ops.voucher_prepare(p_id uuid, p_t2 uuid, p_t4_staff uuid, p_lines jsonb, p_note text default null)
returns text language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  me uuid := auth.uid();
  v ops.vouchers;
  f ops.fin_codes;
  l jsonb;
  v_type text;
  v_bad text;
  v_year integer := extract(year from (now() at time zone 'Asia/Manila'))::integer;
begin
  select * into v from ops.vouchers where id = p_id for update;
  if not found or not ops.can_read_voucher(v.requested_by, v.status, v.requester_role) then
    raise exception 'No such request.' using errcode = 'P0002';
  end if;
  if v.status <> 'endorsed' then
    raise exception 'Only an endorsed request can be prepared.' using errcode = '23514';
  end if;
  if not ops.voucher_may_sign(v, 'validate', me) then
    raise exception 'You don''t prepare vouchers for this amount (Financial Settings › Authority), or this is your own request.' using errcode = '42501';
  end if;
  select * into f from ops.fin_codes where id = p_t2 and tier = 'T2' and active;
  if not found then
    raise exception 'Pick the fund that pays.' using errcode = '23514';
  end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    update ops.voucher_lines vl set account_id = (l->>'account_id')::uuid, t1_id = (l->>'t1_id')::uuid, t3_id = nullif(l->>'t3_id', '')::uuid
    where vl.id = (l->>'id')::uuid and vl.voucher_id = v.id;
    if not found then
      raise exception 'A line that isn''t on this request.' using errcode = '23514';
    end if;
  end loop;
  -- Every line: a postable, settled account; a cost center; a program or none; and what the fund allows.
  select string_agg(vl.sort::text, ', ' order by vl.sort) into v_bad
  from ops.voucher_lines vl
  left join ops.coa_accounts a on a.id = vl.account_id
  left join ops.fin_codes t1 on t1.id = vl.t1_id
  left join ops.fin_codes t3 on t3.id = vl.t3_id
  where vl.voucher_id = v.id and (
    a.id is null or a.is_header or not a.active or a.code is null or a.review_note is not null
    or t1.id is null or t1.tier <> 'T1' or not t1.active
    or (vl.t3_id is not null and (t3.id is null or t3.tier <> 'T3' or not t3.active)));
  if v_bad is not null then
    raise exception 'Item % needs a usable account and cost center.', v_bad using errcode = '23514';
  end if;
  if f.restricted and cardinality(f.account_prefixes) > 0 then
    select string_agg(a.code, ', ') into v_bad
    from ops.voucher_lines vl join ops.coa_accounts a on a.id = vl.account_id
    where vl.voucher_id = v.id and not exists (select 1 from unnest(f.account_prefixes) p where a.code like p || '%');
    if v_bad is not null then
      raise exception '% (restricted) may not pay for %.', f.name, v_bad using errcode = '23514';
    end if;
  end if;
  v_type := case when v.kind = 'petty_cash' then 'PCV' when v.pay_method = 'gcash' then 'GCV' else 'PV' end;
  if v.voucher_type is not null and v.voucher_type <> v_type then
    raise exception 'This is % %; its type can''t change. Cancel it and file a new request.', v.voucher_type, v.voucher_number using errcode = '23514';
  end if;
  update ops.vouchers set
    t2_id = f.id,
    t4_staff_id = p_t4_staff,
    t4_code = case when p_t4_staff is null then null else (select e.employee_code from hr.employees e where e.staff_id = p_t4_staff) end,
    fund_id = case when v_type = 'GCV' then (select id from ops.cash_funds where kind = 'gcash' and active order by name limit 1) else v.fund_id end,
    voucher_type = v_type,
    voucher_number = coalesce(v.voucher_number, ops.next_doc_number(v_type, v_year)),
    status = 'prepared'
  where id = v.id returning * into v;
  insert into ops.voucher_events (voucher_id, action, from_status, to_status, actor, note) values (v.id, 'prepare', 'endorsed', 'prepared', me, nullif(btrim(coalesce(p_note, '')), ''));
  return v.voucher_number;
end $$;
revoke all on function ops.voucher_prepare(uuid, uuid, uuid, jsonb, text) from public;
grant execute on function ops.voucher_prepare(uuid, uuid, uuid, jsonb, text) to authenticated;

-- 7. Every other step: submit, endorse, review, approve, return, reject, cancel, and discarding a draft.
create or replace function ops.voucher_act(p_id uuid, p_action text, p_note text default null)
returns text language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  me uuid := auth.uid();
  v ops.vouchers;
  v_to text;
  v_step text;
  v_role text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  s ops.finance_settings;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_from text;
begin
  if shared.current_staff_roles() is null then
    raise exception 'Only staff can act on payment requests.' using errcode = '42501';
  end if;
  select * into v from ops.vouchers where id = p_id for update;
  if not found or not ops.can_read_voucher(v.requested_by, v.status, v.requester_role) then
    raise exception 'No such request.' using errcode = 'P0002';
  end if;
  if v.source <> 'app' then
    raise exception 'A voucher from the registers can''t move through the steps.' using errcode = '23514';
  end if;
  v_step := ops.voucher_step(v.status);

  if p_action = 'discard' then
    if v.requested_by is distinct from me or v.status <> 'draft' or v.request_number is not null then
      raise exception 'Only your own unsent draft can be discarded.' using errcode = '23514';
    end if;
    delete from ops.vouchers where id = v.id;
    return 'discarded';
  elsif p_action = 'submit' then
    if v.requested_by is distinct from me or v.status not in ('draft', 'returned') then
      raise exception 'Only your own draft or returned request can be sent.' using errcode = '23514';
    end if;
    if not coalesce((ops.finance_setup_checklist()->>'ready')::boolean, false) then
      raise exception 'Payment requests open once Finance has finished Financial Settings.' using errcode = '23514';
    end if;
    select * into s from ops.finance_settings;
    if s.start_date is null or v_today < s.start_date then
      raise exception 'Payment requests start on %.', to_char(s.start_date, 'FMMonth FMDD, YYYY') using errcode = '23514';
    end if;
    if v.total <= 0 or not exists (select 1 from ops.voucher_lines where voucher_id = v.id) then
      raise exception 'Add the items and their amounts first.' using errcode = '23514';
    end if;
    select role into v_role from shared.staff where id = me;
    v_from := v.status;
    update ops.vouchers set status = 'submitted', requester_role = v_role, submitted_at = now(),
      request_number = coalesce(request_number, ops.next_doc_number('REQ', extract(year from v_today)::integer))
    where id = v.id returning * into v;
    insert into ops.voucher_events (voucher_id, action, from_status, to_status, actor, note) values (v.id, 'submit', v_from, 'submitted', me, v_note);
    -- A role whose requests need no endorsement goes straight to Finance.
    if exists (select 1 from ops.voucher_authority a where a.step = 'endorse' and a.requester_role = v_role and a.staff_id is null
               and v.total >= a.min_amount and (a.max_amount is null or v.total < a.max_amount)) then
      update ops.vouchers set status = 'endorsed' where id = v.id;
      insert into ops.voucher_events (voucher_id, action, from_status, to_status, note) values (v.id, 'skip_endorse', 'submitted', 'endorsed', 'No endorsement needed for this role (Financial Settings › Authority).');
      return 'endorsed';
    end if;
    return 'submitted';
  elsif p_action in ('endorse', 'review', 'approve') then
    if v_step is distinct from p_action then
      raise exception 'This request is not waiting to be %.', case p_action when 'endorse' then 'endorsed' when 'review' then 'reviewed' else 'approved' end using errcode = '23514';
    end if;
    if not ops.voucher_may_sign(v, v_step, me) then
      raise exception 'You don''t sign this step for this amount, or you already signed an earlier step of it.' using errcode = '42501';
    end if;
    v_to := case p_action when 'endorse' then 'endorsed' when 'review' then 'reviewed' else 'approved' end;
  elsif p_action in ('return', 'reject') then
    if v_step is null or not ops.voucher_may_sign(v, v_step, me) then
      raise exception 'Only whoever signs the step it waits for can send it back or reject it.' using errcode = '42501';
    end if;
    if v_note is null then
      raise exception 'Say why.' using errcode = '23514';
    end if;
    v_to := case p_action when 'return' then 'returned' else 'rejected' end;
  elsif p_action = 'cancel' then
    if v.status not in ('returned', 'submitted', 'endorsed', 'prepared', 'reviewed') then
      raise exception 'This request can''t be cancelled now.' using errcode = '23514';
    end if;
    if not ((v.requested_by = me and v.status in ('returned', 'submitted', 'endorsed')) or shared.module_level('finance') = 'edit') then
      raise exception 'Only the requester (before Finance prepares it) or Finance can cancel it.' using errcode = '42501';
    end if;
    if v_note is null then
      raise exception 'Say why.' using errcode = '23514';
    end if;
    v_to := 'cancelled';
  else
    raise exception 'Unknown action %.', p_action using errcode = '22023';
  end if;

  update ops.vouchers set status = v_to where id = v.id;
  insert into ops.voucher_events (voucher_id, action, from_status, to_status, actor, note) values (v.id, p_action, v.status, v_to, me, v_note);
  return v_to;
end $$;
revoke all on function ops.voucher_act(uuid, text, text) from public;
grant execute on function ops.voucher_act(uuid, text, text) to authenticated;

-- 8. What waits for the caller (the "Waiting for me" tab and the bell): the same rule as signing.
create or replace function ops.voucher_queue()
returns table (voucher_id uuid, step text) language sql stable security definer set search_path = ops, pg_temp as $$
  select v.id, ops.voucher_step(v.status)
  from ops.vouchers v
  where v.source = 'app' and ops.voucher_step(v.status) is not null and ops.voucher_may_sign(v, ops.voucher_step(v.status), auth.uid());
$$;
revoke all on function ops.voucher_queue() from public;
grant execute on function ops.voucher_queue() to authenticated;

-- Possible duplicates: other live requests with the same OR / invoice number, or the same payee (or requester)
-- and total within 30 days. The requester sees the count; Finance reads the list itself.
create or replace function ops.voucher_similar(p_id uuid)
returns integer language sql stable security definer set search_path = ops, pg_temp as $$
  select count(*)::integer from ops.vouchers o, ops.vouchers v
  where v.id = p_id and ops.can_read_voucher(v.requested_by, v.status, v.requester_role)
    and o.id <> v.id and o.status not in ('draft', 'cancelled', 'rejected')
    and (exists (select 1 from ops.voucher_lines a join ops.voucher_lines b on lower(a.or_number) = lower(b.or_number)
                 where a.voucher_id = v.id and b.voucher_id = o.id)
         or (o.total = v.total and v.total > 0 and abs(extract(epoch from (o.created_at - v.created_at))) <= 30 * 86400
             and (o.payee_id = v.payee_id or (v.payee_id is null and o.payee_id is null and o.requested_by = v.requested_by))));
$$;
revoke all on function ops.voucher_similar(uuid) from public;
grant execute on function ops.voucher_similar(uuid) to authenticated;

-- Who may attach a file: the requester until Finance prepares it; Finance editors until it is closed.
create or replace function ops.voucher_can_attach(p_id uuid)
returns boolean language sql stable security definer set search_path = ops, shared, pg_temp as $$
  select exists (
    select 1 from ops.vouchers v
    where v.id = p_id and v.source = 'app' and shared.current_staff_roles() is not null and (
      (v.requested_by = auth.uid() and v.status in ('draft', 'returned', 'submitted', 'endorsed'))
      or (shared.module_level('finance') = 'edit' and v.status not in ('rejected', 'cancelled'))));
$$;
revoke all on function ops.voucher_can_attach(uuid) from public;
grant execute on function ops.voucher_can_attach(uuid) to authenticated;

-- 9. Live updates (RLS still decides who receives them).
do $$ begin
  alter publication supabase_realtime add table ops.vouchers, ops.voucher_lines, ops.voucher_events, ops.voucher_files;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
