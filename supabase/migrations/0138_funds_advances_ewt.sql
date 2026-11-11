-- 0138 Voucher System, phase 5: petty cash and GCash funds, cash advances and their liquidation, withholding tax
-- (decided 10-11 Nov 2026).
--
-- Funds: each is a fixed float (imprest). Cash on hand = the float less the slips paid from it (PCV, GCash vouchers)
-- not yet refilled; below its top-up point Finance or the custodian makes a top-up voucher from the open slips.
-- Advances: a cash advance, once approved, is liquidated within Financial Settings' days by a liquidation (a JV)
-- that codes what was really spent; the difference is returned or reimbursed (settled when payments are released,
-- phase 6). With the setting on, a new advance waits while one of the requester's is overdue.
-- Withholding: Finance links the payee when preparing; each line's EWT comes from the payee's ATC rate, the voucher
-- pays the net, and the 2307 details are kept per payee and quarter.

-- 1. The new kinds and voucher type, and their links.
alter table ops.vouchers drop constraint if exists vouchers_kind_check;
alter table ops.vouchers add constraint vouchers_kind_check check (kind in ('reimbursement', 'cash_advance', 'supplier', 'petty_cash', 'fund_topup', 'liquidation'));
alter table ops.vouchers drop constraint if exists vouchers_voucher_type_check;
alter table ops.vouchers add constraint vouchers_voucher_type_check check (voucher_type in ('PV', 'PCV', 'GCV', 'JV'));
alter table ops.vouchers
  add column if not exists advance_of uuid references ops.vouchers(id) on delete restrict deferrable initially immediate,
  add column if not exists replenished_by uuid references ops.vouchers(id) on delete set null deferrable initially immediate,
  add column if not exists ewt_total numeric(12, 2) not null default 0 check (ewt_total >= 0);
alter table ops.vouchers drop constraint if exists vouchers_liquidation_check;
alter table ops.vouchers add constraint vouchers_liquidation_check check ((kind = 'liquidation') = (advance_of is not null));
alter table ops.voucher_lines
  add column if not exists ewt_atc text check (length(ewt_atc) <= 10),
  add column if not exists ewt_rate numeric(5, 2) check (ewt_rate >= 0),
  add column if not exists ewt_amount numeric(12, 2) not null default 0 check (ewt_amount >= 0);
-- A person paid can carry a payee too, but only Finance links it (when preparing, for withholding); voucher_save
-- still clears it for the requester.
alter table ops.vouchers drop constraint if exists vouchers_person_check;
alter table ops.vouchers add constraint vouchers_person_check check (not to_person or source = 'sheet' or (recipient_category_id is not null and recipient_name is not null));
comment on column ops.vouchers.replenished_by is 'On a petty cash or GCash slip: the top-up voucher that refills it (0138).';

-- 2. Settings: the overdue-advance rule (moved here from phase 1) and the payer on the 2307.
alter table ops.finance_settings
  add column if not exists block_advance_when_overdue boolean not null default true,
  add column if not exists payer_name text check (length(payer_name) <= 200),
  add column if not exists payer_tin text check (payer_tin ~ '^\d{9}(\d{3}|\d{5})?$'),
  add column if not exists payer_address text check (length(payer_address) <= 300);

-- 3. Open cash advances: approved, not yet settled by an approved liquidation; due the set number of days after
-- approval (after release once payments are released, phase 6). The requester sees theirs; Finance sees all.
create or replace function ops.advances_open()
returns table (voucher_id uuid, requested_by uuid, amount numeric, approved_at timestamptz, due date, overdue boolean, liquidation_id uuid, liquidation_status text)
language sql stable security definer set search_path = ops, shared, pg_temp as $$
  select v.id, v.requested_by, v.total, a.at,
         ((a.at at time zone 'Asia/Manila')::date + coalesce(s.liquidation_days, 15)),
         (now() at time zone 'Asia/Manila')::date > ((a.at at time zone 'Asia/Manila')::date + coalesce(s.liquidation_days, 15)),
         l.id, l.status
  from ops.vouchers v
  cross join ops.finance_settings s
  join lateral (select max(e.at) at from ops.voucher_events e where e.voucher_id = v.id and e.action = 'approve') a on a.at is not null
  left join lateral (select x.id, x.status from ops.vouchers x where x.advance_of = v.id and x.status not in ('rejected', 'cancelled') order by x.created_at desc limit 1) l on true
  where v.kind = 'cash_advance' and v.status = 'approved' and v.source = 'app'
    and coalesce(l.status, '') <> 'approved'
    and shared.current_staff_roles() is not null
    and (v.requested_by = auth.uid() or shared.module_level('finance') <> 'none');
