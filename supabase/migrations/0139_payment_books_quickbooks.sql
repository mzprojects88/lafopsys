-- 0139 Voucher System, phase 6: payment, release, the books, QuickBooks and the bank (decided 10-11 Nov 2026).
--
-- After approval: Finance prepares the payment (the account it is paid from, the check or transfer reference), the
-- payment signatory approves it, and the releaser releases it (proof attached). A slip paid from a petty cash or
-- GCash fund is released straight after approval by the releaser; a liquidation (JV) is
-- settled the same way (the change returned or the overspend paid). Release posts the cash book (ops.cash_entries)
-- by program, so Finance's overview and Allocation fill themselves; a top-up is a transfer to the fund (the slips
-- were the spending) and posts nothing there. Whoever holds the export power downloads a QuickBooks journal for any
-- period; exported vouchers are marked. Finance matches a paid voucher to its bank debit.
-- Signing keeps the rule: nobody signs two payment steps of one voucher, nor pays their own request.

-- 1. Statuses, links and settings.
alter table ops.vouchers drop constraint if exists vouchers_status_check;
alter table ops.vouchers add constraint vouchers_status_check check (status in ('draft', 'submitted', 'endorsed', 'prepared', 'reviewed', 'approved', 'payment_prepared', 'payment_approved', 'released', 'returned', 'rejected', 'cancelled'));
alter table ops.vouchers
  add column if not exists paid_from_account_id uuid references ops.coa_accounts(id) on delete restrict deferrable initially immediate,
  add column if not exists pay_reference text check (length(pay_reference) <= 60),
  add column if not exists released_at timestamptz,
  add column if not exists exported_at timestamptz,
  add column if not exists bank_transaction_id uuid unique references ops.bank_transactions(id) on delete set null deferrable initially immediate;
alter table ops.voucher_events drop constraint if exists voucher_events_action_check;
alter table ops.voucher_events add constraint voucher_events_action_check check (action in ('submit', 'skip_endorse', 'endorse', 'prepare', 'review', 'approve', 'prepare_payment', 'approve_payment', 'release', 'bank_match', 'return', 'reject', 'cancel', 'history'));
alter table ops.voucher_files drop constraint if exists voucher_files_kind_check;
alter table ops.voucher_files add constraint voucher_files_kind_check check (kind in ('receipt', 'invoice', 'quotation', 'proof', 'other'));
-- The two accounts the journal needs besides each line's own (Financial Settings › General; seeded from the chart).
alter table ops.finance_settings
  add column if not exists advances_account_id uuid references ops.coa_accounts(id) on delete set null deferrable initially immediate,
  add column if not exists ewt_payable_account_id uuid references ops.coa_accounts(id) on delete set null deferrable initially immediate;
alter table ops.finance_settings disable trigger log_finance_setup;
update ops.finance_settings set
  advances_account_id = coalesce(advances_account_id, (select id from ops.coa_accounts where code = '1401' and not is_header)),
  ewt_payable_account_id = coalesce(ewt_payable_account_id, (select id from ops.coa_accounts where code = '2080' and not is_header));
alter table ops.finance_settings enable trigger log_finance_setup;

-- 2. The payment step a voucher waits for, and who may sign it.
create or replace function ops.voucher_pay_step(p_v ops.vouchers)
returns text language sql immutable set search_path = pg_temp as $$
  select case
    when p_v.source <> 'app' then null
    -- Paid from a fund (a petty cash or GCash slip) or a liquidation: released straight after approval.
    when p_v.status = 'approved' and (p_v.kind = 'liquidation' or (p_v.fund_id is not null and p_v.kind <> 'fund_topup')) then 'release'
    when p_v.status = 'approved' then 'prepare_payment'
    when p_v.status = 'payment_prepared' then 'approve_payment'
    when p_v.status = 'payment_approved' then 'release'
  end;
$$;

