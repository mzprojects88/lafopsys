-- 0161 Giving from a customer's account on the shop site (user, 18 Nov 2026; decisions 5 to 8).
--
-- A signed-in customer can give a cash gift to the foundation. They choose an amount, pay on the payment
-- partner's page, and the gift is recorded in Donors as a cash gift with its LAF-CSH acknowledgment receipt,
-- numbered at the moment the payment is recorded. The customer sees the gift and its receipt number in their
-- account and can download the receipt.
--
--   pending -> paid -> recorded in Donors (the receipt number)
--   pending -> expired   (not paid within a day; a payment that still arrives is recorded all the same)
--
-- The rules:
--   * A gift is a donation, never a sale: no order, no invoice, no stock.
--   * A named gift joins the donor this customer's earlier gifts went to; else the donor with the same email
--     address; else a new donor. An anonymous gift goes under the anonymous donor: the giver's name is on no
--     receipt and not in the donor list. The shop's own row still says which account paid.
--   * A payment made with the partner's TEST keys (or the stand-in on a developer's computer) is a test gift: it
--     is never recorded in Donors and never takes a receipt number. This is also what keeps the development
--     database, whose ops tables are copied to production every hour, from ever writing a donation.
--   * Recording a gift in Donors never undoes a payment: if it fails, the gift stays paid with a note and the
--     ten-minute job tries again.
--   * An online gift reaches the bank inside the partner's payout, not as a deposit of its own. It is marked
--     'online', and the automatic matching of gifts to deposits and bank lines leaves it alone.

-- 1. An online gift in the donations register.
alter table ops.donations drop constraint if exists donations_payment_method_check;
alter table ops.donations add constraint donations_payment_method_check
  check (payment_method in ('cash', 'check', 'bank_transfer', 'gcash', 'instapay', 'other', 'online'));

-- 2. The automatic matching (0111), unchanged but for one condition in its first two steps: a gift paid online is
-- never matched to a cash deposit. (Its third step already names the methods it matches to bank lines.)
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
     where g.kind = 'cash' and g.deposit_id is null and g.payment_method is distinct from 'online' and nullif(btrim(g.invoice_number), '') is not null
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
     where g.kind = 'cash' and g.deposit_id is null and g.payment_method is distinct from 'online'
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

-- 3. Shop settings: whether giving is open, the amounts offered, and the smallest and largest gift.
alter table shop.settings add column if not exists giving_open boolean not null default false;
alter table shop.settings add column if not exists gift_amounts numeric(12, 2)[] not null default array[200, 500, 1000, 2500]::numeric(12, 2)[];
alter table shop.settings add column if not exists gift_min numeric(12, 2) not null default 100;
alter table shop.settings add column if not exists gift_max numeric(12, 2) not null default 50000;
alter table shop.settings drop constraint if exists settings_giving_check;
alter table shop.settings add constraint settings_giving_check check (
  gift_min >= 1 and gift_max >= gift_min and gift_max <= 1000000
  and cardinality(gift_amounts) between 1 and 6
  and gift_min <= all (gift_amounts) and gift_max >= all (gift_amounts));

-- 4. Gifts. The reference (LAF-GFT-2026-00001) is what the payment partner and the bank papers show; it is not a
-- receipt number. It comes from the shop's own counter, which may skip numbers.
create sequence if not exists shop.gift_refs;
revoke all on sequence shop.gift_refs from public, anon, authenticated;

