-- 0135 Voucher System, phase 2b: paying a person (decided 11 Nov 2026).
--
-- A requester switches "Payment goes to a person" (a patient's family paid burial aid, a counsellor, a tutor...):
-- they pick who the person is from recipient categories Finance keeps (patient, service provider, others), give
-- the person (a patient picked from Patients by those who may read Patients, or a typed name), and the purposes
-- are the expense types Finance marks "paid to a person", each pointing at its account (burial 5501, financial
-- aid 5503...). The person's name is seen by the requester, Finance, the signers and the printout only (decided
-- 11 Nov); people never appear in the requesters' supplier list (0134).

-- 1. The categories (Financial Settings › Paying people), a setup list like the others (0133).
create table if not exists ops.recipient_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  kind text not null default 'other' check (kind in ('patient', 'provider', 'other')),
  sort integer not null default 0,
  active boolean not null default true,
  review_note text check (length(review_note) <= 1000),
  updated_at timestamptz not null default now()
);
insert into ops.recipient_categories (id, name, kind, sort, review_note) values
  (md5('recipient:patient')::uuid, 'Patient or family', 'patient', 1, 'Proposed by the app: confirm it or change it.'),
  (md5('recipient:provider')::uuid, 'Service provider (a person)', 'provider', 2, 'Proposed by the app: confirm it or change it.'),
  (md5('recipient:other')::uuid, 'Other', 'other', 3, 'Proposed by the app: confirm it or change it.')
on conflict (id) do nothing;

alter table ops.recipient_categories enable row level security;
drop policy if exists "staff read" on ops.recipient_categories;
drop policy if exists "finance setup adds" on ops.recipient_categories;
drop policy if exists "finance setup changes" on ops.recipient_categories;
drop policy if exists "finance setup removes" on ops.recipient_categories;
create policy "staff read" on ops.recipient_categories for select to authenticated using ((select shared.current_staff_roles()) is not null);
create policy "finance setup adds" on ops.recipient_categories for insert to authenticated with check ((select shared.has_power('finance_setup')));
create policy "finance setup changes" on ops.recipient_categories for update to authenticated using ((select shared.has_power('finance_setup'))) with check ((select shared.has_power('finance_setup')));
create policy "finance setup removes" on ops.recipient_categories for delete to authenticated using ((select shared.has_power('finance_setup')));
grant select, insert, update, delete on ops.recipient_categories to authenticated;
drop trigger if exists set_updated_at on ops.recipient_categories;
create trigger set_updated_at before update on ops.recipient_categories for each row execute function shared.set_updated_at();
drop trigger if exists log_finance_setup on ops.recipient_categories;
create trigger log_finance_setup after insert or update or delete on ops.recipient_categories for each row execute function ops.log_finance_setup();