create or replace function ops.voucher_may_pay(p_v ops.vouchers, p_step text, p_actor uuid)
returns boolean language sql stable security definer set search_path = ops, pg_temp as $$
  select p_actor is not null and p_actor is distinct from p_v.requested_by
    and (
      exists (
        select 1 from ops.voucher_authority a
        -- Finance's preparers prepare the payment; the payment signatory and the releaser have their own rows.
        where a.step = case p_step when 'prepare_payment' then 'validate' else p_step end
          and p_v.total >= a.min_amount and (a.max_amount is null or p_v.total < a.max_amount)
          and p_actor in (a.staff_id, a.alternate_staff_id)))
    -- Nobody signs two payment steps of one voucher.
    and not exists (
      select 1 from ops.voucher_events e
      where e.voucher_id = p_v.id and e.actor = p_actor and e.action in ('prepare_payment', 'approve_payment')
        and e.at > coalesce((select max(e2.at) from ops.voucher_events e2 where e2.voucher_id = p_v.id and e2.action = 'approve'), '-infinity'));
$$;
revoke all on function ops.voucher_may_pay(ops.vouchers, text, uuid) from public;
grant execute on function ops.voucher_may_pay(ops.vouchers, text, uuid) to authenticated;

-- 3. Paying: prepare the payment, approve it, release it (and post the cash book).
create or replace function ops.voucher_pay(p_id uuid, p_action text, p_account uuid default null, p_reference text default null, p_note text default null)
returns text language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  me uuid := auth.uid();
  v ops.vouchers;
  v_step text;
  v_to text;
  v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_diff numeric := 0;
  v_number text;
