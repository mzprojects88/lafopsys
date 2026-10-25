-- 0111: cash reconciliation -- gift <-> deposit <-> bank credit (user, 2026-10-25; part C of the plan).
--
-- After every tracker read the unambiguous links are made by themselves; what is left shows on
-- Finance > Approvals as "To reconcile", where a finance or donors editor links a bank credit to a
-- gift or a deposit, or marks it "not a donation" (a transfer between accounts, a sale).
alter table ops.bank_transactions add column deposit_id uuid references ops.cash_deposits (id) on delete set null;
create index bank_transactions_deposit_idx on ops.bank_transactions (deposit_id) where deposit_id is not null;

-- The automatic pass. Each rule links only when exactly one candidate fits on each side:
--   1. gift <-> deposit by the paper invoice number;
--   2. gift <-> deposit by amount within three days;
--   3. bank credit <-> gift (paid by bank transfer, check, GCash or InstaPay) by amount within three days;
--   4. bank credit <-> deposit by amount within three days (cash gifts reach the bank as a deposit).
create or replace function ops.auto_reconcile_cash()
returns jsonb language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
declare
  n1 integer; n2 integer; n3 integer; n4 integer;
begin
  if not (shared.module_editable('finance') or shared.module_editable('donors') or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Only finance or donors editors reconcile.' using errcode = '42501';
  end if;

  with pairs as (
    select g.id as gift_id, d.id as deposit_id
      from ops.donations g
      join ops.cash_deposits d on upper(btrim(d.invoice_number)) = upper(btrim(g.invoice_number))
     where g.kind = 'cash' and g.deposit_id is null and nullif(btrim(g.invoice_number), '') is not null
       and not exists (select 1 from ops.donations x where x.deposit_id = d.id)
  ), unique_pairs as (
    select gift_id, (array_agg(deposit_id))[1] as deposit_id from pairs group by gift_id having count(*) = 1
  )
  update ops.donations g set deposit_id = u.deposit_id
    from unique_pairs u
   where g.id = u.gift_id and (select count(*) from unique_pairs v where v.deposit_id = u.deposit_id) = 1;
  get diagnostics n1 = row_count;

  with pairs as (
    select g.id as gift_id, d.id as deposit_id
      from ops.donations g
      join ops.cash_deposits d on d.amount = g.total_value and abs(d.deposit_date - g.date) <= 3
     where g.kind = 'cash' and g.deposit_id is null
       and not exists (select 1 from ops.donations x where x.deposit_id = d.id)
  ), unique_pairs as (
    select gift_id, (array_agg(deposit_id))[1] as deposit_id from pairs group by gift_id having count(*) = 1
  )
  update ops.donations g set deposit_id = u.deposit_id
    from unique_pairs u
   where g.id = u.gift_id and (select count(*) from unique_pairs v where v.deposit_id = u.deposit_id) = 1;
  get diagnostics n2 = row_count;

  with pairs as (
    select b.id as bank_id, g.id as gift_id
      from ops.bank_transactions b
      join ops.donations g on g.kind = 'cash' and g.total_value = b.credit and abs(b.posting_date - g.date) <= 3
     where b.credit > 0 and b.donation_id is null and b.deposit_id is null and b.category is null
       and g.payment_method in ('bank_transfer', 'check', 'gcash', 'instapay')
       and not exists (select 1 from ops.bank_transactions x where x.donation_id = g.id)
  ), unique_pairs as (
    select bank_id, (array_agg(gift_id))[1] as gift_id from pairs group by bank_id having count(*) = 1
  )
  update ops.bank_transactions b set donation_id = u.gift_id, needs_review = false
    from unique_pairs u
   where b.id = u.bank_id and (select count(*) from unique_pairs v where v.gift_id = u.gift_id) = 1;
  get diagnostics n3 = row_count;

  with pairs as (
    select b.id as bank_id, d.id as deposit_id
      from ops.bank_transactions b
      join ops.cash_deposits d on d.amount = b.credit and abs(b.posting_date - d.deposit_date) <= 3
     where b.credit > 0 and b.donation_id is null and b.deposit_id is null and b.category is null
       and not exists (select 1 from ops.bank_transactions x where x.deposit_id = d.id)
  ), unique_pairs as (
    select bank_id, (array_agg(deposit_id))[1] as deposit_id from pairs group by bank_id having count(*) = 1
  )
  update ops.bank_transactions b set deposit_id = u.deposit_id, needs_review = false
    from unique_pairs u
   where b.id = u.bank_id and (select count(*) from unique_pairs v where v.deposit_id = u.deposit_id) = 1;
  get diagnostics n4 = row_count;

  return jsonb_build_object('gift_deposit_by_invoice', n1, 'gift_deposit_by_amount', n2, 'bank_gift', n3, 'bank_deposit', n4);
end;
$$;
revoke all on function ops.auto_reconcile_cash() from public, anon;
grant execute on function ops.auto_reconcile_cash() to authenticated, service_role;

-- One bank credit, decided by a person: a gift, a deposit, "not a donation", or cleared again.
create or replace function ops.reconcile_bank_credit(p_bank_id uuid, p_donation_id uuid default null, p_deposit_id uuid default null, p_not_donation boolean default false)
returns void language plpgsql security definer
set search_path to 'ops', 'pg_temp' as $$
begin
  if not (shared.module_editable('finance') or shared.module_editable('donors')) then
    raise exception 'Only finance or donors editors reconcile.' using errcode = '42501';
  end if;
  if p_donation_id is not null and p_deposit_id is not null then
    raise exception 'Link a credit to a gift or to a deposit, not both.' using errcode = '22023';
  end if;
  if p_donation_id is not null and not exists (select 1 from ops.donations where id = p_donation_id and kind = 'cash') then
    raise exception 'That gift is not a cash gift.' using errcode = '22023';
  end if;
  update ops.bank_transactions
     set donation_id = p_donation_id,
         deposit_id = p_deposit_id,
         category = case when p_not_donation then 'transfer' else null end,
         needs_review = false,
         review_reason = case when p_not_donation then 'Not a donation (marked by hand)' else null end
   where id = p_bank_id and credit > 0;
  if not found then
    raise exception 'Bank credit not found.' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function ops.reconcile_bank_credit(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function ops.reconcile_bank_credit(uuid, uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