create table if not exists shop.gifts (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^LAF-GFT-[0-9]{4}-[0-9]{5,}$'),
  customer_id uuid not null references shop.customers (id) on delete restrict deferrable initially immediate,
  amount numeric(12, 2) not null check (amount > 0),
  anonymous boolean not null default false,
  -- The name for the receipt, as the giver confirmed it. An anonymous gift has none.
  receipt_name text check (receipt_name is null or length(btrim(receipt_name)) between 2 and 80),
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired')),
  created_at timestamptz not null default now(),
  -- Payment, as the payment partner reported it.
  pay_session_id text unique check (pay_session_id is null or length(pay_session_id) <= 80),
  pay_payment_id text unique check (pay_payment_id is null or length(pay_payment_id) <= 80),
  pay_method text check (pay_method is null or length(pay_method) <= 40),
  pay_fee numeric(12, 2) check (pay_fee is null or pay_fee >= 0),
  pay_net numeric(12, 2) check (pay_net is null or pay_net >= 0),
  paid_at timestamptz,
  -- False for a payment made with the partner's test keys: a test gift is never recorded in Donors.
  live boolean not null default false,
  -- The acknowledgment receipt, once the gift is in Donors (ops.donations.source_id = 'shop-gift:<id>').
  receipt_no text unique check (receipt_no is null or length(receipt_no) <= 40),
  posted_at timestamptz,
  -- Something staff must look at (for example: the month was closed before the gift could be recorded).
  attention text check (attention is null or length(attention) <= 300),
  check (anonymous <> (receipt_name is not null))
);
create index if not exists gifts_customer on shop.gifts (customer_id, created_at desc);
create index if not exists gifts_to_record on shop.gifts (paid_at) where status = 'paid' and live and receipt_no is null;

alter table shop.gifts enable row level security;
-- Shop viewers read gifts; nobody writes them from the browser.
drop policy if exists "shop viewers read" on shop.gifts;
create policy "shop viewers read" on shop.gifts for select to authenticated using ((select shared.module_viewable('shop')));
revoke all on shop.gifts from public, anon, authenticated;
grant select on shop.gifts to authenticated;
grant all on shop.gifts to service_role;

-- 5. Inside helpers (nobody may call them directly).

-- Records one paid gift in Donors and numbers its receipt. Returns the receipt number, or null when the gift is
-- not one to record (not paid, a test payment, already recorded) or cannot be recorded yet (the month is closed).
create or replace function shop.gift_to_donors(p_gift uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  g shop.gifts%rowtype;
  c shop.customers%rowtype;
  v_day date;
  v_donor uuid;
  v_donation uuid;
  v_number text;
  v_paid_by text;
begin
  select * into g from shop.gifts where id = p_gift for update;
  if not found or g.status <> 'paid' or not g.live or g.receipt_no is not null then return null; end if;
  -- The gift is dated the Manila day it was paid. A closed month takes no new gift: Finance reopens it first.
  v_day := (g.paid_at at time zone 'Asia/Manila')::date;
  if ops.month_is_closed(v_day) then
    update shop.gifts set attention = left(format('Not yet in Donors: %s is closed. Once the month is reopened, this gift is recorded within ten minutes.', to_char(v_day, 'FMMonth YYYY')), 300)
     where id = g.id;
    return null;
  end if;

  if g.anonymous then
    select id into v_donor from ops.donors where type = 'anonymous' order by created_at, id limit 1;
    if v_donor is null then
      insert into ops.donors (name, type, tax_jurisdiction) values ('Anonymous donor', 'anonymous', 'PH') returning id into v_donor;
    end if;
  else
    -- One gift of a customer at a time, so two gifts paid in the same moment cannot each make a donor.
    select * into c from shop.customers where id = g.customer_id for update;
    -- The donor this customer's earlier named gifts went to (it follows a merge of donors and a changed address).
    select d.donor_id into v_donor
      from shop.gifts x
      join ops.donations d on d.source_id = 'shop-gift:' || x.id::text
      join ops.donors n on n.id = d.donor_id and n.type <> 'anonymous'
     where x.customer_id = g.customer_id and not x.anonymous and x.id <> g.id
     order by x.paid_at desc limit 1;
    -- Else the donor with the same email address: the customer has proved that address is theirs.
    if v_donor is null and c.status <> 'closed' then
      select id into v_donor from ops.donors where type <> 'anonymous' and lower(btrim(email)) = c.email order by created_at, id limit 1;
    end if;
    -- Else a new donor. (Never matched by name alone: two people can share a name. The donor list's own clean-up
    -- suggests such pairs to an editor.)
    if v_donor is null then
      insert into ops.donors (name, type, email, phone, tax_jurisdiction)
      values (g.receipt_name, 'individual', case when c.status <> 'closed' then c.email end, case when c.status <> 'closed' then c.phone end, 'PH')
      returning id into v_donor;
    end if;
  end if;

  v_paid_by := case lower(coalesce(g.pay_method, ''))
    when 'gcash' then 'GCash' when 'qrph' then 'QR Ph' when 'card' then 'card' when 'paymaya' then 'Maya' when 'maya' then 'Maya' when 'grab_pay' then 'GrabPay'
    else 'online payment' end;
  insert into ops.donations (donor_id, date, receiving_entity, kind, total_value, currency, status, source_id, payment_method, notes)
  values (v_donor, v_day, 'PH_SEC', 'cash', g.amount, 'PHP', 'finalized', 'shop-gift:' || g.id::text, 'online',
          format('Given through the Little Ark Shop (%s). Reference %s.', v_paid_by, g.reference))
  returning id into v_donation;
  -- Numbered from the same series, in the same way, as ops.issue_cash_ar (0122), which is for signed-in editors.
  v_number := ops.next_doc_number('LAF-CSH', extract(year from v_day)::integer);
  insert into ops.acknowledgment_receipts (donation_id, sequence_number, entity, status, issued_at, amount, currency)
  values (v_donation, v_number, 'PH_SEC', 'issued', now(), g.amount, 'PHP');
  update shop.gifts set receipt_no = v_number, posted_at = now(), attention = null where id = g.id;
  return v_number;
end;
$$;

-- The ten-minute job: lets go of gifts nobody paid, and records the paid ones that could not be recorded at once.
create or replace function shop.gifts_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  update shop.gifts set status = 'expired' where status = 'pending' and created_at < now() - interval '1 day';
  for r in select id from shop.gifts where status = 'paid' and live and receipt_no is null order by paid_at loop
    begin
      if shop.gift_to_donors(r.id) is not null then n := n + 1; end if;
    exception when others then
      update shop.gifts set attention = left('Not yet in Donors: ' || sqlerrm, 300) where id = r.id;
    end;
  end loop;
  return n;
end;
$$;

-- 6. The storefront's functions (the site's login may run these and nothing else).

