-- 0160 Customer accounts for the shop site (user, 18 Nov 2026).
--
-- A customer of the shop can have an account: they sign in with their email and a 6-digit code sent to it (no
-- password), see their orders and keep their name, mobile number and delivery address. Buying without an account
-- stays possible. The user's rules:
--   * A customer must never be able to get into ArkOS. So an account is a row in the shop's own tables, not a
--     Supabase sign-in: it has no JWT and no role, and is reached only through the storefront functions below,
--     which the site's own login (shop_web) may run. Staff accounts are not touched.
--   * The accounts are managed from ArkOS > Shop > Customers. People who may edit the Shop can block, sign out,
--     close and correct a customer. Nobody can see a code or a session, and staff cannot change the sign-in
--     address: the customer does that, with a code sent to the new address.
--
-- Only the hash of a secret is kept: the site makes the code and the session token and sends their SHA-256 here.
-- A code works for 10 minutes and five tries; an address gets five codes an hour and ten a day; one caller gets
-- twenty an hour. A session lasts 30 days and a customer keeps at most ten.

-- 1. The customer.
create table if not exists shop.customers (
  id uuid primary key default gen_random_uuid(),
  -- The sign-in address, always lower case. A closed account keeps a placeholder, so the address is free again.
  email text not null unique check (email = lower(email) and length(email) between 6 and 120),
  email_confirmed_at timestamptz not null default now(),
  name text check (name is null or length(btrim(name)) between 2 and 80),
  phone text check (phone is null or length(phone) between 7 and 30),
  area text check (area is null or area in ('Metro Manila', 'Luzon', 'Visayas', 'Mindanao')),
  province text check (province is null or length(province) <= 60),
  city text check (city is null or length(city) <= 60),
  barangay text check (barangay is null or length(barangay) <= 60),
  postal_code text check (postal_code is null or length(postal_code) <= 10),
  address_line text check (address_line is null or length(address_line) <= 200),
  landmark text check (landmark is null or length(landmark) <= 200),
  status text not null default 'active' check (status in ('active', 'blocked', 'closed')),
  status_at timestamptz,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz,
  sign_in_count integer not null default 0 check (sign_in_count >= 0)
);

-- A device that is signed in. Only the hash of its token is here.
create table if not exists shop.customer_sessions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references shop.customers (id) on delete cascade deferrable initially immediate,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  user_agent text check (user_agent is null or length(user_agent) <= 200),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists customer_sessions_customer on shop.customer_sessions (customer_id);

-- A code on its way to an address. Only its hash is here.
create table if not exists shop.sign_in_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and length(email) between 6 and 120),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  -- Set when the code is for changing an account's address (the code goes to the new address).
  customer_id uuid references shop.customers (id) on delete cascade deferrable initially immediate,
  caller_hash text check (caller_hash is null or caller_hash ~ '^[0-9a-f]{64}$'),
  attempts smallint not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists sign_in_codes_email on shop.sign_in_codes (email, created_at desc);
create index if not exists sign_in_codes_caller on shop.sign_in_codes (caller_hash, created_at desc) where caller_hash is not null;

-- What happened to an account, for the people who run the shop.
create table if not exists shop.customer_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references shop.customers (id) on delete cascade deferrable initially immediate,
  event text not null check (length(event) between 2 and 40),
  detail text check (detail is null or length(detail) <= 300),
  by_staff_id uuid references shared.staff (id) on delete set null deferrable initially immediate,
  at timestamptz not null default now()
);
create index if not exists customer_events_customer on shop.customer_events (customer_id, at);

-- An order knows whose account it belongs to; an order placed without signing in has none.
alter table shop.orders add column if not exists customer_id uuid references shop.customers (id) on delete set null deferrable initially immediate;
-- Every link can be deferred, as the rule for new links since 0125 asks (this also mends a database where an
-- earlier draft of this file made them without it).
alter table shop.customer_sessions alter constraint customer_sessions_customer_id_fkey deferrable initially immediate;
alter table shop.sign_in_codes alter constraint sign_in_codes_customer_id_fkey deferrable initially immediate;
alter table shop.customer_events alter constraint customer_events_customer_id_fkey deferrable initially immediate;
alter table shop.orders alter constraint orders_customer_id_fkey deferrable initially immediate;
create index if not exists orders_customer on shop.orders (customer_id) where customer_id is not null;
create index if not exists orders_email_lower on shop.orders (lower(email));