$$;
revoke all on function ops.advances_open() from public;
grant execute on function ops.advances_open() to authenticated;

-- The requester starts the liquidation of their approved advance: a draft copying its lines, to correct into what
-- was really spent (with the ORs).
create or replace function ops.voucher_liquidate(p_advance uuid)
returns uuid language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  a ops.vouchers;
  v_id uuid;
begin
  select * into a from ops.vouchers where id = p_advance for update;
  if not found or a.requested_by is distinct from auth.uid() or a.kind <> 'cash_advance' or a.status <> 'approved' then
    raise exception 'Only your own approved cash advance is liquidated.' using errcode = '42501';
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

-- 4. Funds: cash on hand and the slips not yet refilled; for Finance's viewers and each fund's custodian.
create or replace function ops.fund_status()
returns table (fund_id uuid, name text, kind text, float_amount numeric, top_up_below numeric, custodian_staff_id uuid, open_count integer, open_amount numeric, cash_on_hand numeric, low boolean)
language sql stable security definer set search_path = ops, shared, pg_temp as $$
  select f.id, f.name, f.kind, f.float_amount, f.top_up_below, f.custodian_staff_id,
         count(v.id)::integer, coalesce(sum(v.total), 0),
         coalesce(f.float_amount, 0) - coalesce(sum(v.total), 0),
         f.top_up_below is not null and coalesce(f.float_amount, 0) - coalesce(sum(v.total), 0) < f.top_up_below
  from ops.cash_funds f
  left join ops.vouchers v on v.fund_id = f.id and v.status = 'approved' and v.kind <> 'fund_topup'
    and (v.replenished_by is null or not exists (select 1 from ops.vouchers t where t.id = v.replenished_by and t.status = 'approved'))
  where f.active and shared.current_staff_roles() is not null
    and (shared.module_level('finance') <> 'none' or f.custodian_staff_id = auth.uid())
  group by f.id;
$$;
revoke all on function ops.fund_status() from public;
grant execute on function ops.fund_status() to authenticated;

-- A top-up: a draft PV for the open slips (one line per account and cost center / program), the slips linked to it.
create or replace function ops.fund_topup_create(p_fund uuid)
returns uuid language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  f ops.cash_funds;
  v_id uuid;
  v_n integer;
begin
  select * into f from ops.cash_funds where id = p_fund and active;
  if not found then
    raise exception 'No such fund in use.' using errcode = 'P0002';
  end if;
  if shared.current_staff_roles() is null or not (shared.module_level('finance') = 'edit' or f.custodian_staff_id = auth.uid()) then
    raise exception 'Only Finance or the fund''s custodian asks for a top-up.' using errcode = '42501';
  end if;
  select count(*) into v_n from ops.vouchers where fund_id = f.id and status = 'approved' and kind <> 'fund_topup' and replenished_by is null;
  if v_n = 0 then
    raise exception 'No slips to refill yet.' using errcode = '23514';
  end if;
  insert into ops.vouchers (kind, purpose, requested_by, t2_id, pay_method, fund_id)
  values ('fund_topup', 'Top-up of ' || f.name || ': ' || v_n || ' slip' || case when v_n = 1 then '' else 's' end, auth.uid(),
          coalesce((select id from ops.fin_codes where tier = 'T2' and code = 'UNR' and active), (select id from ops.fin_codes where tier = 'T2' and active order by sort limit 1)),
          case when f.kind = 'gcash' then 'bank_transfer' else 'cash' end, f.id)
  returning id into v_id;
  insert into ops.voucher_lines (voucher_id, sort, description, qty, unit_cost, amount, account_id, t1_id, t3_id)
  select v_id, row_number() over (order by a.code), coalesce(a.name, 'Uncoded') || ' (' || count(*) || ' line' || case when count(*) = 1 then '' else 's' end || ')', 1, sum(l.amount), sum(l.amount), l.account_id, l.t1_id, l.t3_id
  from ops.voucher_lines l join ops.vouchers v on v.id = l.voucher_id left join ops.coa_accounts a on a.id = l.account_id
  where v.fund_id = f.id and v.status = 'approved' and v.kind <> 'fund_topup' and v.replenished_by is null
  group by l.account_id, a.code, a.name, l.t1_id, l.t3_id;
  update ops.vouchers set total = (select coalesce(sum(amount), 0) from ops.voucher_lines where voucher_id = v_id) where id = v_id;
  update ops.vouchers set replenished_by = v_id where fund_id = f.id and status = 'approved' and kind <> 'fund_topup' and replenished_by is null;
  return v_id;