begin
  if shared.current_staff_roles() is null then
    raise exception 'Only staff can pay vouchers.' using errcode = '42501';
  end if;
  select * into v from ops.vouchers where id = p_id for update;
  if not found or not ops.can_read_voucher(v.requested_by, v.status, v.requester_role) then
    raise exception 'No such voucher.' using errcode = 'P0002';
  end if;
  v_step := ops.voucher_pay_step(v);
  if v_step is distinct from p_action then
    raise exception 'This voucher is not waiting for that step.' using errcode = '23514';
  end if;
  if not ops.voucher_may_pay(v, v_step, me) then
    raise exception 'You don''t sign this payment step for this amount, or you signed another step of it.' using errcode = '42501';
  end if;
  -- An account that holds cash (under 1100) and is in use.
  if p_account is not null and not exists (select 1 from ops.coa_accounts where id = p_account and code like '11%' and not is_header and active and review_note is null) then
    raise exception 'Pay from a cash or bank account (1100s) in use.' using errcode = '23514';
  end if;

  if p_action = 'prepare_payment' then
    if p_account is null then
      raise exception 'Pick the account it is paid from.' using errcode = '23514';
    end if;
    if v.pay_method in ('check', 'bank_transfer', 'gcash') and v_ref is null then
      raise exception 'Give the check number or the transfer reference.' using errcode = '23514';
    end if;
    update ops.vouchers set paid_from_account_id = p_account, pay_reference = v_ref, status = 'payment_prepared' where id = v.id;
    v_to := 'payment_prepared';
  elsif p_action = 'approve_payment' then
    update ops.vouchers set status = 'payment_approved' where id = v.id;
    v_to := 'payment_approved';
  else
    if v.kind = 'liquidation' then
      -- What the liquidation leaves: change returned (in) or the overspend paid (out).
      select a.total - (v.total - v.ewt_total) into v_diff from ops.vouchers a where a.id = v.advance_of;
      if v_diff <> 0 and p_account is null then
        raise exception 'Pick the account the % goes through.', case when v_diff > 0 then 'returned change' else 'reimbursement' end using errcode = '23514';
      end if;
      update ops.vouchers set paid_from_account_id = case when v_diff <> 0 then p_account end where id = v.id;
    elsif v.paid_from_account_id is null then
      -- A slip: paid from its fund's account.
      update ops.vouchers set paid_from_account_id = (select account_id from ops.cash_funds where id = v.fund_id) where id = v.id;
      if (select paid_from_account_id from ops.vouchers where id = v.id) is null then
        raise exception 'Set the fund''s account first (Financial Settings › Funds).' using errcode = '23514';
      end if;
    end if;
    update ops.vouchers set status = 'released', released_at = now() where id = v.id;
    v_to := 'released';
    v_number := coalesce(v.voucher_number, v.request_number);
    -- The cash book, by program (from each line's T3); a top-up is a transfer to its fund and posts nothing.
    if v.kind = 'liquidation' then
      if v_diff <> 0 then
        insert into ops.cash_entries (source_id, date, direction, source, entity, currency, amount, description, approval_status)
        values ('voucher:' || v.id, (now() at time zone 'Asia/Manila')::date, case when v_diff > 0 then 'inflow' else 'outflow' end, 'voucher', 'PH_SEC', 'PHP', abs(v_diff),
                left(v_number || ': ' || case when v_diff > 0 then 'change returned' else 'overspend reimbursed' end || ' (' || v.purpose || ')', 500), 'approved')
        on conflict (source_id) do nothing;
      end if;
    elsif v.kind <> 'fund_topup' then
      insert into ops.cash_entries (source_id, date, direction, source, entity, currency, amount, program_id, description, approval_status)
      select 'voucher:' || v.id || ':' || coalesce(p.id, 'none'), (now() at time zone 'Asia/Manila')::date, 'outflow', 'voucher', 'PH_SEC', 'PHP',
             sum(l.amount - l.ewt_amount), p.id, left(v_number || ': ' || v.purpose, 500), 'approved'
      from ops.voucher_lines l
      left join lateral (select x.id from ops.programs x where x.t3_id = l.t3_id order by x.id limit 1) p on true
      where l.voucher_id = v.id
      group by p.id
      having sum(l.amount - l.ewt_amount) > 0
      on conflict (source_id) do nothing;
    end if;
  end if;
  insert into ops.voucher_events (voucher_id, action, from_status, to_status, actor, note) values (v.id, p_action, v.status, v_to, me, coalesce(v_note, v_ref));
  return v_to;
end $$;
revoke all on function ops.voucher_pay(uuid, text, uuid, text, text) from public;
grant execute on function ops.voucher_pay(uuid, text, uuid, text, text) to authenticated;

-- 4. The QuickBooks journal for vouchers released between two Manila days, one balanced entry per voucher:
-- the lines' accounts (or the advance, or the fund being refilled) on the debit side; withholding payable and the
-- advance settled on the credit side; the cash account balances it. With p_mark, the vouchers are marked exported.
create or replace function ops.voucher_qb_export(p_from date, p_to date, p_mark boolean default false)
returns table (voucher_id uuid, journal_no text, journal_date date, account text, debit numeric, credit numeric, description text, name text, class text, already_exported boolean)
language plpgsql security definer set search_path = ops, shared, pg_temp as $$
#variable_conflict use_column
declare
  s ops.finance_settings;
begin
  if shared.current_staff_roles() is null or not shared.has_power('finance_export') then
    raise exception 'Only whoever holds the export power exports to QuickBooks.' using errcode = '42501';
  end if;
  select * into s from ops.finance_settings;
  return query
  with vs as (
    select v.*, (v.released_at at time zone 'Asia/Manila')::date jday,
           coalesce(case when v.to_person then v.recipient_name end, p.name, v.t4_code, '') who
    from ops.vouchers v left join ops.payees p on p.id = v.payee_id
    where v.source = 'app' and v.status = 'released' and (v.released_at at time zone 'Asia/Manila')::date between p_from and p_to
  ), dr as (
    -- Expenses (and a liquidation's real spending), line by line.
    select vs.id, a.code || ' ' || a.name acc, l.amount amt, left(vs.purpose || ': ' || l.description, 300) descr,
           nullif(concat_ws(':', t1.code, t3.code), '') cls, l.sort
    from vs join ops.voucher_lines l on l.voucher_id = vs.id join ops.coa_accounts a on a.id = l.account_id
    left join ops.fin_codes t1 on t1.id = l.t1_id left join ops.fin_codes t3 on t3.id = l.t3_id
    where vs.kind in ('reimbursement', 'supplier', 'petty_cash', 'liquidation')
    union all
    -- An advance is a receivable from the employee; a top-up refills the fund's own account.
    select vs.id, a.code || ' ' || a.name, vs.total, left(vs.purpose, 300), null, 0
    from vs join ops.coa_accounts a on a.id = case when vs.kind = 'cash_advance' then s.advances_account_id else (select f.account_id from ops.cash_funds f where f.id = vs.fund_id) end
    where vs.kind in ('cash_advance', 'fund_topup')
  ), cr as (
    select vs.id, a.code || ' ' || a.name acc, vs.ewt_total amt, 'Expanded withholding tax' descr
    from vs join ops.coa_accounts a on a.id = s.ewt_payable_account_id where vs.ewt_total > 0
    union all
    select vs.id, a.code || ' ' || a.name, adv.total, 'Advance ' || coalesce(adv.voucher_number, '') || ' settled'
    from vs join ops.vouchers adv on adv.id = vs.advance_of join ops.coa_accounts a on a.id = s.advances_account_id
  )
  select vs.id, vs.voucher_number, vs.jday, x.acc, x.d, x.c, x.descr, vs.who, x.cls, vs.exported_at is not null
  from vs cross join lateral (
    select dr.acc, dr.amt d, null::numeric c, dr.descr, dr.cls, dr.sort ord from dr where dr.id = vs.id
    union all
    select cr.acc, null, cr.amt, cr.descr, null, 1000 from cr where cr.id = vs.id
    union all
    -- The cash side balances the entry: credited when cash went out, debited when change came back.
    select a.code || ' ' || a.name,
           case when bal < 0 then -bal end, case when bal > 0 then bal end, case when bal > 0 then 'Paid' else 'Change returned' end || coalesce(' · ' || vs.pay_reference, ''), null, 2000
    from (select coalesce((select sum(amt) from dr where dr.id = vs.id), 0) - coalesce((select sum(amt) from cr where cr.id = vs.id), 0) bal) b
    join ops.coa_accounts a on a.id = vs.paid_from_account_id
    where bal <> 0
  ) x(acc, d, c, descr, cls, ord)
  order by vs.jday, vs.voucher_number, x.ord;
  -- Marked after the rows are read, so they still say whether each was exported before.
  if p_mark then
    update ops.vouchers set exported_at = now()
    where source = 'app' and status = 'released' and (released_at at time zone 'Asia/Manila')::date between p_from and p_to;
  end if;
end $$;
revoke all on function ops.voucher_qb_export(date, date, boolean) from public;
grant execute on function ops.voucher_qb_export(date, date, boolean) to authenticated;

-- 5. The bank: Finance links a paid voucher to its bank debit (or unlinks it with null); the debit is marked
-- matched to the voucher's cash entry so it isn't reconciled twice.
create or replace function ops.voucher_bank_match(p_id uuid, p_tx uuid)
returns void language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  v ops.vouchers;
begin
  if shared.current_staff_roles() is null or shared.module_level('finance') <> 'edit' then
    raise exception 'Only Finance matches vouchers to the bank.' using errcode = '42501';
  end if;
  select * into v from ops.vouchers where id = p_id and status = 'released' and source = 'app' for update;
  if not found then
    raise exception 'Only a released voucher is matched to the bank.' using errcode = '23514';
  end if;
  if v.bank_transaction_id is not null then
    update ops.bank_transactions set matched_cash_entry_id = null where id = v.bank_transaction_id and matched_cash_entry_id in (select id from ops.cash_entries where source_id like 'voucher:' || v.id || '%');
  end if;
  if p_tx is not null then
    perform 1 from ops.bank_transactions where id = p_tx and debit = v.total - v.ewt_total and matched_cash_entry_id is null for update;
    if not found or exists (select 1 from ops.vouchers where bank_transaction_id = p_tx and id <> v.id) then
      raise exception 'That bank debit is not this voucher''s amount, or is matched already.' using errcode = '23514';
    end if;
    update ops.bank_transactions set matched_cash_entry_id = (select id from ops.cash_entries where source_id like 'voucher:' || v.id || '%' order by amount desc limit 1) where id = p_tx;
  end if;
  update ops.vouchers set bank_transaction_id = p_tx where id = v.id;
  insert into ops.voucher_events (voucher_id, action, from_status, to_status, actor, note)
  values (v.id, 'bank_match', v.status, v.status, auth.uid(), case when p_tx is null then 'Unmatched from the bank' else 'Matched to the bank debit' end);
end $$;
revoke all on function ops.voucher_bank_match(uuid, uuid) from public;
grant execute on function ops.voucher_bank_match(uuid, uuid) to authenticated;

-- 6. Copied with their changes: advances count from release; funds from released slips; the queue holds the
-- payment steps; Finance attaches the proof; a liquidation may settle a fully returned advance (0 spent); Finance
-- may cancel before the payment is released.
-- 0139: open once released (the cash handed over), due the set days after release.
drop function if exists ops.advances_open();
create or replace function ops.advances_open()
returns table (voucher_id uuid, requested_by uuid, amount numeric, released_at timestamptz, due date, overdue boolean, liquidation_id uuid, liquidation_status text)
language sql stable security definer set search_path = ops, shared, pg_temp as $$
  select v.id, v.requested_by, v.total, a.at,
         ((a.at at time zone 'Asia/Manila')::date + coalesce(s.liquidation_days, 15)),
         (now() at time zone 'Asia/Manila')::date > ((a.at at time zone 'Asia/Manila')::date + coalesce(s.liquidation_days, 15))
           and coalesce(l.status, 'draft') in ('draft', 'returned'),
         l.id, l.status
  from ops.vouchers v
  cross join ops.finance_settings s
  join lateral (select max(e.at) at from ops.voucher_events e where e.voucher_id = v.id and e.action = 'release') a on a.at is not null
  left join lateral (select x.id, x.status from ops.vouchers x where x.advance_of = v.id and x.status not in ('rejected', 'cancelled') order by x.created_at desc limit 1) l on true
  where v.kind = 'cash_advance' and v.status = 'released' and v.source = 'app'
    and coalesce(l.status, '') not in ('approved', 'released')
    and shared.current_staff_roles() is not null
    and (v.requested_by = auth.uid() or shared.module_level('finance') <> 'none');
$$;
revoke all on function ops.advances_open() from public;
grant execute on function ops.advances_open() to authenticated;

create or replace function ops.voucher_liquidate(p_advance uuid)
returns uuid language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  a ops.vouchers;
  v_id uuid;
begin
  if shared.current_staff_roles() is null or shared.module_level('requests') <> 'edit' then
    raise exception 'Your role can''t file payment requests.' using errcode = '42501';
  end if;
  select * into a from ops.vouchers where id = p_advance for update;
  if not found or a.requested_by is distinct from auth.uid() or a.kind <> 'cash_advance' or a.status <> 'released' or a.source <> 'app' then
    raise exception 'Only your own cash advance, once paid, is liquidated.' using errcode = '42501';
  end if;
  if exists (select 1 from ops.vouchers where advance_of = a.id and status not in ('rejected', 'cancelled')) then
    raise exception 'This advance already has its liquidation.' using errcode = '23514';
  end if;
  insert into ops.vouchers (kind, purpose, requested_by, t2_id, t4_staff_id, t4_code, pay_method, advance_of)
  values ('liquidation', left('Liquidation of ' || coalesce(a.voucher_number, a.request_number) || ': ' || a.purpose, 500), a.requested_by, a.t2_id, a.requested_by,
          (select e.employee_code from hr.employees e where e.staff_id = a.requested_by), a.pay_method, a.id)
  returning id into v_id;
  insert into ops.voucher_lines (voucher_id, sort, description, qty, unit_cost, amount, expense_type_id, account_id, t1_id, t3_id)
  select v_id, sort, description, qty, unit_cost, amount, expense_type_id, account_id, t1_id, t3_id from ops.voucher_lines where voucher_id = a.id;
  update ops.vouchers set total = (select coalesce(sum(amount), 0) from ops.voucher_lines where voucher_id = v_id) where id = v_id;
  return v_id;
end $$;
revoke all on function ops.voucher_liquidate(uuid) from public;
grant execute on function ops.voucher_liquidate(uuid) to authenticated;

-- 0139: a slip leaves the fund when released; the fund is refilled when its top-up is released.
create or replace function ops.fund_status()
returns table (fund_id uuid, name text, kind text, float_amount numeric, top_up_below numeric, custodian_staff_id uuid, open_count integer, open_amount numeric, cash_on_hand numeric, to_refill integer, topup_pending boolean, low boolean)
language sql stable security definer set search_path = ops, shared, pg_temp as $$
  select f.id, f.name, f.kind, f.float_amount, f.top_up_below, f.custodian_staff_id,
         count(v.id)::integer, coalesce(sum(v.total - v.ewt_total), 0),
         coalesce(f.float_amount, 0) - coalesce(sum(v.total - v.ewt_total), 0),
         (count(v.id) filter (where v.replenished_by is null))::integer,
         bool_or(v.replenished_by is not null) is true,
         -- Low = needs a top-up: below its point, and none on its way yet.
         f.top_up_below is not null and coalesce(f.float_amount, 0) - coalesce(sum(v.total - v.ewt_total), 0) < f.top_up_below
           and not (bool_or(v.replenished_by is not null) is true)
  from ops.cash_funds f
  left join ops.vouchers v on v.fund_id = f.id and v.status = 'released' and v.kind <> 'fund_topup'
    and (v.replenished_by is null or not exists (select 1 from ops.vouchers t where t.id = v.replenished_by and t.status = 'released'))
  where f.active and shared.current_staff_roles() is not null
    and (shared.module_level('finance') <> 'none' or f.custodian_staff_id = auth.uid())
  group by f.id;
$$;
revoke all on function ops.fund_status() from public;
grant execute on function ops.fund_status() to authenticated;

create or replace function ops.fund_topup_create(p_fund uuid)
returns uuid language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  f ops.cash_funds;
  v_id uuid;
  v_n integer;
begin
  -- Locked: two top-ups asked at the same moment must not both take the same slips.
  select * into f from ops.cash_funds where id = p_fund and active for update;
  if not found then
    raise exception 'No such fund in use.' using errcode = 'P0002';
  end if;
  if shared.current_staff_roles() is null or not (shared.module_level('finance') = 'edit' or f.custodian_staff_id = auth.uid()) then
    raise exception 'Only Finance or the fund''s custodian asks for a top-up.' using errcode = '42501';
  end if;
  select count(*) into v_n from ops.vouchers where fund_id = f.id and status = 'released' and kind <> 'fund_topup' and replenished_by is null;
  if v_n = 0 then
    raise exception 'No slips to refill yet.' using errcode = '23514';
  end if;
  insert into ops.vouchers (kind, purpose, requested_by, t2_id, pay_method, fund_id)
  values ('fund_topup', 'Top-up of ' || f.name || ': ' || v_n || ' slip' || case when v_n = 1 then '' else 's' end, auth.uid(),
          coalesce((select id from ops.fin_codes where tier = 'T2' and code = 'UNR' and active), (select id from ops.fin_codes where tier = 'T2' and active order by sort limit 1)),
          case when f.kind = 'gcash' then 'bank_transfer' else 'cash' end, f.id)
  returning id into v_id;
  insert into ops.voucher_lines (voucher_id, sort, description, qty, unit_cost, amount, account_id, t1_id, t3_id)
  select v_id, row_number() over (order by a.code), coalesce(a.name, 'Uncoded') || ' (' || count(*) || ' line' || case when count(*) = 1 then '' else 's' end || ')', 1, sum(l.amount - l.ewt_amount), sum(l.amount - l.ewt_amount), l.account_id, l.t1_id, l.t3_id
  from ops.voucher_lines l join ops.vouchers v on v.id = l.voucher_id left join ops.coa_accounts a on a.id = l.account_id
  where v.fund_id = f.id and v.status = 'released' and v.kind <> 'fund_topup' and v.replenished_by is null
  group by l.account_id, a.code, a.name, l.t1_id, l.t3_id;
  update ops.vouchers set total = (select coalesce(sum(amount), 0) from ops.voucher_lines where voucher_id = v_id) where id = v_id;
  update ops.vouchers set replenished_by = v_id where fund_id = f.id and status = 'released' and kind <> 'fund_topup' and replenished_by is null;
  return v_id;
end $$;
revoke all on function ops.fund_topup_create(uuid) from public;
grant execute on function ops.fund_topup_create(uuid) to authenticated;

create or replace function ops.voucher_queue()
returns table (voucher_id uuid, step text) language sql stable security definer set search_path = ops, pg_temp as $$
  select v.id, ops.voucher_step(v.status)
  from ops.vouchers v
  where v.source = 'app' and ops.voucher_step(v.status) is not null and ops.voucher_may_sign(v, ops.voucher_step(v.status), auth.uid())
  union all
  -- 0139: the payment steps.
  select v.id, ops.voucher_pay_step(v) from ops.vouchers v
  where ops.voucher_pay_step(v) is not null and ops.voucher_may_pay(v, ops.voucher_pay_step(v), auth.uid())
  union all
  select v.id, 'returned' from ops.vouchers v where v.requested_by = auth.uid() and v.status = 'returned';
$$;

-- 0139: Finance attaches the proof of payment, up to release and after.
create or replace function ops.voucher_can_attach(p_id uuid)
returns boolean language sql stable security definer set search_path = ops, shared, pg_temp as $$
  select exists (
    select 1 from ops.vouchers v
    where v.id = p_id and v.source = 'app' and shared.current_staff_roles() is not null and (
      (v.requested_by = auth.uid() and v.status in ('draft', 'returned', 'submitted', 'endorsed'))
      or (shared.module_level('finance') = 'edit' and v.status in ('submitted', 'endorsed', 'prepared', 'reviewed', 'approved', 'payment_prepared', 'payment_approved', 'released'))));
$$;

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
    -- Its files would stay in the store with nothing pointing at them.
    if exists (select 1 from ops.voucher_files where voucher_id = v.id) then
      raise exception 'Remove its files first, then discard it.' using errcode = '23514';
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
    -- 0139: a liquidation may come to 0 (the whole advance returned).
    if (v.total <= 0 and v.kind <> 'liquidation') or not exists (select 1 from ops.voucher_lines where voucher_id = v.id) then
      raise exception 'Add the items and their amounts first.' using errcode = '23514';
    end if;
    select role into v_role from shared.staff where id = me;
    -- 0138: a new cash advance waits while one of the requester's is overdue (Financial Settings).
    if v.kind = 'cash_advance' and s.block_advance_when_overdue and exists (
      select 1 from ops.advances_open() a where a.requested_by = me and a.overdue) then
      raise exception 'Liquidate your overdue cash advance first.' using errcode = '23514';
    end if;
    -- Nobody signs their own request: every step needs someone else for this amount (or, for endorsement, a row
    -- saying none is needed), or the request would wait forever.
    select string_agg(st.label, ', ') into v_step
    from (values ('endorse', 'endorsement'), ('validate', 'preparing'), ('review', 'review'), ('approve', 'approval')) st(step, label)
    where not exists (
      select 1 from ops.voucher_authority a
      where a.step = st.step and (st.step <> 'endorse' or a.requester_role = v_role)
        and v.total >= a.min_amount and (a.max_amount is null or v.total < a.max_amount)
        and (not a.urgent or v.urgent)
        and ((st.step = 'endorse' and a.staff_id is null) or (a.staff_id is distinct from me and a.staff_id is not null) or (a.alternate_staff_id is not null and a.alternate_staff_id <> me)));
    if v_step is not null then
      raise exception 'Nobody but you signs the % of this request: ask Finance to add another signer or an alternate (Financial Settings › Authority).', v_step using errcode = '23514';
    end if;
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
    if v.status not in ('returned', 'submitted', 'endorsed', 'prepared', 'reviewed', 'approved', 'payment_prepared', 'payment_approved') then
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
  -- 0138: a top-up that stops (rejected or cancelled) frees its slips for the next one.
  if v.kind = 'fund_topup' and v_to in ('rejected', 'cancelled') then
    update ops.vouchers set replenished_by = null where replenished_by = v.id;
  end if;
  return v_to;
end $$;
revoke all on function ops.voucher_act(uuid, text, text) from public;
grant execute on function ops.voucher_act(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
