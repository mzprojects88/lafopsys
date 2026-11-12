-- 0142 Voucher System, polish 2 (12 Nov 2026): Finance keeps or changes the payment method when preparing.
--
-- The requester says how they would like it paid; Finance decides, as it does the fund (0140): cash, check, bank
-- transfer or GCash (which makes it a GCash Fund Voucher, paid from the GCash fund). Copied from 0138.

drop function if exists ops.voucher_prepare(uuid, uuid, uuid, jsonb, text, uuid);
create or replace function ops.voucher_prepare(p_id uuid, p_t2 uuid, p_t4_staff uuid, p_lines jsonb, p_note text default null, p_payee uuid default null, p_pay_method text default null)
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
  -- 0142: Finance keeps the requester's payment method or changes it (it decides PV or GCV); a liquidation and
  -- petty cash are what they are.
  if p_pay_method is not null then
    if p_pay_method not in ('cash', 'check', 'bank_transfer', 'gcash') then
      raise exception 'Pick how it is paid.' using errcode = '23514';
    end if;
    if p_pay_method is distinct from v.pay_method then
      update ops.vouchers set pay_method = p_pay_method where id = v.id returning * into v;
    end if;
  end if;
  -- 0138: a liquidation settles an advance on paper (JV); everything else pays out.
  v_type := case when v.kind = 'liquidation' then 'JV' when v.kind = 'petty_cash' then 'PCV' when v.pay_method = 'gcash' then 'GCV' else 'PV' end;
  if p_payee is not null and not exists (select 1 from ops.payees where id = p_payee and active) then
    raise exception 'That payee is not in use.' using errcode = '23514';
  end if;
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
  -- 0138: the payee Finance links (a supplier, or the person paid) and each line's withholding from its ATC.
  -- "None" (null) withholds nothing and keeps the requester's supplier on the voucher.
  update ops.vouchers set payee_id = coalesce(p_payee, payee_id) where id = v.id returning * into v;
  update ops.voucher_lines set ewt_atc = null, ewt_rate = null, ewt_amount = 0 where voucher_id = v.id;
  update ops.voucher_lines l set ewt_atc = r.atc, ewt_rate = r.rate, ewt_amount = round(l.amount * r.rate / 100, 2)
  from ops.payees p join ops.ewt_rates r on r.atc = p.ewt_atc and r.active
  where l.voucher_id = v.id and p.id = p_payee;
  update ops.vouchers set ewt_total = (select coalesce(sum(ewt_amount), 0) from ops.voucher_lines where voucher_id = v.id) where id = v.id;
  insert into ops.voucher_events (voucher_id, action, from_status, to_status, actor, note) values (v.id, 'prepare', 'endorsed', 'prepared', me, nullif(btrim(coalesce(p_note, '')), ''));
  return v.voucher_number;
end $$;
revoke all on function ops.voucher_prepare(uuid, uuid, uuid, jsonb, text, uuid, text) from public;
grant execute on function ops.voucher_prepare(uuid, uuid, uuid, jsonb, text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