end $$;
revoke all on function ops.fund_topup_create(uuid) from public;
grant execute on function ops.fund_topup_create(uuid) to authenticated;

-- 5. Saving, acting and preparing learn the new kinds, the overdue rule and withholding (copied from 0134/0135).
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
  -- 0135: paid to a person.
  v_person boolean := coalesce((p_voucher->>'to_person')::boolean, false);
  v_category uuid := nullif(p_voucher->>'recipient_category_id', '')::uuid;
  v_patient uuid := nullif(p_voucher->>'patient_id', '')::uuid;
  v_name text := nullif(btrim(coalesce(p_voucher->>'recipient_name', '')), '');
  v_cat_kind text;
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
  if v_kind is null or v_kind not in ('reimbursement', 'cash_advance', 'supplier', 'petty_cash', 'liquidation') then
    raise exception 'Pick what kind of request this is.' using errcode = '23514';
  end if;
  -- 0138: a liquidation is made from its advance (ops.voucher_liquidate) and keeps it; a top-up is never typed.
  if v_kind = 'liquidation' and (p_id is null or v.kind <> 'liquidation') then
    raise exception 'A liquidation is started from its cash advance.' using errcode = '23514';
  end if;
  if p_id is not null and v.kind in ('liquidation', 'fund_topup') and v_kind <> v.kind then
    raise exception 'This request''s kind can''t change.' using errcode = '23514';
  end if;
  if coalesce((p_voucher->>'urgent')::boolean, false) and length(btrim(coalesce(p_voucher->>'urgent_reason', ''))) = 0 then
    raise exception 'Say why it is urgent.' using errcode = '23514';
  end if;
  -- A person is paid directly (a supplier payment or petty cash); an advance or a reimbursement pays the requester.
  if v_person and v_kind not in ('supplier', 'petty_cash') then
    raise exception 'Only a direct payment or petty cash can go to a person; an advance or a reimbursement goes to you.' using errcode = '23514';
  end if;
  if v_person then
    -- A person, not a supplier: a category Finance keeps, and the person's name (a patient picked from Patients by
    -- someone who may read Patients, or typed).
    select kind into v_cat_kind from ops.recipient_categories where id = v_category and active;
    if v_cat_kind is null then
      raise exception 'Pick who the person is (the recipient category).' using errcode = '23514';
    end if;
    if v_patient is not null then
      if v_cat_kind <> 'patient' or not shared.module_viewable('patients', 'house_ops') then
        raise exception 'A patient can be picked only for a patient payment, by someone who reads Patients.' using errcode = '42501';
      end if;
      select coalesce(v_name, btrim(p.first_name || ' ' || p.last_name)) into v_name from ops.patients p where p.id = v_patient;
      if not found then
        raise exception 'No such patient.' using errcode = 'P0002';
      end if;
    end if;
    if v_name is null or length(v_name) > 160 then
      raise exception 'Give the name of the person to be paid.' using errcode = '23514';
    end if;
    v_payee := null;
  else
    v_category := null; v_patient := null; v_name := null;
  end if;
  if v_kind = 'supplier' and v_payee is null and not v_person then
    raise exception 'Pick the supplier to be paid.' using errcode = '23514';
  end if;
  if v_payee is not null and not exists (select 1 from ops.payees where id = v_payee and active and kind = 'supplier') then
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
  if v_kind in ('cash_advance', 'reimbursement', 'liquidation') then
    select e.employee_code into v_code from hr.employees e where e.staff_id = me;
  end if;

  if p_id is null then
    insert into ops.vouchers (kind, purpose, requested_by, payee_id, fund_id, t2_id, t4_staff_id, t4_code, pay_method, needed_by, urgent, urgent_reason,
                              to_person, recipient_category_id, patient_id, recipient_name)
    values (v_kind, btrim(coalesce(p_voucher->>'purpose', '')), me, v_payee, v_fund, v_t2,
            case when v_kind in ('cash_advance', 'reimbursement', 'liquidation') then me end, v_code,
            coalesce(nullif(p_voucher->>'pay_method', ''), 'cash'), nullif(p_voucher->>'needed_by', '')::date,
            coalesce((p_voucher->>'urgent')::boolean, false), nullif(btrim(coalesce(p_voucher->>'urgent_reason', '')), ''),
            v_person, v_category, v_patient, v_name)
    returning * into v;
  else
    update ops.vouchers set kind = v_kind, purpose = btrim(coalesce(p_voucher->>'purpose', '')), payee_id = v_payee, fund_id = v_fund, t2_id = v_t2,
      t4_staff_id = case when v_kind in ('cash_advance', 'reimbursement', 'liquidation') then me end, t4_code = v_code,
      pay_method = coalesce(nullif(p_voucher->>'pay_method', ''), 'cash'), needed_by = nullif(p_voucher->>'needed_by', '')::date,
      urgent = coalesce((p_voucher->>'urgent')::boolean, false), urgent_reason = nullif(btrim(coalesce(p_voucher->>'urgent_reason', '')), ''),
      to_person = v_person, recipient_category_id = v_category, patient_id = v_patient, recipient_name = v_name
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
    where et.id = nullif(l->>'expense_type_id', '')::uuid and et.active and (not v_person or et.for_person);
    if not found then
      raise exception 'Item %: pick what it is for%.', n, case when v_person then ' (a purpose for paying a person)' else '' end using errcode = '23514';
    end if;
  end loop;
  update ops.vouchers set total = (select coalesce(sum(amount), 0) from ops.voucher_lines where voucher_id = v.id) where id = v.id;
  return v.id;