-- The giving page of the signed-in customer: whether giving is open, the amounts, and their own gifts.
create or replace function shop.web_giving(p_session text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid := shop.session_customer(p_session);
  s shop.settings%rowtype;
  v_year date := date_trunc('year', now() at time zone 'Asia/Manila')::date;
begin
  if v is null then return null; end if;
  select * into s from shop.settings limit 1;
  return jsonb_build_object(
    'open', coalesce(s.giving_open, false), 'amounts', to_jsonb(s.gift_amounts), 'min', s.gift_min, 'max', s.gift_max,
    'name', (select name from shop.customers where id = v),
    'year', extract(year from v_year)::integer,
    'given', (select coalesce(sum(amount), 0) from shop.gifts
               where customer_id = v and status = 'paid' and live and (paid_at at time zone 'Asia/Manila')::date >= v_year),
    'gifts', coalesce((
      select jsonb_agg(x.j order by x.created_at desc, x.reference desc)
        from (select g.created_at, g.reference, jsonb_build_object(
                       'reference', g.reference, 'amount', g.amount, 'anonymous', g.anonymous, 'status', g.status, 'created_at', g.created_at,
                       'paid_at', g.paid_at, 'method', g.pay_method, 'receipt_no', g.receipt_no, 'test', g.status = 'paid' and not g.live,
                       'pay_session_id', case when g.status = 'pending' then g.pay_session_id end) as j
                from shop.gifts g
               where g.customer_id = v and (g.status = 'paid' or (g.status = 'pending' and g.created_at > now() - interval '1 day'))
               order by g.created_at desc, g.reference desc limit 200) x), '[]'::jsonb));
end;
$$;

-- Starts a gift: the amount is checked against the settings, and a gift waiting for payment is made. The answer
-- carries what the payment page needs.
create or replace function shop.web_gift_start(p_session text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid := shop.session_customer(p_session);
  s shop.settings%rowtype;
  c shop.customers%rowtype;
  g shop.gifts%rowtype;
  v_amount numeric;
  v_anonymous boolean;
  v_name text;
begin
  if v is null then return jsonb_build_object('ok', false, 'error', 'signed_out'); end if;
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p -> 'amount') is distinct from 'number' then
    raise exception 'The gift is not readable' using errcode = '22023';
  end if;
  select * into s from shop.settings limit 1;
  if not coalesce(s.giving_open, false) then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  v_amount := (p ->> 'amount')::numeric;
  if v_amount <> round(v_amount, 2) or v_amount < s.gift_min or v_amount > s.gift_max then
    return jsonb_build_object('ok', false, 'error', 'amount', 'min', s.gift_min, 'max', s.gift_max);
  end if;
  v_anonymous := coalesce((p -> 'anonymous') = 'true'::jsonb, false);
  select * into c from shop.customers where id = v for update;
  if v_anonymous then
    v_name := null;
  else
    v_name := coalesce(nullif(regexp_replace(btrim(coalesce(p ->> 'name', '')), '\s+', ' ', 'g'), ''), c.name);
    -- The name goes on a receipt and into the donor list: no control characters, and none of the invisible ones
    -- that reorder or hide text.
    if v_name is null or length(v_name) not between 2 and 80 or v_name ~ '[[:cntrl:]​-‏‪-‮⁦-⁩]' then
      return jsonb_build_object('ok', false, 'error', 'name');
    end if;
    -- A first gift's name becomes the account's name when it has none.
    if c.name is null then update shop.customers set name = v_name where id = v; end if;
  end if;
  update shop.gifts set status = 'expired' where status = 'pending' and created_at < now() - interval '1 day';
  if (select count(*) from shop.gifts where customer_id = v and created_at > now() - interval '1 hour') >= 6 then
    return jsonb_build_object('ok', false, 'error', 'limit');
  end if;
  insert into shop.gifts (reference, customer_id, amount, anonymous, receipt_name)
  values ('LAF-GFT-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' || lpad(nextval('shop.gift_refs')::text, 5, '0'), v, v_amount, v_anonymous, v_name)
  returning * into g;
  return jsonb_build_object('ok', true, 'reference', g.reference, 'amount', g.amount, 'email', c.email, 'name', coalesce(c.name, v_name), 'phone', c.phone);
end;
$$;

-- Notes the payment session the site opened for a gift (so the partner's notice can be matched).
create or replace function shop.web_gift_attach(p_session text, p_reference text, p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid := shop.session_customer(p_session);
  n integer;
begin
  if p_session_id is null or p_session_id !~ '^[A-Za-z0-9_]{6,80}$' then
    raise exception 'The payment session is not readable' using errcode = '22023';
  end if;
  if v is null then return jsonb_build_object('ok', false, 'error', 'signed_out'); end if;
  update shop.gifts set pay_session_id = p_session_id
   where reference = p_reference and customer_id = v and status = 'pending' and pay_session_id is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n = 1);
end;
$$;

-- Records the payment of a gift, once, and records the gift in Donors when the payment was a live one. The site
-- calls this only after checking the partner's signature and reading the session back from the partner. Amounts
-- are in centavos, as the partner sends them.
create or replace function shop.web_gift_paid(p_reference text, p_session_id text, p_payment_id text, p_amount bigint, p_method text, p_fee bigint, p_net bigint, p_live boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g shop.gifts%rowtype;
begin
  if p_reference is null or p_session_id is null or p_payment_id is null or p_amount is null
     or p_payment_id !~ '^[A-Za-z0-9_]{6,80}$' or p_session_id !~ '^[A-Za-z0-9_]{6,80}$' then
    raise exception 'The payment is not readable' using errcode = '22023';
  end if;
  select * into g from shop.gifts where reference = p_reference for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown'); end if;
  if g.pay_payment_id is not null then
    -- The same notice again (the partner sends each at least once), or a second payment for one gift.
    return jsonb_build_object('ok', g.pay_payment_id = p_payment_id, 'already', true, 'error', case when g.pay_payment_id = p_payment_id then null else 'second payment' end);
  end if;
  if g.pay_session_id is distinct from p_session_id then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if p_amount <> round(g.amount * 100) then
    update shop.gifts set attention = left(format('A payment of %s arrived for this gift of %s: check with the payment partner', to_char(p_amount / 100.0, 'FM999,999,990.00'), to_char(g.amount, 'FM999,999,990.00')), 300)
     where id = g.id;
    return jsonb_build_object('ok', false, 'error', 'amount');
  end if;

  update shop.gifts
     set status = 'paid', paid_at = now(), pay_payment_id = p_payment_id, pay_method = left(coalesce(p_method, ''), 40),
         pay_fee = case when p_fee is null then null else p_fee / 100.0 end, pay_net = case when p_net is null then null else p_net / 100.0 end,
         live = coalesce(p_live, false), attention = null
   where id = g.id;
  insert into shop.customer_events (customer_id, event, detail)
  values (g.customer_id, 'gift', format('%s, %s%s', g.reference, to_char(g.amount, 'FM999,999,990.00'), case when coalesce(p_live, false) then '' else ', test payment' end));
  if coalesce(p_live, false) then
    -- The payment is recorded whatever happens next: a failure here leaves a note, and the job tries again.
    begin
      perform shop.gift_to_donors(g.id);
    exception when others then
      update shop.gifts set attention = left('Not yet in Donors: ' || sqlerrm, 300) where id = g.id;
    end;
  end if;
  return jsonb_build_object('ok', true, 'already', false);
end;
$$;

-- What the customer's own receipt prints: the same figures and lines as the receipt ArkOS prints for this gift.
-- Null unless the gift is this customer's and has its receipt.
create or replace function shop.web_gift_receipt(p_session text, p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid := shop.session_customer(p_session);
begin
  if v is null or p_reference is null or p_reference !~ '^LAF-GFT-[0-9]{4}-[0-9]{5,}$' then return null; end if;
  return (
    select jsonb_build_object(
      'number', a.sequence_number, 'paper_number', a.booklet_number, 'date', d.date, 'donor', n.name,
      'amount', coalesce(a.amount, d.total_value), 'currency', coalesce(a.currency, d.currency), 'method', d.payment_method, 'notes', d.notes,
      'title', st.cash_receipt_title, 'purpose', st.cash_receipt_purpose, 'header', st.report_header,
      'accreditation', case when nullif(btrim(st.dswd_number), '') is not null
                            then coalesce(nullif(btrim(st.dswd_label), ''), 'DSWD Accreditation No.') || ' ' || btrim(st.dswd_number) end)
      from shop.gifts g
      join ops.donations d on d.source_id = 'shop-gift:' || g.id::text
      join ops.acknowledgment_receipts a on a.donation_id = d.id and a.status <> 'draft'
      join ops.donors n on n.id = d.donor_id
      left join (select * from shared.app_settings limit 1) st on true
     where g.customer_id = v and g.reference = p_reference and g.receipt_no is not null
     order by a.created_at limit 1);
end;
$$;

revoke all on function shop.gift_to_donors(uuid), shop.gifts_sweep(), shop.web_giving(text), shop.web_gift_start(text, jsonb), shop.web_gift_attach(text, text, text), shop.web_gift_paid(text, text, text, bigint, text, bigint, bigint, boolean), shop.web_gift_receipt(text, text) from public, anon, authenticated, shop_web;
grant execute on function shop.web_giving(text) to shop_web;
grant execute on function shop.web_gift_start(text, jsonb) to shop_web;
grant execute on function shop.web_gift_attach(text, text, text) to shop_web;
grant execute on function shop.web_gift_paid(text, text, text, bigint, text, bigint, bigint, boolean) to shop_web;
grant execute on function shop.web_gift_receipt(text, text) to shop_web;
grant execute on all functions in schema shop to service_role;

-- 7. The ten-minute job, on production only (the database that runs the other scheduled jobs).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'house-sheet-sync') and not exists (select 1 from cron.job where jobname = 'shop-gifts') then
    perform cron.schedule('shop-gifts', '*/10 * * * *', 'select shop.gifts_sweep()');
  end if;
end $$;

-- 8. Live updates in ArkOS.
do $$
begin
  alter publication supabase_realtime add table shop.gifts;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