-- 2. The purposes: the expense types Finance marks "paid to a person" (proposed: the Nurture assistance accounts
-- and volunteers' allowances; their review notes from 0133 still stand).
alter table ops.expense_types add column if not exists for_person boolean not null default false;
update ops.expense_types set for_person = true
where id in (select md5('exp:' || l || ':code:T3:' || u)::uuid from (values
  ('Burial and bereavement', 'NWB'), ('Counselling fee', 'NWB'), ('Emergency financial or medical assistance', 'NWB'),
  ('Recovery assistance: tuition, uniforms, books', 'NWB'), ('Volunteer allowance and transport', 'CCT')) x(l, u));

-- 3. The request: the switch, who the person is, and their name as it was given.
alter table ops.vouchers
  add column if not exists to_person boolean not null default false,
  add column if not exists recipient_category_id uuid references ops.recipient_categories(id) on delete restrict deferrable initially immediate,
  add column if not exists patient_id uuid references ops.patients(id) on delete restrict deferrable initially immediate,
  add column if not exists recipient_name text check (length(recipient_name) <= 160);
alter table ops.vouchers drop constraint if exists vouchers_person_check;
alter table ops.vouchers add constraint vouchers_person_check
  check (not to_person or source = 'sheet' or (recipient_category_id is not null and recipient_name is not null and payee_id is null));

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
  if v_kind is null or v_kind not in ('reimbursement', 'cash_advance', 'supplier', 'petty_cash') then
    raise exception 'Pick what kind of request this is.' using errcode = '23514';
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
  if v_kind in ('cash_advance', 'reimbursement') then
    select e.employee_code into v_code from hr.employees e where e.staff_id = me;
  end if;

  if p_id is null then
    insert into ops.vouchers (kind, purpose, requested_by, payee_id, fund_id, t2_id, t4_staff_id, t4_code, pay_method, needed_by, urgent, urgent_reason,
                              to_person, recipient_category_id, patient_id, recipient_name)
    values (v_kind, btrim(coalesce(p_voucher->>'purpose', '')), me, v_payee, v_fund, v_t2,
            case when v_kind in ('cash_advance', 'reimbursement') then me end, v_code,
            coalesce(nullif(p_voucher->>'pay_method', ''), 'cash'), nullif(p_voucher->>'needed_by', '')::date,
            coalesce((p_voucher->>'urgent')::boolean, false), nullif(btrim(coalesce(p_voucher->>'urgent_reason', '')), ''),
            v_person, v_category, v_patient, v_name)
    returning * into v;
  else
    update ops.vouchers set kind = v_kind, purpose = btrim(coalesce(p_voucher->>'purpose', '')), payee_id = v_payee, fund_id = v_fund, t2_id = v_t2,
      t4_staff_id = case when v_kind in ('cash_advance', 'reimbursement') then me end, t4_code = v_code,
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

-- Possible duplicates (0134's rule) also know people: two live requests paying the same patient, or the same
-- person by name, for the same total within 30 days, whoever filed them.
create or replace function ops.voucher_similar(p_id uuid)
returns integer language sql stable security definer set search_path = ops, pg_temp as $$
  select count(*)::integer from ops.vouchers o, ops.vouchers v
  where v.id = p_id and ops.can_read_voucher(v.requested_by, v.status, v.requester_role)
    and o.id <> v.id and o.status not in ('draft', 'cancelled', 'rejected')
    and (exists (select 1 from ops.voucher_lines a join ops.voucher_lines b on lower(a.or_number) = lower(b.or_number)
                 where a.voucher_id = v.id and b.voucher_id = o.id)
         or (o.total = v.total and v.total > 0 and abs(extract(epoch from (o.created_at - v.created_at))) <= 30 * 86400
             and (case
                    when v.to_person then o.to_person and (o.patient_id = v.patient_id or lower(btrim(o.recipient_name)) = lower(btrim(v.recipient_name)))
                    else not o.to_person and (o.payee_id = v.payee_id or (v.payee_id is null and o.payee_id is null and o.requested_by = v.requested_by))
                  end)));
$$;
revoke all on function ops.voucher_similar(uuid) from public;
grant execute on function ops.voucher_similar(uuid) to authenticated;

-- How often each account was used on vouchers, for the AI suggestions (counts only; whoever sets up Finance).
create or replace function ops.voucher_line_counts()
returns table (code text, lines integer) language sql stable security definer set search_path = ops, shared, pg_temp as $$
  select a.code, count(*)::integer
  from ops.voucher_lines l join ops.coa_accounts a on a.id = l.account_id
  where shared.has_power('finance_setup') and a.code is not null
  group by a.code;
$$;
revoke all on function ops.voucher_line_counts() from public;
grant execute on function ops.voucher_line_counts() to authenticated;

-- 4. The setup checklist counts the categories with the expense types.
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

  -- 0135: the recipient categories are confirmed with the expense types.
  select count(*) filter (where e.review_note is not null) + (select count(*) from ops.recipient_categories where review_note is not null and active),
         string_agg(distinct e.label, ', ') filter (where a.is_header or not a.active or u.tier = 'T2' or not u.active)
    into n, v_list
    from ops.expense_types e join ops.coa_accounts a on a.id = e.account_id join ops.fin_codes u on u.id = e.use_id where e.active;
  v_items := v_items || jsonb_build_object('key', 'expense_types', 'label', 'Expense types and recipient categories confirmed', 'done', n = 0 and v_list is null,
    'detail', concat_ws(' ',
      case when n = 1 then '1 expense type or recipient category to confirm.' when n > 1 then n || ' expense types and recipient categories to confirm.' end,
      case when v_list is not null then 'Pointing at a heading or switched-off account, or at a donor fund or switched-off code instead of a program or cost center: ' || v_list || '.' end,
      case when n = 0 and v_list is null then 'Every expense type and recipient category is confirmed.' end));

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
  if not exists (select 1 from ops.cash_funds where active and kind = 'petty_cash') then
    v_list := concat_ws('; ', 'No petty cash fund in use', v_list);
  end if;
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

do $$ begin
  alter publication supabase_realtime add table ops.recipient_categories;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
