-- 0156 The shop, part 2: orders, held stock and payment (user, 17 Nov 2026; shop.littlearkfoundation.org).
--
-- A customer checks out as a guest. The order is priced by the database from the catalogue (never from what the
-- browser sends), the pieces of counted items are HELD for a set time while the customer pays, and the payment
-- partner's notice turns the hold into a sale. An unpaid order lets its pieces go when the time runs out.
--
--   placed -> paid -> (packed, shipped or ready, delivered: staff, part 3)
--   placed -> expired   (not paid in time; the pieces go back on sale)
--
-- Every step the public site may take is one of four functions granted to its login (shop_web, 0155): place an
-- order, read one order by its private link, note the payment session, and record the payment. The site still has
-- no right on any table. Staff read orders here; the staff steps (pack, ship, cancel, refund) come in part 3.
--
-- Order numbers come from the shop's own counter (not ops.doc_counters, which the hourly copy carries between
-- development and production).

-- 1. How long an unpaid order holds its pieces.
alter table shop.settings add column if not exists hold_minutes smallint not null default 60;
alter table shop.settings drop constraint if exists settings_hold_minutes_check;
alter table shop.settings add constraint settings_hold_minutes_check check (hold_minutes between 10 and 1440);

-- 2. Orders.
create table if not exists shop.order_counters (
  year integer primary key,
  last integer not null default 0
);

create table if not exists shop.orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  -- The customer's private link: shop.littlearkfoundation.org/order/<token>. Unguessable; never shown to staff lists.
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  status text not null default 'placed' check (status in ('placed', 'paid', 'packed', 'shipped', 'ready', 'delivered', 'expired', 'cancelled', 'refunded')),
  name text not null check (length(btrim(name)) between 2 and 80),
  email text not null check (length(email) between 6 and 120),
  phone text not null check (length(phone) between 7 and 30),
  delivery text not null check (delivery in ('courier', 'pickup')),
  area text check (area is null or area in ('Metro Manila', 'Luzon', 'Visayas', 'Mindanao')),
  province text check (province is null or length(province) <= 60),
  city text check (city is null or length(city) <= 60),
  barangay text check (barangay is null or length(barangay) <= 60),
  postal_code text check (postal_code is null or length(postal_code) <= 10),
  address_line text check (address_line is null or length(address_line) <= 200),
  landmark text check (landmark is null or length(landmark) <= 200),
  weight_grams integer not null default 0 check (weight_grams >= 0),
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  delivery_fee numeric(12, 2) not null default 0 check (delivery_fee >= 0),
  total numeric(12, 2) not null check (total >= 0),
  -- The moment the customer agreed to the terms of sale and the privacy notice.
  consent_at timestamptz not null,
  hold_until timestamptz not null,
  placed_at timestamptz not null default now(),
  -- Payment, as the payment partner reported it.
  pay_provider text check (pay_provider is null or pay_provider in ('paymongo')),
  pay_session_id text unique check (pay_session_id is null or length(pay_session_id) <= 80),
  pay_payment_id text unique check (pay_payment_id is null or length(pay_payment_id) <= 80),
  pay_method text check (pay_method is null or length(pay_method) <= 40),
  pay_fee numeric(12, 2) check (pay_fee is null or pay_fee >= 0),
  pay_net numeric(12, 2) check (pay_net is null or pay_net >= 0),
  paid_at timestamptz,
  -- Something staff must look at (for example: paid after the hold ended and a piece is gone).
  attention text check (attention is null or length(attention) <= 300),
  -- Filled by staff in part 3.
  packed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  closed_at timestamptz,
  courier text check (courier is null or length(courier) <= 40),
  tracking_number text check (tracking_number is null or length(tracking_number) <= 60),
  invoice_number text check (invoice_number is null or length(invoice_number) <= 40),
  check (delivery = 'pickup' or (area is not null and address_line is not null)),
  check (total = subtotal + delivery_fee)
);
create index if not exists orders_status on shop.orders (status, placed_at desc);
create index if not exists orders_unpaid on shop.orders (hold_until) where status = 'placed';
create index if not exists orders_email on shop.orders (lower(email)) where status = 'placed';

