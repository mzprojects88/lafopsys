-- 0140 Voucher System, polish 1 (12 Nov 2026): Finance picks the fund, and Financial › Ledger.
--
-- The user: "The requester is not the one who decides where the funds come from: the fund source for the Payment
-- Voucher is the Finance staff." A request is saved without a fund; Finance picks it when preparing the voucher
-- (ops.voucher_prepare already requires it). And a Ledger page where Finance follows every request and voucher by
-- its codes: Finance and the Office Admin work in it, the CEO and the Trustees view it.

-- 1. Saving a request no longer takes a fund (copied from 0138).
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
  -- 0140: Finance picks the fund (T2) when it prepares the voucher; whatever a requester sends is ignored. A new
  -- request has none; one sent back keeps the fund Finance chose (or, for a liquidation, its advance's).
  v_t2 := case when p_id is null then null else v.t2_id end;
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

-- 2. Financial › Ledger.
insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level from (values ('finance.ledger')) p(page)
cross join (values ('finance', 'edit'), ('office_admin', 'edit'), ('ceo', 'view'), ('board', 'view')) r(role, level)
where exists (select 1 from shared.roles where key = r.role)
on conflict do nothing;

notify pgrst, 'reload schema';