end $$;
revoke all on function ops.voucher_save(uuid, jsonb, jsonb) from public;
grant execute on function ops.voucher_save(uuid, jsonb, jsonb) to authenticated;

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
    if v.total <= 0 or not exists (select 1 from ops.voucher_lines where voucher_id = v.id) then
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
  -- 0138: a top-up that stops (rejected or cancelled) frees its slips for the next one.
  if v.kind = 'fund_topup' and v_to in ('rejected', 'cancelled') then
    update ops.vouchers set replenished_by = null where replenished_by = v.id;
  end if;
  return v_to;
end $$;
revoke all on function ops.voucher_act(uuid, text, text) from public;
grant execute on function ops.voucher_act(uuid, text, text) to authenticated;

drop function if exists ops.voucher_prepare(uuid, uuid, uuid, jsonb, text);
create or replace function ops.voucher_prepare(p_id uuid, p_t2 uuid, p_t4_staff uuid, p_lines jsonb, p_note text default null, p_payee uuid default null)
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
  update ops.vouchers set payee_id = coalesce(p_payee, payee_id) where id = v.id returning * into v;
  update ops.voucher_lines l set ewt_atc = r.atc, ewt_rate = r.rate, ewt_amount = round(l.amount * r.rate / 100, 2)
  from ops.payees p join ops.ewt_rates r on r.atc = p.ewt_atc and r.active
  where l.voucher_id = v.id and p.id = v.payee_id;
  update ops.voucher_lines set ewt_atc = null, ewt_rate = null, ewt_amount = 0
  where voucher_id = v.id and (v.payee_id is null or not exists (select 1 from ops.payees p join ops.ewt_rates r on r.atc = p.ewt_atc and r.active where p.id = v.payee_id));
  update ops.vouchers set ewt_total = (select coalesce(sum(ewt_amount), 0) from ops.voucher_lines where voucher_id = v.id) where id = v.id;
  insert into ops.voucher_events (voucher_id, action, from_status, to_status, actor, note) values (v.id, 'prepare', 'endorsed', 'prepared', me, nullif(btrim(coalesce(p_note, '')), ''));
  return v.voucher_number;
end $$;
revoke all on function ops.voucher_prepare(uuid, uuid, uuid, jsonb, text, uuid) from public;
grant execute on function ops.voucher_prepare(uuid, uuid, uuid, jsonb, text, uuid) to authenticated;

-- 6. Financial › Funds & advances: Finance edits, the CEO and the Trustees view.
insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level from (values ('finance.funds')) p(page)
cross join (values ('finance', 'edit'), ('office_admin', 'edit'), ('ceo', 'view'), ('board', 'view')) r(role, level)
where exists (select 1 from shared.roles where key = r.role)
on conflict do nothing;

notify pgrst, 'reload schema';