-- What was bought, as it was at that moment: later changes to the catalogue never rewrite an order.
create table if not exists shop.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references shop.orders(id) on delete cascade deferrable initially immediate,
  variant_id uuid references shop.variants(id) on delete set null deferrable initially immediate,
  product_id uuid references shop.products(id) on delete set null deferrable initially immediate,
  sku text not null,
  name text not null,
  option text not null default '',
  -- Counted stock (held and sold from the shelf) or made to order.
  counted boolean not null,
  qty integer not null check (qty between 1 and 20),
  unit_price numeric(12, 2) not null check (unit_price > 0),
  unit_cost numeric(12, 2) check (unit_cost is null or unit_cost >= 0),
  line_total numeric(12, 2) not null check (line_total = unit_price * qty),
  sort integer not null default 0
);
create index if not exists order_items_order on shop.order_items (order_id);

create table if not exists shop.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references shop.orders(id) on delete cascade deferrable initially immediate,
  event text not null check (length(event) between 2 and 40),
  detail text check (detail is null or length(detail) <= 300),
  by_staff_id uuid references shared.staff(id) on delete set null deferrable initially immediate,
  at timestamptz not null default now()
);
create index if not exists order_events_order on shop.order_events (order_id, at);

alter table shop.order_counters enable row level security;
alter table shop.orders enable row level security;
alter table shop.order_items enable row level security;
alter table shop.order_events enable row level security;

