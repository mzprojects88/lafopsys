-- 0157 The shop, part 3: what staff do with an order, the emails, the policy texts and the proceeds
-- (user, 17 Nov 2026; ArkOS > Shop > Orders and Proceeds).
--
--   paid -> packed -> shipped (courier, with its tracking number) or ready (pick-up) -> delivered
--   placed -> cancelled            (before payment; the held pieces go back on sale)
--   paid, packed, shipped, ready, delivered -> refunded   (with a reason; staff say whether the pieces go back)
--
-- Each step is one function, shop.order_step, open to people who may edit the Shop; it records who did it and when.
-- The refund itself is made in the payment partner's own dashboard: this records that it was done.
--
-- Emails to the customer (paid, shipped, ready, delivered, cancelled, refunded) are written by the database into
-- the shop's own outbox when the order changes, and sent by ArkOS's email sender. The outbox is in the shop schema
-- on purpose: ops.outbox is carried between development and production every hour, and a test order's email must
-- never be sent from production.
--
-- Proceeds: a paid order shows what was sold, what the payment partner kept and what is left. Finance posts a day's
-- proceeds to the cash book (one inflow for the day, the amount that reached the foundation after the partner's fee),
-- once Shop settings switch that on. It starts off.

-- 1. Settings: the couriers staff choose from, the site's address (for links in emails) and the policy texts.
alter table shop.settings add column if not exists couriers text[] not null default array['LBC', 'Ninja Van', 'J&T Express'];
alter table shop.settings add column if not exists site_url text not null default 'https://shop.littlearkfoundation.org';
alter table shop.settings add column if not exists terms_text text not null default '';
alter table shop.settings add column if not exists privacy_text text not null default '';
alter table shop.settings add column if not exists returns_text text not null default '';
-- Posting proceeds to the cash book stays off until Finance and the accountant agree how shop sales are booked.
-- It also keeps a development copy (whose orders are test orders) from ever writing into the shared cash book.
alter table shop.settings add column if not exists cash_posting boolean not null default false;
alter table shop.settings drop constraint if exists settings_fulfilment_check;
alter table shop.settings add constraint settings_fulfilment_check check (
  cardinality(couriers) <= 12 and site_url ~ '^https?://[a-z0-9.:-]+$' and length(site_url) <= 120
  and length(terms_text) <= 8000 and length(privacy_text) <= 8000 and length(returns_text) <= 8000);

-- 2. Orders: what the staff steps record.
alter table shop.orders add column if not exists tracking_url text;
alter table shop.orders add column if not exists refund_reason text;
alter table shop.orders add column if not exists restocked boolean;
-- The cash book entry a day's proceeds were posted under ('shop:2026-11-17'); empty until Finance posts that day.
alter table shop.orders add column if not exists posted_source_id text;
alter table shop.orders drop constraint if exists orders_fulfilment_check;
alter table shop.orders add constraint orders_fulfilment_check check (
  (tracking_url is null or (tracking_url ~ '^https://' and length(tracking_url) <= 300))
  and (refund_reason is null or length(refund_reason) between 5 and 300)
  and (posted_source_id is null or posted_source_id ~ '^shop:\d{4}-\d{2}-\d{2}$'));

-- 3. The shop's own email outbox (the same shape as ops.outbox, 0118).
create table if not exists shop.outbox (
  id uuid primary key default gen_random_uuid(),
  to_address text not null check (to_address ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(to_address) <= 200),
  subject text not null check (length(subject) between 1 and 200),
  body_html text not null,
  source text,
  status text not null default 'queued' check (status in ('queued', 'held', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists outbox_status on shop.outbox (status, created_at);
alter table shop.outbox enable row level security;
drop policy if exists "shop viewers read" on shop.outbox;
create policy "shop viewers read" on shop.outbox for select to authenticated using ((select shared.module_viewable('shop')));
revoke all on shop.outbox from public, anon, authenticated;
grant select on shop.outbox to authenticated;
grant all on shop.outbox to service_role;

-- Text typed by a customer or by staff, made safe to put inside an email's HTML.
create or replace function shop.html(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

-- When an order becomes paid, shipped, ready, delivered, cancelled or refunded, the customer is told.
create or replace function shop.queue_order_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site text;
  v_subject text;
  v_lead text;
  v_extra text := '';
begin
  if new.status is not distinct from old.status then return new; end if;
  select site_url into v_site from shop.settings;
  case new.status
    when 'paid' then
      v_subject := format('We have your order %s', new.number);
      v_lead := 'Thank you. Your payment arrived and your order is being prepared.';
    when 'shipped' then
      v_subject := format('Your order %s is on its way', new.number);
      v_lead := 'Your order has been handed to the courier.';
      v_extra := format('<p><b>Courier:</b> %s<br><b>Tracking number:</b> %s</p>', shop.html(new.courier), shop.html(new.tracking_number))
        || case when new.tracking_url is not null then format('<p><a href="%s">Track your parcel</a></p>', shop.html(new.tracking_url)) else '' end;
    when 'ready' then
      v_subject := format('Your order %s is ready for pick-up', new.number);
      v_lead := 'Your order is packed and waiting for you.';
      select v_extra || case when pickup_address <> '' then format('<p><b>Where:</b> %s</p>', shop.html(pickup_address)) else '' end
                     || case when pickup_note <> '' then format('<p><b>When:</b> %s</p>', shop.html(pickup_note)) else '' end
        into v_extra from shop.settings;
    when 'delivered' then
      v_subject := format('Your order %s has arrived', new.number);
      v_lead := case when new.delivery = 'pickup' then 'Your order was picked up. Thank you for coming aboard.' else 'Your order was delivered. Thank you for coming aboard.' end;
    when 'cancelled' then
      v_subject := format('Your order %s was cancelled', new.number);
      v_lead := 'Your order was cancelled before payment. Nothing was charged.';
    when 'refunded' then
      v_subject := format('Your order %s was refunded', new.number);
      v_lead := 'Your order was refunded. The money goes back the way you paid; it can take a few days to show.';
    else
      return new;
  end case;
  -- An email that cannot be queued must never undo a payment or a staff step: the order's change stands.
  begin
  insert into shop.outbox (to_address, subject, source, body_html)
  values (new.email, v_subject, 'shop:' || new.status,
    format('<div style="font-family:Arial,Helvetica,sans-serif;color:#082f59;max-width:560px">'
        || '<p>Hello %s,</p><p>%s</p>%s'
        || '<p><b>Order %s</b><br>Total: PHP %s</p>'
        || '<p><a href="%s/order/%s" style="display:inline-block;background:#ffc83d;color:#031427;font-weight:bold;padding:12px 22px;border-radius:999px;text-decoration:none">See your order</a></p>'
        || '<p style="color:#4a6478;font-size:13px">Keep this link private: anyone who has it can see this order. A purchase is a sale, not a donation.<br>Little Ark Foundation, Inc.</p></div>',
      shop.html(new.name), v_lead, v_extra, shop.html(new.number), to_char(new.total, 'FM999,999,990.00'), v_site, new.token));
  exception when others then
    raise warning 'shop: the % email for order % was not queued: %', new.status, new.number, sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists queue_order_email on shop.orders;
create trigger queue_order_email after update of status on shop.orders for each row execute function shop.queue_order_email();

-- 4. The staff steps.
create or replace function shop.order_step(p_order uuid, p_step text, p_data jsonb default '{}'::jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o shop.orders%rowtype;
  v_courier text := nullif(btrim(coalesce(p_data ->> 'courier', '')), '');
  v_tracking text := nullif(btrim(coalesce(p_data ->> 'tracking_number', '')), '');
  v_url text := nullif(btrim(coalesce(p_data ->> 'tracking_url', '')), '');
  v_invoice text := nullif(btrim(coalesce(p_data ->> 'invoice_number', '')), '');
  v_reason text := nullif(btrim(coalesce(p_data ->> 'reason', '')), '');
  v_restock boolean := coalesce((p_data ->> 'restock')::boolean, false);
  v_detail text;
begin
  if not shared.module_editable('shop') then
    raise exception 'Only people who may edit the Shop work on orders' using errcode = '42501';
  end if;
  select * into o from shop.orders where id = p_order for update;
  if not found then raise exception 'That order was not found' using errcode = 'P0002'; end if;

  if p_step = 'pack' then
    if o.status <> 'paid' then raise exception 'Only a paid order can be packed (this one is %)', o.status using errcode = '23514'; end if;
    update shop.orders set status = 'packed', packed_at = now() where id = o.id;
    v_detail := null;
  elsif p_step = 'ship' then
    if o.delivery <> 'courier' then raise exception 'This order is for pick-up: mark it ready instead' using errcode = '23514'; end if;
    if o.status <> 'packed' then raise exception 'Pack the order before shipping it (this one is %)', o.status using errcode = '23514'; end if;
    if v_courier is null or length(v_courier) > 40 then raise exception 'Choose the courier' using errcode = '22023'; end if;
    if v_tracking is null or length(v_tracking) > 60 then raise exception 'Enter the tracking number from the waybill' using errcode = '22023'; end if;
    if v_url is not null and (v_url !~ '^https://' or length(v_url) > 300) then raise exception 'The tracking link must start with https://' using errcode = '22023'; end if;
    update shop.orders set status = 'shipped', shipped_at = now(), courier = v_courier, tracking_number = v_tracking, tracking_url = v_url where id = o.id;
    v_detail := format('%s, %s', v_courier, v_tracking);
  elsif p_step = 'ready' then
    if o.delivery <> 'pickup' then raise exception 'This order is for delivery: ship it instead' using errcode = '23514'; end if;
    if o.status <> 'packed' then raise exception 'Pack the order before marking it ready (this one is %)', o.status using errcode = '23514'; end if;
    update shop.orders set status = 'ready', shipped_at = now() where id = o.id;
    v_detail := null;
  elsif p_step = 'deliver' then
    if o.status not in ('shipped', 'ready') then raise exception 'Only an order that was shipped or is ready can be marked delivered (this one is %)', o.status using errcode = '23514'; end if;
    update shop.orders set status = 'delivered', delivered_at = now(), closed_at = now() where id = o.id;
    v_detail := case when o.delivery = 'pickup' then 'Picked up' else null end;
  elsif p_step = 'invoice' then
    if o.status not in ('paid', 'packed', 'shipped', 'ready', 'delivered') then raise exception 'An invoice goes with a paid order' using errcode = '23514'; end if;
    if v_invoice is null or length(v_invoice) > 40 then raise exception 'Enter the sales invoice number' using errcode = '22023'; end if;
    update shop.orders set invoice_number = v_invoice where id = o.id;
    v_detail := v_invoice;
  elsif p_step = 'looked' then
    -- Staff have dealt with what the order flagged (for example a payment that arrived after the hold ended).
    if o.attention is null then raise exception 'Nothing is flagged on this order' using errcode = '23514'; end if;
    if v_reason is null or length(v_reason) not between 5 and 300 then raise exception 'Say in a few words what was done' using errcode = '22023'; end if;
    update shop.orders set attention = null where id = o.id;
    v_detail := v_reason;
  elsif p_step = 'cancel' then
    if o.status <> 'placed' then raise exception 'Only an unpaid order is cancelled; a paid one is refunded' using errcode = '23514'; end if;
    update shop.variants v set held = greatest(v.held - i.qty, 0)
      from shop.order_items i where i.order_id = o.id and i.counted and i.variant_id = v.id;
    update shop.orders set status = 'cancelled', closed_at = now() where id = o.id;
    v_detail := coalesce(v_reason, 'Cancelled before payment');
  elsif p_step = 'refund' then
    if o.status not in ('paid', 'packed', 'shipped', 'ready', 'delivered') then raise exception 'Only a paid order is refunded (this one is %)', o.status using errcode = '23514'; end if;
    if v_reason is null or length(v_reason) not between 5 and 300 then raise exception 'Give the reason for the refund' using errcode = '22023'; end if;
    -- An order paid after its hold ended, when the pieces were already gone, never took them from the shelf.
    if v_restock and not exists (select 1 from shop.stock_moves m join shop.order_items i on i.variant_id = m.variant_id
                                  where i.order_id = o.id and i.counted and m.reason = 'sold' and m.note = o.number) then
      raise exception 'This order''s pieces were never taken from stock, so there is nothing to put back' using errcode = '23514';
    end if;
    if v_restock then
      -- The pieces go back on the shelf, each with a line on the stock trail.
      perform 1 from shop.variants v join shop.order_items i on i.variant_id = v.id where i.order_id = o.id and i.counted order by v.id for update of v;
      insert into shop.stock_moves (variant_id, qty, reason, note, stock_after, by_staff_id)
      select v.id, i.qty, 'returned', o.number, v.stock + i.qty, auth.uid()
        from shop.order_items i join shop.variants v on v.id = i.variant_id where i.order_id = o.id and i.counted;
      update shop.variants v set stock = v.stock + i.qty
        from shop.order_items i where i.order_id = o.id and i.counted and i.variant_id = v.id;
    end if;
    update shop.orders set status = 'refunded', closed_at = now(), refund_reason = v_reason, restocked = v_restock, attention = null where id = o.id;
    v_detail := format('%s%s%s', v_reason, case when v_restock then ' (pieces back in stock)' else '' end,
                       case when o.posted_source_id is not null then ' (already in the cash book: Finance records the refund there)' else '' end);
  else
    raise exception 'Unknown step' using errcode = '22023';
  end if;

  insert into shop.order_events (order_id, event, detail, by_staff_id)
  values (o.id, case p_step when 'pack' then 'packed' when 'ship' then 'shipped' when 'ready' then 'ready' when 'deliver' then 'delivered' when 'invoice' then 'invoice recorded'
                  when 'looked' then 'flag cleared' when 'cancel' then 'cancelled' else 'refunded' end, left(v_detail, 300), auth.uid());
  return (select status from shop.orders where id = o.id);
end;
$$;

-- 5. Posting a day's proceeds to the cash book: one inflow for the day, the amount left after the payment
-- partner's fee, for every order paid that day (Manila time) and not refunded. Only a day that is over, only once,
-- and only by people who may edit Finance and read the Shop.
create or replace function shop.post_proceeds(p_day date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_source text := 'shop:' || to_char(p_day, 'YYYY-MM-DD');
  v_count integer;
  v_gross numeric(12, 2);
  v_fees numeric(12, 2);
  v_net numeric(12, 2);
begin
  if not (shared.module_editable('finance') and shared.module_viewable('shop')) then
    raise exception 'Only Finance posts shop proceeds to the cash book' using errcode = '42501';
  end if;
  if not (select cash_posting from shop.settings) then
    raise exception 'Posting shop proceeds to the cash book is switched off in Shop settings' using errcode = '23514';
  end if;
  if p_day is null or p_day >= v_today then
    raise exception 'A day is posted after it is over' using errcode = '23514';
  end if;
  if exists (select 1 from ops.cash_entries where source_id = v_source) then
    raise exception 'That day is already in the cash book' using errcode = '23505';
  end if;
  select count(*), coalesce(sum(o.total), 0), coalesce(sum(coalesce(o.pay_fee, 0)), 0), coalesce(sum(coalesce(o.pay_net, o.total)), 0)
    into v_count, v_gross, v_fees, v_net
    from shop.orders o
   where o.status in ('paid', 'packed', 'shipped', 'ready', 'delivered') and o.posted_source_id is null
     and (o.paid_at at time zone 'Asia/Manila')::date = p_day;
  if v_count = 0 then
    return jsonb_build_object('posted', 0);
  end if;
  insert into ops.cash_entries (source_id, date, direction, source, entity, currency, amount, description, approval_status)
  values (v_source, p_day, 'inflow', 'shop_sales', 'PH_SEC', 'PHP', v_net,
          format('Shop sales, %s: %s order%s, sold %s, payment fees %s', to_char(p_day, 'FMDD Mon YYYY'), v_count, case when v_count = 1 then '' else 's' end,
                 to_char(v_gross, 'FM999,999,990.00'), to_char(v_fees, 'FM999,999,990.00')), 'approved');
  update shop.orders o set posted_source_id = v_source
   where o.status in ('paid', 'packed', 'shipped', 'ready', 'delivered') and o.posted_source_id is null
     and (o.paid_at at time zone 'Asia/Manila')::date = p_day;
  return jsonb_build_object('posted', v_count, 'amount', v_net, 'sold', v_gross, 'fees', v_fees, 'source_id', v_source);
end;
$$;

-- 6. The policy texts, for the site.
create or replace function shop.web_policies()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('terms', s.terms_text, 'privacy', s.privacy_text, 'returns', s.returns_text, 'updated_at', s.updated_at) from shop.settings s
$$;

-- The customer's order page also gets the courier's tracking link (the 0156 function, with that one field added).
create or replace function shop.web_order(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o shop.orders%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  perform shop.release_expired();
  select * into o from shop.orders where token = p_token;
  if not found then return null; end if;
  return jsonb_build_object(
    'number', o.number, 'status', o.status, 'name', o.name, 'email', o.email, 'phone', o.phone,
    'delivery', o.delivery, 'area', o.area, 'province', o.province, 'city', o.city, 'barangay', o.barangay, 'postal_code', o.postal_code,
    'address_line', o.address_line, 'landmark', o.landmark,
    'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee, 'total', o.total,
    'placed_at', o.placed_at, 'hold_until', o.hold_until, 'paid_at', o.paid_at, 'packed_at', o.packed_at, 'shipped_at', o.shipped_at,
    'delivered_at', o.delivered_at, 'closed_at', o.closed_at, 'pay_method', o.pay_method, 'pay_session_id', o.pay_session_id,
    'courier', o.courier, 'tracking_number', o.tracking_number, 'tracking_url', o.tracking_url, 'invoice_number', o.invoice_number,
    'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'option', i.option, 'qty', i.qty, 'unit_price', i.unit_price, 'line_total', i.line_total,
                'photo', (select f.path from shop.photos f where f.product_id = i.product_id order by f.sort, f.created_at limit 1)) order by i.sort)
              from shop.order_items i where i.order_id = o.id));
end;
$$;

revoke all on function shop.html(text), shop.queue_order_email(), shop.order_step(uuid, text, jsonb), shop.post_proceeds(date), shop.web_policies(), shop.web_order(text)
  from public, anon, authenticated, shop_web;
grant execute on function shop.order_step(uuid, text, jsonb) to authenticated;
grant execute on function shop.post_proceeds(date) to authenticated;
grant execute on function shop.web_policies() to shop_web;
grant execute on function shop.web_order(text) to shop_web;
grant execute on all functions in schema shop to service_role;

-- 7. The two new pages of the Shop menu, with the same levels as the rest: Shop Staff work in them; Finance, the
-- Office Admin and the CEO read. (Posting proceeds to the cash book also needs Finance's own edit level.)
insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level from (values ('shop.orders'), ('shop.proceeds')) p(page)
cross join (values ('shop_staff', 'edit'), ('finance', 'view'), ('office_admin', 'view'), ('ceo', 'view')) r(role, level)
where exists (select 1 from shared.roles where key = r.role)
on conflict do nothing;

-- 8. Sending the order emails: every five minutes ArkOS is asked to send what waits in the shop's outbox
-- (production only: where the House Sheet job runs, like the other scheduled jobs).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'house-sheet-sync') and not exists (select 1 from cron.job where jobname = 'shop-emails') then
    perform cron.schedule(
      'shop-emails',
      '*/5 * * * *',
      $job$
      select net.http_post(
        url := 'https://lafopsys.vercel.app/api/shop/send-emails',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_sync_secret' limit 1)
        ),
        body := '{"trigger":"cron"}'::jsonb,
        timeout_milliseconds := 60000
      )
      where exists (select 1 from shop.outbox where status = 'queued');
      $job$
    );
  end if;
end $$;

-- 9. Starter policy texts, for the foundation to review and reword in Shop settings before the shop opens.
-- A paragraph that starts with "# " is shown as a heading.
update shop.settings set terms_text = $t$# Who sells
The Little Ark Shop is run by Little Ark Foundation, Inc. Everything sold here supports the foundation's work for children with cancer and their families.

# A purchase is a sale
Buying from the shop is a sale, not a donation. A sales invoice comes with every order. No donation receipt is issued for a purchase.

# Prices and payment
Prices are in Philippine pesos. The delivery fee is shown before you pay. You pay on our payment partner's secure page; we never see or keep your card or wallet details.

# Your order
Items are held for you for a short time while you pay. An order that is not paid in that time is released and nothing is charged. When your payment arrives we email you a private link to your order's page.

# Delivery and pick-up
Items in stock are packed within the days shown on the product page. Made-to-order items take the longer time shown there. The courier's delivery time depends on your area. Pick-up at the foundation is free, and we tell you when your order is ready.

# If something is wrong
See the returns page. We will put it right.$t$ where terms_text = '';

update shop.settings set returns_text = $t$# Damaged, defective or wrong item
Tell us within 7 days of receiving your order, with your order number and a photo. We replace the item, or refund it if we cannot replace it. We cover the delivery cost of a replacement.

# Change of mind
Items made to order are made for you and cannot be returned for a change of mind. For items in stock, contact us within 7 days; unused items in their original condition may be exchanged, and you cover the delivery cost.

# Refunds
A refund goes back the way you paid. It can take several days to show, depending on your bank or wallet.

# How to reach us
Use the contact page of littlearkfoundation.org, and give your order number.$t$ where returns_text = '';

update shop.settings set privacy_text = $t$# What we collect
When you order we ask for your name, email address, mobile number and, for delivery, your address. We do not collect or keep card or wallet details; those are handled by our payment partner.

# Why we collect it
Only to handle your order: to take payment, pack and deliver it, tell you where it is, and answer you if something is wrong. We do not use it for marketing and we do not sell or rent it.

# Who sees it
Foundation staff who handle shop orders and finance; the courier (your name, mobile number and address, to deliver); and our payment partner (your name, email and mobile number, to process the payment and send its receipt).

# How long we keep it
Order records are kept for as long as accounting and tax rules require, then removed.

# Your rights
Under the Data Privacy Act of 2012 you may ask to see, correct or remove your details, subject to the records the law requires us to keep. Use the contact page of littlearkfoundation.org.

# Your order link
Your order's page is reached by a private link. Anyone who has the link can see that order, so keep it to yourself.$t$ where privacy_text = '';

notify pgrst, 'reload schema';