alter table shop.customers enable row level security;
alter table shop.customer_sessions enable row level security;
alter table shop.sign_in_codes enable row level security;
alter table shop.customer_events enable row level security;

-- Shop viewers read customers and their trail. Sessions and codes are read by nobody: no rule, no grant.
drop policy if exists "shop viewers read" on shop.customers;
create policy "shop viewers read" on shop.customers for select to authenticated using ((select shared.module_viewable('shop')));
drop policy if exists "shop viewers read" on shop.customer_events;
create policy "shop viewers read" on shop.customer_events for select to authenticated using ((select shared.module_viewable('shop')));
revoke all on shop.customers, shop.customer_sessions, shop.sign_in_codes, shop.customer_events from public, anon, authenticated;
grant select on shop.customers, shop.customer_events to authenticated;
grant all on shop.customers, shop.customer_sessions, shop.sign_in_codes, shop.customer_events to service_role;

-- 2. Inside helpers (nobody may call them directly).

-- The customer a session belongs to, or null: the session must exist, be in date, and the account be active.
create or replace function shop.session_customer(p_session text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  if p_session is null or p_session !~ '^[0-9a-f]{64}$' then return null; end if;
  select s.customer_id into v
    from shop.customer_sessions s join shop.customers c on c.id = s.customer_id
   where s.token_hash = p_session and s.expires_at > now() and c.status = 'active';
  if v is null then return null; end if;
  update shop.customer_sessions set last_seen_at = now() where token_hash = p_session and last_seen_at < now() - interval '10 minutes';
  return v;
end;
$$;

-- Writes a customer's details after checking them, with the same rules as an order's.
create or replace function shop.customer_set_details(p_customer uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p ->> 'name', '')), '');
  v_phone text := nullif(btrim(coalesce(p ->> 'phone', '')), '');
  v_area text := nullif(btrim(coalesce(p ->> 'area', '')), '');
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'The details are not readable' using errcode = '22023'; end if;
  if v_name is not null and length(v_name) not between 2 and 80 then raise exception 'Give your full name' using errcode = '22023'; end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9][0-9 ()-]{6,28}$' then raise exception 'Give a valid mobile number' using errcode = '22023'; end if;
  if v_area is not null and v_area not in ('Metro Manila', 'Luzon', 'Visayas', 'Mindanao') then raise exception 'Choose the delivery area' using errcode = '22023'; end if;
  if length(coalesce(p ->> 'province', '')) > 60 or length(coalesce(p ->> 'city', '')) > 60 or length(coalesce(p ->> 'barangay', '')) > 60
     or length(coalesce(p ->> 'postal_code', '')) > 10 or length(coalesce(p ->> 'address_line', '')) > 200 or length(coalesce(p ->> 'landmark', '')) > 200 then
    raise exception 'An address line is too long' using errcode = '22023';
  end if;
  update shop.customers set
    name = v_name, phone = v_phone, area = v_area,
    province = nullif(btrim(coalesce(p ->> 'province', '')), ''),
    city = nullif(btrim(coalesce(p ->> 'city', '')), ''),
    barangay = nullif(btrim(coalesce(p ->> 'barangay', '')), ''),
    postal_code = nullif(btrim(coalesce(p ->> 'postal_code', '')), ''),
    address_line = nullif(btrim(coalesce(p ->> 'address_line', '')), ''),
    landmark = nullif(btrim(coalesce(p ->> 'landmark', '')), '')
  where id = p_customer;
end;
$$;