-- Shop viewers read orders; nobody writes them from the browser (the functions below and part 3's do).
do $$
declare
  t text;
begin
  foreach t in array array['orders', 'order_items', 'order_events'] loop
    execute format('drop policy if exists "shop viewers read" on shop.%I', t);
    execute format('create policy "shop viewers read" on shop.%I for select to authenticated using ((select shared.module_viewable(''shop'')))', t);
  end loop;
end $$;
revoke all on shop.order_counters, shop.orders, shop.order_items, shop.order_events from public, anon, authenticated;
grant select on shop.orders, shop.order_items, shop.order_events to authenticated;
grant all on shop.order_counters, shop.orders, shop.order_items, shop.order_events to service_role;

-- 3. Letting go of the pieces of orders that were not paid in time. Called at the start of the site's functions,
-- and every ten minutes where the database has a scheduler.
create or replace function shop.release_expired()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  n integer := 0;
begin
  for o in select id from shop.orders where status = 'placed' and hold_until < now() order by hold_until for update skip locked loop
    update shop.variants v set held = greatest(v.held - i.qty, 0)
      from shop.order_items i where i.order_id = o.id and i.counted and i.variant_id = v.id;
    update shop.orders set status = 'expired', closed_at = now() where id = o.id;
    insert into shop.order_events (order_id, event, detail) values (o.id, 'expired', 'Not paid in time; the pieces went back on sale');
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- 4. Placing an order. The site sends who the customer is, where it goes and which items; everything about money
-- is worked out here from the catalogue. Returns {ok: true, number, token, ...} or {ok: false, error, ...} for the
-- outcomes a customer can cause (the shop is closed, an item ran out, no delivery fee fits); malformed input raises.
create or replace function shop.web_place_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s shop.settings%rowtype;
  v_items jsonb := p -> 'items';
  v_name text := btrim(coalesce(p ->> 'name', ''));
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_phone text := btrim(coalesce(p ->> 'phone', ''));
  v_delivery text := p ->> 'delivery';
  v_area text := nullif(btrim(coalesce(p ->> 'area', '')), '');
  v_ids uuid[];
  v_short jsonb := '[]'::jsonb;
  v_gone jsonb := '[]'::jsonb;
  v_subtotal numeric(12, 2) := 0;
  v_weight integer := 0;
  v_fee numeric(12, 2) := 0;
  v_year integer := extract(year from (now() at time zone 'Asia/Manila'))::integer;
  v_seq integer;
  v_order shop.orders%rowtype;
  r record;
begin
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(v_items) is distinct from 'array' then
    raise exception 'The order is not readable' using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) not between 1 and 30 then
    raise exception 'An order holds 1 to 30 different items' using errcode = '22023';
  end if;
  if length(v_name) not between 2 and 80 then raise exception 'Give your full name' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 120 then raise exception 'Give a valid email address' using errcode = '22023'; end if;
  if v_phone !~ '^\+?[0-9][0-9 ()-]{6,28}$' then raise exception 'Give a valid mobile number' using errcode = '22023'; end if;
  if v_delivery is null or v_delivery not in ('courier', 'pickup') then raise exception 'Choose delivery or pick-up' using errcode = '22023'; end if;
  if coalesce((p ->> 'consent')::boolean, false) is not true then raise exception 'Agree to the terms of sale and the privacy notice' using errcode = '22023'; end if;
  if v_delivery = 'courier' then
    if v_area is null or v_area not in ('Metro Manila', 'Luzon', 'Visayas', 'Mindanao') then raise exception 'Choose the delivery area' using errcode = '22023'; end if;
    if length(btrim(coalesce(p ->> 'address_line', ''))) not between 5 and 200 then raise exception 'Give the house number, street and building' using errcode = '22023'; end if;
    if length(btrim(coalesce(p ->> 'city', ''))) not between 2 and 60 or length(btrim(coalesce(p ->> 'province', ''))) not between 2 and 60 then raise exception 'Give the city and the province' using errcode = '22023'; end if;
    if length(coalesce(p ->> 'barangay', '')) > 60 or length(coalesce(p ->> 'postal_code', '')) > 10 or length(coalesce(p ->> 'landmark', '')) > 200 then raise exception 'An address line is too long' using errcode = '22023'; end if;
  end if;

  -- Every line: an item id and a whole number of pieces, each item once.
  select array_agg((e ->> 'v')::uuid order by (e ->> 'v')) into v_ids
    from jsonb_array_elements(v_items) e
   where (e ->> 'v') ~ '^[0-9a-fA-F-]{36}$' and (e ->> 'q') ~ '^[0-9]{1,2}$' and (e ->> 'q')::integer between 1 and 20;
  if v_ids is null or cardinality(v_ids) <> jsonb_array_length(v_items) or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'Each line needs an item and 1 to 20 pieces, and an item appears once' using errcode = '22023';
  end if;

  perform shop.release_expired();
  select * into s from shop.settings;
  if not s.shop_open then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if v_delivery = 'pickup' and not s.pickup_enabled then return jsonb_build_object('ok', false, 'error', 'pickup'); end if;
  -- One customer cannot tie up the shelf: at most three unpaid orders at a time for an email or a mobile number.
  if (select count(*) from shop.orders o where o.status = 'placed' and (lower(o.email) = v_email or o.phone = v_phone)) >= 3 then
    return jsonb_build_object('ok', false, 'error', 'unpaid');
  end if;

  -- Lock the items (always in the same order, so two buyers cannot deadlock), then check each one.
  for r in
    select v.id, v.sku, v.colour, v.size, v.price, v.cost, v.stock, v.held, v.active, p2.id as product_id, p2.name, p2.status, p2.supply, p2.weight_grams,
           (select (e ->> 'q')::integer from jsonb_array_elements(v_items) e where (e ->> 'v')::uuid = v.id) as qty
      from shop.variants v join shop.products p2 on p2.id = v.product_id
     where v.id = any (v_ids)
     order by v.id
       for update of v
  loop
    if r.status <> 'published' or not r.active then
      v_gone := v_gone || jsonb_build_object('v', r.id, 'name', r.name);
    elsif r.supply = 'stock' and r.stock - r.held < r.qty then
      v_short := v_short || jsonb_build_object('v', r.id, 'name', r.name, 'left', greatest(r.stock - r.held, 0));
    end if;
    v_subtotal := v_subtotal + r.price * r.qty;
    v_weight := v_weight + r.weight_grams * r.qty;
  end loop;
  if jsonb_array_length(v_gone) + (cardinality(v_ids) - (select count(*) from shop.variants where id = any (v_ids))) > 0 then
    return jsonb_build_object('ok', false, 'error', 'gone', 'items', v_gone);
  end if;
  if jsonb_array_length(v_short) > 0 then
    return jsonb_build_object('ok', false, 'error', 'stock', 'items', v_short);
  end if;

  if v_delivery = 'courier' then
    select d.fee into v_fee from shop.delivery_fees d where d.area = v_area and d.max_grams >= v_weight order by d.max_grams limit 1;
    if not found then return jsonb_build_object('ok', false, 'error', 'delivery', 'weight_grams', v_weight); end if;
  end if;

  insert into shop.order_counters (year, last) values (v_year, 1)
    on conflict (year) do update set last = shop.order_counters.last + 1
    returning last into v_seq;

  insert into shop.orders (number, token, name, email, phone, delivery, area, province, city, barangay, postal_code, address_line, landmark,
                           weight_grams, subtotal, delivery_fee, total, consent_at, hold_until)
  values (format('LAF-SHP-%s-%s', v_year, to_char(v_seq, 'FM00000')),
          replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
          v_name, v_email, v_phone, v_delivery,
          case when v_delivery = 'courier' then v_area end,
          case when v_delivery = 'courier' then nullif(btrim(p ->> 'province'), '') end,
          case when v_delivery = 'courier' then nullif(btrim(p ->> 'city'), '') end,
          case when v_delivery = 'courier' then nullif(btrim(coalesce(p ->> 'barangay', '')), '') end,
          case when v_delivery = 'courier' then nullif(btrim(coalesce(p ->> 'postal_code', '')), '') end,
          case when v_delivery = 'courier' then btrim(p ->> 'address_line') end,
          case when v_delivery = 'courier' then nullif(btrim(coalesce(p ->> 'landmark', '')), '') end,
          v_weight, v_subtotal, v_fee, v_subtotal + v_fee, now(), now() + make_interval(mins => s.hold_minutes))
  returning * into v_order;

  insert into shop.order_items (order_id, variant_id, product_id, sku, name, option, counted, qty, unit_price, unit_cost, line_total, sort)
  select v_order.id, v.id, p2.id, v.sku, p2.name, concat_ws(', ', v.colour, v.size), p2.supply = 'stock', q.qty, v.price, v.cost, v.price * q.qty, q.ord
    from (select (e ->> 'v')::uuid as id, (e ->> 'q')::integer as qty, ord::integer as ord from jsonb_array_elements(v_items) with ordinality as x(e, ord)) q
    join shop.variants v on v.id = q.id
    join shop.products p2 on p2.id = v.product_id;

  -- Hold the pieces of the counted items.
  update shop.variants v set held = v.held + i.qty
    from shop.order_items i where i.order_id = v_order.id and i.counted and i.variant_id = v.id;

  insert into shop.order_events (order_id, event, detail) values (v_order.id, 'placed', format('%s, %s', v_delivery, to_char(v_order.total, 'FM999,999,990.00')));

  return jsonb_build_object(
    'ok', true, 'number', v_order.number, 'token', v_order.token, 'subtotal', v_order.subtotal, 'delivery_fee', v_order.delivery_fee,
    'total', v_order.total, 'hold_until', v_order.hold_until, 'email', v_order.email, 'name', v_order.name, 'phone', v_order.phone,
    'lines', (select jsonb_agg(jsonb_build_object('name', i.name, 'option', i.option, 'qty', i.qty, 'unit_price', i.unit_price) order by i.sort) from shop.order_items i where i.order_id = v_order.id));
end;
$$;

-- 5. One order, for the customer who holds its private link. Nothing internal (cost, staff notes) is returned.
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
    'delivered_at', o.delivered_at, 'closed_at', o.closed_at, 'pay_method', o.pay_method, 'has_session', o.pay_session_id is not null,
    'courier', o.courier, 'tracking_number', o.tracking_number, 'invoice_number', o.invoice_number,
    'items', (select jsonb_agg(jsonb_build_object('name', i.name, 'option', i.option, 'qty', i.qty, 'unit_price', i.unit_price, 'line_total', i.line_total,
                'photo', (select f.path from shop.photos f where f.product_id = i.product_id order by f.sort, f.created_at limit 1)) order by i.sort)
              from shop.order_items i where i.order_id = o.id));
end;
$$;

-- 6. Noting the payment session the site opened for an unpaid order (so the partner's notice can be matched).
create or replace function shop.web_attach_payment(p_token text, p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o shop.orders%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_session_id is null or p_session_id !~ '^[A-Za-z0-9_]{6,80}$' then
    raise exception 'The payment session is not readable' using errcode = '22023';
  end if;
  perform shop.release_expired();
  select * into o from shop.orders where token = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown'); end if;
  if o.status <> 'placed' then return jsonb_build_object('ok', false, 'error', 'status', 'status', o.status); end if;
  update shop.orders set pay_provider = 'paymongo', pay_session_id = p_session_id where id = o.id;
  insert into shop.order_events (order_id, event, detail) values (o.id, 'payment opened', left(p_session_id, 80));
  return jsonb_build_object('ok', true);
end;
$$;

-- 7. Recording the payment, once. The site calls this only after checking the partner's signature and reading the
-- session back from the partner. Amounts are in centavos, as the partner sends them.
create or replace function shop.web_payment_paid(p_number text, p_session_id text, p_payment_id text, p_amount bigint, p_method text, p_fee bigint, p_net bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o shop.orders%rowtype;
  v_short integer;
  v_note text;
begin
  if p_number is null or p_session_id is null or p_payment_id is null or p_amount is null
     or p_payment_id !~ '^[A-Za-z0-9_]{6,80}$' or p_session_id !~ '^[A-Za-z0-9_]{6,80}$' then
    raise exception 'The payment is not readable' using errcode = '22023';
  end if;
  select * into o from shop.orders where number = p_number for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown'); end if;
  if o.pay_payment_id is not null then
    -- The same notice again (the partner sends each at least once), or a second payment for one order.
    return jsonb_build_object('ok', o.pay_payment_id = p_payment_id, 'already', true, 'error', case when o.pay_payment_id = p_payment_id then null else 'second payment' end);
  end if;
  if o.pay_session_id is distinct from p_session_id then
    insert into shop.order_events (order_id, event, detail) values (o.id, 'payment refused', 'The notice named another payment session');
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if p_amount <> round(o.total * 100) then
    insert into shop.order_events (order_id, event, detail) values (o.id, 'payment refused', format('Paid %s, the order is %s', to_char(p_amount / 100.0, 'FM999,999,990.00'), to_char(o.total, 'FM999,999,990.00')));
    update shop.orders set attention = 'A payment arrived for a different amount: check with the payment partner' where id = o.id;
    return jsonb_build_object('ok', false, 'error', 'amount');
  end if;

  if o.status = 'placed' then
    -- The held pieces leave the shelf.
    insert into shop.stock_moves (variant_id, qty, reason, note, stock_after)
    select v.id, -i.qty, 'sold', o.number, v.stock - i.qty
      from shop.order_items i join shop.variants v on v.id = i.variant_id where i.order_id = o.id and i.counted;
    update shop.variants v set stock = v.stock - i.qty, held = greatest(v.held - i.qty, 0)
      from shop.order_items i where i.order_id = o.id and i.counted and i.variant_id = v.id;
  elsif o.status in ('expired', 'cancelled') then
    -- Paid after the hold ended: the pieces were let go. Take them again if they are all still there; if not, the
    -- money is still recorded and staff are told, so nobody's payment is lost.
    perform 1 from shop.variants v join shop.order_items i on i.variant_id = v.id where i.order_id = o.id and i.counted order by v.id for update of v;
    select count(*) into v_short
      from shop.order_items i left join shop.variants v on v.id = i.variant_id
     where i.order_id = o.id and i.counted and (v.id is null or v.stock - v.held < i.qty);
    if v_short = 0 then
      insert into shop.stock_moves (variant_id, qty, reason, note, stock_after)
      select v.id, -i.qty, 'sold', o.number, v.stock - i.qty
        from shop.order_items i join shop.variants v on v.id = i.variant_id where i.order_id = o.id and i.counted;
      update shop.variants v set stock = v.stock - i.qty
        from shop.order_items i where i.order_id = o.id and i.counted and i.variant_id = v.id;
      v_note := 'Paid after the hold ended; the pieces were still there';
    else
      v_note := 'Paid after the hold ended and a piece is no longer in stock: arrange it with the customer or refund';
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'status', 'status', o.status);
  end if;

  update shop.orders
     set status = 'paid', paid_at = now(), closed_at = null, pay_provider = 'paymongo', pay_payment_id = p_payment_id, pay_method = left(coalesce(p_method, ''), 40),
         pay_fee = case when p_fee is null then null else p_fee / 100.0 end, pay_net = case when p_net is null then null else p_net / 100.0 end,
         attention = case when v_note like '%no longer in stock%' then v_note else null end
   where id = o.id;
  insert into shop.order_events (order_id, event, detail) values (o.id, 'paid', coalesce(v_note, left(coalesce(p_method, 'paid'), 40)));
  return jsonb_build_object('ok', true, 'already', false, 'attention', v_note like '%no longer in stock%');
end;
$$;

revoke all on function shop.release_expired(), shop.web_place_order(jsonb), shop.web_order(text), shop.web_attach_payment(text, text),
  shop.web_payment_paid(text, text, text, bigint, text, bigint, bigint) from public, anon, authenticated, shop_web;
grant execute on function shop.web_place_order(jsonb) to shop_web;
grant execute on function shop.web_order(text) to shop_web;
grant execute on function shop.web_attach_payment(text, text) to shop_web;
grant execute on function shop.web_payment_paid(text, text, text, bigint, text, bigint, bigint) to shop_web;
grant execute on all functions in schema shop to service_role;

-- 8. Where the database has a scheduler, let unpaid orders go every ten minutes even when nobody visits the site.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'shop-release-expired';
    perform cron.schedule('shop-release-expired', '*/10 * * * *', 'select shop.release_expired()');
  end if;
end $$;

-- 9. Live updates in ArkOS.
do $$
declare
  t text;
begin
  foreach t in array array['orders', 'order_items', 'order_events'] loop
    begin
      execute format('alter publication supabase_realtime add table shop.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