-- Closes an account: the details go, every device is signed out and the address is free again. Its orders stay
-- as they are (they are the foundation's sales records) and stay tied to the closed account.
create or replace function shop.customer_close(p_customer uuid, p_staff uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select email into v_email from shop.customers where id = p_customer and status <> 'closed' for update;
  if not found then return; end if;
  delete from shop.customer_sessions where customer_id = p_customer;
  delete from shop.sign_in_codes where email = v_email or customer_id = p_customer;
  update shop.customers set
    email = 'closed-' || id::text || '@closed.invalid', name = null, phone = null, area = null, province = null, city = null,
    barangay = null, postal_code = null, address_line = null, landmark = null, status = 'closed', status_at = now()
  where id = p_customer;
  insert into shop.customer_events (customer_id, event, by_staff_id) values (p_customer, 'closed', p_staff);
end;
$$;

-- 3. The storefront's functions (the site's login may run these and nothing else).

-- Asks for a sign-in code. The site has made the code and sends its hash; this decides whether it may be sent.
-- The answer never says whether an account exists.
create or replace function shop.web_sign_in_start(p_email text, p_code_hash text, p_caller text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) not between 6 and 120 then raise exception 'Give a valid email address' using errcode = '22023'; end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' or (p_caller is not null and p_caller !~ '^[0-9a-f]{64}$') then
    raise exception 'The request is not readable' using errcode = '22023';
  end if;
  delete from shop.sign_in_codes where created_at < now() - interval '2 days';
  delete from shop.customer_sessions where expires_at < now();
  if (select count(*) from shop.sign_in_codes where email = v_email and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from shop.sign_in_codes where email = v_email and created_at > now() - interval '1 day') >= 10
     or (p_caller is not null and (select count(*) from shop.sign_in_codes where caller_hash = p_caller and created_at > now() - interval '1 hour') >= 20) then
    return jsonb_build_object('send', false, 'why', 'limit');
  end if;
  if exists (select 1 from shop.customers where email = v_email and status = 'blocked') then
    return jsonb_build_object('send', false, 'why', 'blocked');
  end if;
  -- Only the newest code works.
  update shop.sign_in_codes set used_at = now() where email = v_email and customer_id is null and used_at is null;
  insert into shop.sign_in_codes (email, code_hash, caller_hash, expires_at) values (v_email, p_code_hash, p_caller, now() + interval '10 minutes');
  return jsonb_build_object('send', true);
end;
$$;

-- Signs in with the code. The first time for an address this also creates the account, and every order placed
-- earlier with that address joins it.
create or replace function shop.web_sign_in_finish(p_email text, p_code_hash text, p_session text, p_user_agent text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  k shop.sign_in_codes%rowtype;
  c shop.customers%rowtype;
  v_new boolean := false;
  v_linked integer;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' or p_session is null or p_session !~ '^[0-9a-f]{64}$' then
    raise exception 'The request is not readable' using errcode = '22023';
  end if;
  select * into k from shop.sign_in_codes
   where email = v_email and customer_id is null and used_at is null and expires_at > now()
   order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if k.code_hash <> p_code_hash then
    update shop.sign_in_codes set attempts = attempts + 1, used_at = case when attempts + 1 >= 5 then now() end where id = k.id;
    return jsonb_build_object('ok', false, 'error', case when k.attempts + 1 >= 5 then 'expired' else 'wrong' end, 'left', greatest(4 - k.attempts, 0));
  end if;
  update shop.sign_in_codes set used_at = now() where id = k.id;

  select * into c from shop.customers where email = v_email for update;
  if not found then
    insert into shop.customers (email) values (v_email) returning * into c;
    v_new := true;
    -- The details start from the latest order placed with this address.
    update shop.customers cu set name = o.name, phone = o.phone, area = o.area, province = o.province, city = o.city,
           barangay = o.barangay, postal_code = o.postal_code, address_line = o.address_line, landmark = o.landmark
      from (select * from shop.orders where lower(email) = v_email order by placed_at desc limit 1) o
     where cu.id = c.id;
    insert into shop.customer_events (customer_id, event) values (c.id, 'created');
  elsif c.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  update shop.customers set last_sign_in_at = now(), sign_in_count = sign_in_count + 1 where id = c.id;
  delete from shop.customer_sessions
   where customer_id = c.id and id not in (select id from shop.customer_sessions where customer_id = c.id order by created_at desc limit 9);
  insert into shop.customer_sessions (customer_id, token_hash, user_agent, expires_at)
  values (c.id, p_session, left(nullif(btrim(coalesce(p_user_agent, '')), ''), 200), now() + interval '30 days');
  update shop.orders set customer_id = c.id where customer_id is null and lower(email) = v_email;
  get diagnostics v_linked = row_count;
  insert into shop.customer_events (customer_id, event, detail)
  values (c.id, 'signed_in', case when v_linked > 0 then format('%s earlier order(s) joined the account', v_linked) end);
  return jsonb_build_object('ok', true, 'new', v_new);
end;
$$;

-- The signed-in customer, or null.
create or replace function shop.web_customer(p_session text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid := shop.session_customer(p_session);
begin
  if v is null then return null; end if;
  return (
    select jsonb_build_object(
      'email', c.email, 'name', c.name, 'phone', c.phone, 'area', c.area, 'province', c.province, 'city', c.city,
      'barangay', c.barangay, 'postal_code', c.postal_code, 'address_line', c.address_line, 'landmark', c.landmark,
      'created_at', c.created_at,
      'orders', (select count(*) from shop.orders o where o.customer_id = c.id),
      'open_orders', (select count(*) from shop.orders o where o.customer_id = c.id and o.status in ('placed', 'paid', 'packed', 'shipped', 'ready')))
      from shop.customers c where c.id = v);
end;
$$;

-- The signed-in customer's orders, newest first. Each carries its private link, which opens the order page.
create or replace function shop.web_customer_orders(p_session text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid := shop.session_customer(p_session);
begin
  if v is null then return null; end if;
  return coalesce((
    select jsonb_agg(x.j order by x.placed_at desc)
      from (select o.placed_at, jsonb_build_object(
                     'number', o.number, 'token', o.token, 'status', o.status, 'delivery', o.delivery, 'placed_at', o.placed_at, 'total', o.total,
                     'pieces', (select coalesce(sum(i.qty), 0) from shop.order_items i where i.order_id = o.id),
                     'courier', o.courier, 'tracking_number', o.tracking_number, 'tracking_url', o.tracking_url,
                     'paid_at', o.paid_at, 'packed_at', o.packed_at, 'shipped_at', o.shipped_at, 'delivered_at', o.delivered_at) as j
              from shop.orders o where o.customer_id = v order by o.placed_at desc limit 200) x), '[]'::jsonb);
end;
$$;

-- Saves the signed-in customer's details.
create or replace function shop.web_customer_save(p_session text, p jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid := shop.session_customer(p_session);
begin
  if v is null then return false; end if;
  perform shop.customer_set_details(v, p);
  insert into shop.customer_events (customer_id, event) values (v, 'details_changed');
  return true;
end;
$$;

-- Signs this device out, or every device.
create or replace function shop.web_sign_out(p_session text, p_everywhere boolean default false)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  if p_session is null or p_session !~ '^[0-9a-f]{64}$' then return false; end if;
  select customer_id into v from shop.customer_sessions where token_hash = p_session;
  if v is null then return false; end if;
  if p_everywhere then
    delete from shop.customer_sessions where customer_id = v;
  else
    delete from shop.customer_sessions where token_hash = p_session;
  end if;
  insert into shop.customer_events (customer_id, event) values (v, case when p_everywhere then 'signed_out_everywhere' else 'signed_out' end);
  return true;
end;
$$;

-- Ties an order that was placed a moment ago to the signed-in customer (the site calls this right after placing
-- it), and lets a first order fill in details the customer has not given yet.
create or replace function shop.web_claim_order(p_session text, p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid := shop.session_customer(p_session);
  n integer;
begin
  if v is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then return false; end if;
  update shop.orders set customer_id = v where token = p_token and customer_id is null and placed_at > now() - interval '15 minutes';
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  update shop.customers c set
    name = coalesce(c.name, o.name), phone = coalesce(c.phone, o.phone),
    area = case when c.address_line is null then o.area else c.area end,
    province = case when c.address_line is null then o.province else c.province end,
    city = case when c.address_line is null then o.city else c.city end,
    barangay = case when c.address_line is null then o.barangay else c.barangay end,
    postal_code = case when c.address_line is null then o.postal_code else c.postal_code end,
    landmark = case when c.address_line is null then o.landmark else c.landmark end,
    address_line = coalesce(c.address_line, o.address_line)
  from shop.orders o where o.token = p_token and c.id = v;
  return true;
end;
$$;

-- The customer closes their own account.
create or replace function shop.web_customer_close(p_session text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid := shop.session_customer(p_session);
begin
  if v is null then return false; end if;
  perform shop.customer_close(v, null);
  return true;
end;
$$;

-- Changing the sign-in address: a code goes to the new address, and the change happens when it is entered.
create or replace function shop.web_email_change_start(p_session text, p_email text, p_code_hash text, p_caller text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid := shop.session_customer(p_session);
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v is null then return jsonb_build_object('send', false, 'why', 'signed_out'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) not between 6 and 120 then raise exception 'Give a valid email address' using errcode = '22023'; end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' or (p_caller is not null and p_caller !~ '^[0-9a-f]{64}$') then
    raise exception 'The request is not readable' using errcode = '22023';
  end if;
  if exists (select 1 from shop.customers where id = v and email = v_email) then return jsonb_build_object('send', false, 'why', 'same'); end if;
  if (select count(*) from shop.sign_in_codes where email = v_email and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from shop.sign_in_codes where customer_id = v and created_at > now() - interval '1 day') >= 10
     or (p_caller is not null and (select count(*) from shop.sign_in_codes where caller_hash = p_caller and created_at > now() - interval '1 hour') >= 20) then
    return jsonb_build_object('send', false, 'why', 'limit');
  end if;
  update shop.sign_in_codes set used_at = now() where customer_id = v and used_at is null;
  insert into shop.sign_in_codes (email, code_hash, customer_id, caller_hash, expires_at) values (v_email, p_code_hash, v, p_caller, now() + interval '10 minutes');
  return jsonb_build_object('send', true);
end;
$$;

create or replace function shop.web_email_change_finish(p_session text, p_email text, p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid := shop.session_customer(p_session);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_old text;
  k shop.sign_in_codes%rowtype;
begin
  if v is null then return jsonb_build_object('ok', false, 'error', 'signed_out'); end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then raise exception 'The request is not readable' using errcode = '22023'; end if;
  select * into k from shop.sign_in_codes
   where email = v_email and customer_id = v and used_at is null and expires_at > now()
   order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if k.code_hash <> p_code_hash then
    update shop.sign_in_codes set attempts = attempts + 1, used_at = case when attempts + 1 >= 5 then now() end where id = k.id;
    return jsonb_build_object('ok', false, 'error', case when k.attempts + 1 >= 5 then 'expired' else 'wrong' end, 'left', greatest(4 - k.attempts, 0));
  end if;
  update shop.sign_in_codes set used_at = now() where id = k.id;
  if exists (select 1 from shop.customers where email = v_email and id <> v) then return jsonb_build_object('ok', false, 'error', 'taken'); end if;
  select email into v_old from shop.customers where id = v for update;
  update shop.customers set email = v_email, email_confirmed_at = now() where id = v;
  update shop.orders set customer_id = v where customer_id is null and lower(email) = v_email;
  insert into shop.customer_events (customer_id, event, detail) values (v, 'email_changed', left(format('from %s', v_old), 300));
  return jsonb_build_object('ok', true);
end;
$$;

-- 4. For the people who run the shop (ArkOS > Shop > Customers).

-- One step on a customer's account: block, unblock, sign_out, close, edit (name, mobile number, address). The
-- sign-in address is not among them.
create or replace function shop.customer_step(p_customer uuid, p_step text, p_data jsonb default '{}'::jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c shop.customers%rowtype;
  v_note text := left(nullif(btrim(coalesce(p_data ->> 'note', '')), ''), 300);
begin
  if not shared.module_editable('shop') then
    raise exception 'Only people who may edit the Shop work on customers' using errcode = '42501';
  end if;
  select * into c from shop.customers where id = p_customer for update;
  if not found then raise exception 'That customer was not found' using errcode = 'P0002'; end if;
  if c.status = 'closed' then raise exception 'This account is closed' using errcode = '23514'; end if;

  if p_step = 'block' then
    if c.status = 'blocked' then raise exception 'This account is already blocked' using errcode = '23514'; end if;
    delete from shop.customer_sessions where customer_id = c.id;
    update shop.customers set status = 'blocked', status_at = now() where id = c.id;
  elsif p_step = 'unblock' then
    if c.status <> 'blocked' then raise exception 'This account is not blocked' using errcode = '23514'; end if;
    update shop.customers set status = 'active', status_at = now() where id = c.id;
  elsif p_step = 'sign_out' then
    delete from shop.customer_sessions where customer_id = c.id;
  elsif p_step = 'edit' then
    perform shop.customer_set_details(c.id, p_data);
  elsif p_step = 'close' then
    perform shop.customer_close(c.id, (select auth.uid()));
    return 'closed';
  else
    raise exception 'Not a step for a customer: %', p_step using errcode = '22023';
  end if;
  insert into shop.customer_events (customer_id, event, detail, by_staff_id)
  values (c.id, case p_step when 'block' then 'blocked' when 'unblock' then 'unblocked' when 'sign_out' then 'signed_out_everywhere' else 'details_changed' end,
          v_note, (select auth.uid()));
  return (select status from shop.customers where id = c.id);
end;
$$;

-- How many devices a customer is signed in on (the sessions themselves are read by nobody).
create or replace function shop.customer_devices(p_customer uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not shared.module_viewable('shop') then
    raise exception 'Only people who may see the Shop see customers' using errcode = '42501';
  end if;
  return (select count(*) from shop.customer_sessions where customer_id = p_customer and expires_at > now());
end;
$$;

revoke all on function shop.session_customer(text), shop.customer_set_details(uuid, jsonb), shop.customer_close(uuid, uuid), shop.web_sign_in_start(text, text, text), shop.web_sign_in_finish(text, text, text, text), shop.web_customer(text), shop.web_customer_orders(text), shop.web_customer_save(text, jsonb), shop.web_sign_out(text, boolean), shop.web_claim_order(text, text), shop.web_customer_close(text), shop.web_email_change_start(text, text, text, text), shop.web_email_change_finish(text, text, text), shop.customer_step(uuid, text, jsonb), shop.customer_devices(uuid) from public, anon, authenticated, shop_web;
grant execute on function shop.web_sign_in_start(text, text, text) to shop_web;
grant execute on function shop.web_sign_in_finish(text, text, text, text) to shop_web;
grant execute on function shop.web_customer(text) to shop_web;
grant execute on function shop.web_customer_orders(text) to shop_web;
grant execute on function shop.web_customer_save(text, jsonb) to shop_web;
grant execute on function shop.web_sign_out(text, boolean) to shop_web;
grant execute on function shop.web_claim_order(text, text) to shop_web;
grant execute on function shop.web_customer_close(text) to shop_web;
grant execute on function shop.web_email_change_start(text, text, text, text) to shop_web;
grant execute on function shop.web_email_change_finish(text, text, text) to shop_web;
grant execute on function shop.customer_step(uuid, text, jsonb) to authenticated;
grant execute on function shop.customer_devices(uuid) to authenticated;
grant execute on all functions in schema shop to service_role;

-- 5. The Customers page of the Shop menu, with the same levels as the rest of it: Shop Admin work in it; Finance
-- and the CEO read.
insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level from (values ('shop.customers')) p(page)
cross join (values ('shop_admin', 'edit'), ('finance', 'view'), ('ceo', 'view')) r(role, level)
where exists (select 1 from shared.roles where key = r.role)
on conflict do nothing;

-- 6. Live updates in ArkOS.
do $$
declare
  t text;
begin
  foreach t in array array['customers', 'customer_events'] loop
    begin
      execute format('alter publication supabase_realtime add table shop.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
