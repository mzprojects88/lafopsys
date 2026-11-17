-- 0155 The shop, part 1: its own section of the database, the catalogue, and the shop site's own login
-- (user, 17 Nov 2026; shop.littlearkfoundation.org and ArkOS > Shop).
--
-- The foundation sells merchandise on its own site. ArkOS > Shop is where staff keep the products; the public site
-- reads them. This part holds the catalogue: products, the items of each (one colour and size = one item, with its
-- price and stock), photos, delivery fees and the shop's settings. Orders and payments come in part 2.
--
-- Three decisions shape it:
--   - The shop's tables live in their own schema, `shop`, which the hourly production <-> development copy does not
--     cover (it copies ops / shared / hr / inventory). Test products and, later, test orders on development never
--     reach production, and customers' details never leave production.
--   - The public site signs in to the database as `shop_web`, a login that may run the storefront functions
--     (shop.web_*) and nothing else: it has no right on any table, in this schema or any other. This migration
--     creates the role without a password; the password is set by hand when the site is connected.
--   - Stock changes only through shop.stock_change, which records who, how many, why and the count afterwards.
--     Staff cannot edit the count of an item directly.
--
-- Product photos are kept in the public storage bucket `shop`: they are pictures meant for the public, so the site
-- shows them with a plain address and holds no key to the private file store.

-- 1. The schema, and the API's list of schemas (the full list is restated, as in 0105).
create schema if not exists shop;
grant usage on schema shop to authenticated, service_role;
alter role authenticator set pgrst.db_schemas = 'public, ops, inventory, shared, hr, sync, shop';
notify pgrst, 'reload config';

-- 2. The Shop menu: a new module with three pages, and the Shop Admin role.
alter table shared.module_access drop constraint if exists module_access_module_check;
alter table shared.module_access add constraint module_access_module_check
  check (module = any (array['executive', 'dashboard', 'calendar', 'staff', 'hr', 'patients', 'house_ops', 'donors', 'inventory', 'finance', 'compliance',
    'analytics', 'reports', 'settings', 'transport', 'inventory_stock', 'inventory_given_out', 'requests', 'shop']));
alter table shared.staff_module_access drop constraint if exists staff_module_access_module_check;
alter table shared.staff_module_access add constraint staff_module_access_module_check
  check (module = any (array['executive', 'dashboard', 'calendar', 'staff', 'hr', 'patients', 'house_ops', 'donors', 'inventory', 'finance', 'compliance',
    'analytics', 'reports', 'transport', 'requests', 'shop']));
alter table shared.role_page_access drop constraint if exists role_page_access_page_check;
alter table shared.role_page_access add constraint role_page_access_page_check
  check (page ~ '^(executive|dashboard|calendar|staff|hr|patients|house_ops|donors|inventory|finance|compliance|analytics|reports|transport|requests|shop)\.[a-z_]+$');

-- Shop Admin is an ordinary role, like one made in Settings > Roles & access: the Super Admin may rename it, change
-- its pages or archive it. If a role with that name already exists, it is left alone and nothing is seeded for it.
insert into shared.roles (key, name, description, built_in)
values ('shop_admin', 'Shop Admin', 'Runs the online shop: products, stock, orders and deliveries.', false)
on conflict do nothing;

-- The Shop Admin works in every Shop page; Finance and the CEO read them. The Super Admin always may. Shop Admin is
-- its own role, or an extra role given to someone who already has another (Settings > Staff).
insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level from (values ('shop.overview'), ('shop.products'), ('shop.settings')) p(page)
cross join (values ('shop_admin', 'edit'), ('finance', 'view'), ('ceo', 'view')) r(role, level)
where exists (select 1 from shared.roles where key = r.role)
on conflict do nothing;

-- 3. The catalogue.
create table if not exists shop.products (
  id uuid primary key default gen_random_uuid(),
  -- The product's address on the site: shop.littlearkfoundation.org/products/<slug>.
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 80),
  name text not null check (length(btrim(name)) between 2 and 120),
  category text not null check (length(btrim(category)) between 2 and 40),
  collection text check (collection is null or length(btrim(collection)) between 2 and 40),
  description text not null default '' check (length(description) <= 2000),
  details text not null default '' check (length(details) <= 2000),
  -- 'stock': pieces are counted and kept at the house. 'made': made to order by the supplier, no count kept.
  supply text not null default 'stock' check (supply in ('stock', 'made')),
  -- Days from the order to shipping, for a made-to-order product (counted stock uses the shop's packing days).
  lead_min smallint not null default 7 check (lead_min between 0 and 90),
  lead_max smallint not null default 10 check (lead_max between 0 and 120),
  weight_grams integer not null default 0 check (weight_grams between 0 and 50000),
  badge text check (badge is null or length(btrim(badge)) between 2 and 24),
  -- Only 'published' products, with a photo and an item on sale, show on the site.
  status text not null default 'draft' check (status in ('draft', 'published', 'hidden')),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references shared.staff(id) on delete set null deferrable initially immediate,
  check (lead_max >= lead_min)
);

-- One item (SKU): a product in one colour and size, with its own price and count.
create table if not exists shop.variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references shop.products(id) on delete cascade deferrable initially immediate,
  sku text not null unique check (sku ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' and length(sku) between 3 and 40),
  colour text check (colour is null or length(btrim(colour)) between 1 and 40),
  size text check (size is null or length(btrim(size)) between 1 and 20),
  price numeric(12, 2) not null check (price > 0 and price <= 1000000),
  -- What one piece costs the foundation; never shown on the site.
  cost numeric(12, 2) check (cost is null or (cost >= 0 and cost <= 1000000)),
  -- Pieces on the shelf, and how many of them unpaid orders are holding (part 2). Changed only by the functions.
  stock integer not null default 0 check (stock >= 0),
  held integer not null default 0 check (held >= 0),
  reorder_at integer not null default 0 check (reorder_at between 0 and 100000),
  active boolean not null default true,
  sort integer not null default 0,
  check (held <= stock)
);
create unique index if not exists variants_one_per_option on shop.variants (product_id, coalesce(lower(btrim(colour)), ''), coalesce(lower(btrim(size)), ''));
create index if not exists variants_product on shop.variants (product_id);

create table if not exists shop.photos (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references shop.products(id) on delete cascade deferrable initially immediate,
  -- The file's place in the public `shop` bucket.
  path text not null unique check (path ~ '^products/[a-z0-9-]+/[a-z0-9._-]+\.(jpg|jpeg|png|webp)$' and length(path) <= 200),
  label text check (label is null or length(btrim(label)) between 1 and 30),
  alt text not null default '' check (length(alt) <= 160),
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists photos_product on shop.photos (product_id);

-- Every change of a count: received from the supplier, a recount, damaged, returned; later sold and cancelled.
create table if not exists shop.stock_moves (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references shop.variants(id) on delete cascade deferrable initially immediate,
  qty integer not null check (qty <> 0),
  reason text not null check (reason in ('received', 'count', 'damaged', 'returned', 'sold', 'cancelled')),
  note text check (note is null or length(note) <= 300),
  stock_after integer not null check (stock_after >= 0),
  by_staff_id uuid references shared.staff(id) on delete set null deferrable initially immediate,
  at timestamptz not null default now()
);
create index if not exists stock_moves_variant on shop.stock_moves (variant_id, at desc);

-- The delivery fee by area and weight: the first bracket the order's weight fits. Kept in Shop settings.
create table if not exists shop.delivery_fees (
  id uuid primary key default gen_random_uuid(),
  area text not null check (area in ('Metro Manila', 'Luzon', 'Visayas', 'Mindanao')),
  max_grams integer not null check (max_grams between 1 and 50000),
  fee numeric(12, 2) not null check (fee >= 0 and fee <= 100000),
  unique (area, max_grams)
);

-- One row of settings. The shop stays closed (the site shows the products but takes no orders) until it is opened.
create table if not exists shop.settings (
  id boolean primary key default true check (id),
  shop_open boolean not null default false,
  -- Days to pack an order of counted stock.
  pack_min smallint not null default 1 check (pack_min between 0 and 30),
  pack_max smallint not null default 2 check (pack_max between 0 and 60),
  pickup_enabled boolean not null default true,
  pickup_address text not null default '' check (length(pickup_address) <= 300),
  pickup_note text not null default '' check (length(pickup_note) <= 300),
  categories text[] not null default array['Apparel', 'Drinkware', 'Bags', 'Accessories', 'Home & desk', 'Gift sets'] check (cardinality(categories) between 1 and 20),
  collections text[] not null default array['The Ark', 'HEARTS', 'Give Hope'] check (cardinality(collections) <= 20),
  updated_at timestamptz not null default now(),
  updated_by uuid references shared.staff(id) on delete set null deferrable initially immediate,
  check (pack_max >= pack_min)
);
insert into shop.settings (id) values (true) on conflict do nothing;

create or replace function shop.touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists touch on shop.products;
create trigger touch before insert or update on shop.products for each row execute function shop.touch();
drop trigger if exists touch on shop.settings;
create trigger touch before update on shop.settings for each row execute function shop.touch();

-- 4. Who reads and writes: Shop viewers read, Shop editors write. Nothing here is open to a signed-out visitor.
alter table shop.products enable row level security;
alter table shop.variants enable row level security;
alter table shop.photos enable row level security;
alter table shop.stock_moves enable row level security;
alter table shop.delivery_fees enable row level security;
alter table shop.settings enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['products', 'variants', 'photos', 'delivery_fees'] loop
    execute format('drop policy if exists "shop viewers read" on shop.%I', t);
    execute format('create policy "shop viewers read" on shop.%I for select to authenticated using ((select shared.module_viewable(''shop'')))', t);
    execute format('drop policy if exists "shop editors add" on shop.%I', t);
    execute format('create policy "shop editors add" on shop.%I for insert to authenticated with check ((select shared.module_editable(''shop'')))', t);
    execute format('drop policy if exists "shop editors change" on shop.%I', t);
    execute format('create policy "shop editors change" on shop.%I for update to authenticated using ((select shared.module_editable(''shop''))) with check ((select shared.module_editable(''shop'')))', t);
    execute format('drop policy if exists "shop editors remove" on shop.%I', t);
    execute format('create policy "shop editors remove" on shop.%I for delete to authenticated using ((select shared.module_editable(''shop'')))', t);
  end loop;
end $$;

drop policy if exists "shop viewers read" on shop.stock_moves;
create policy "shop viewers read" on shop.stock_moves for select to authenticated using ((select shared.module_viewable('shop')));
drop policy if exists "shop viewers read" on shop.settings;
create policy "shop viewers read" on shop.settings for select to authenticated using ((select shared.module_viewable('shop')));
drop policy if exists "shop editors change" on shop.settings;
create policy "shop editors change" on shop.settings for update to authenticated
  using ((select shared.module_editable('shop'))) with check ((select shared.module_editable('shop')));

revoke all on all tables in schema shop from public, anon, authenticated;
grant select, insert, update, delete on shop.products, shop.photos, shop.delivery_fees to authenticated;
-- An item's count and what is held are not among the columns staff may write: only the functions change them.
grant select, delete on shop.variants to authenticated;
grant insert (id, product_id, sku, colour, size, price, cost, reorder_at, active, sort) on shop.variants to authenticated;
grant update (sku, colour, size, price, cost, reorder_at, active, sort) on shop.variants to authenticated;
grant select on shop.stock_moves to authenticated;
grant select, update on shop.settings to authenticated;
grant all on all tables in schema shop to service_role;

-- 5. Changing a count, with its trail.
create or replace function shop.stock_change(p_variant uuid, p_qty integer, p_reason text, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock integer;
  v_held integer;
begin
  if not shared.module_editable('shop') then
    raise exception 'Only people who may edit the Shop change stock' using errcode = '42501';
  end if;
  if p_qty is null or p_qty = 0 or abs(p_qty) > 100000 then
    raise exception 'Give the number of pieces, more or fewer' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('received', 'count', 'damaged', 'returned') then
    raise exception 'Choose why the count changes: received, a recount, damaged or returned' using errcode = '22023';
  end if;
  if (p_reason in ('received', 'returned') and p_qty < 0) or (p_reason = 'damaged' and p_qty > 0) then
    raise exception 'Received and returned add pieces; damaged takes them off' using errcode = '22023';
  end if;
  select stock, held into v_stock, v_held from shop.variants where id = p_variant for update;
  if not found then
    raise exception 'That item is no longer in the catalogue' using errcode = 'P0002';
  end if;
  if v_stock + p_qty < v_held then
    raise exception 'Only % can come off: % are held for orders', v_stock - v_held, v_held using errcode = '23514';
  end if;
  update shop.variants set stock = v_stock + p_qty where id = p_variant;
  insert into shop.stock_moves (variant_id, qty, reason, note, stock_after, by_staff_id)
  values (p_variant, p_qty, p_reason, nullif(btrim(left(coalesce(p_note, ''), 300)), ''), v_stock + p_qty, auth.uid());
  return v_stock + p_qty;
end;
$$;

-- 6. What the public site may ask for: the open catalogue. Published products that have a photo and an item on
-- sale, with each item's price and how many are left (counted stock only, never more than 99 so sales volumes are
-- not readable from outside). Cost, reorder points and drafts are never returned.
create or replace function shop.web_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'open', s.shop_open,
    'pack_min', s.pack_min,
    'pack_max', s.pack_max,
    'pickup', jsonb_build_object('enabled', s.pickup_enabled, 'address', s.pickup_address, 'note', s.pickup_note),
    'delivery', coalesce((
      select jsonb_agg(jsonb_build_object('area', d.area, 'max_grams', d.max_grams, 'fee', d.fee) order by d.area, d.max_grams)
      from shop.delivery_fees d), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(x.product order by x.sort, x.name)
      from (
        select p.sort, p.name, jsonb_build_object(
          'id', p.id, 'slug', p.slug, 'name', p.name, 'category', p.category, 'collection', p.collection,
          'description', p.description, 'details', p.details, 'supply', p.supply, 'lead_min', p.lead_min, 'lead_max', p.lead_max,
          'badge', p.badge, 'weight_grams', p.weight_grams,
          'photos', (
            select jsonb_agg(jsonb_build_object('path', f.path, 'alt', f.alt, 'label', f.label) order by f.sort, f.created_at)
            from shop.photos f where f.product_id = p.id),
          'variants', (
            select jsonb_agg(jsonb_build_object('id', v.id, 'sku', v.sku, 'colour', v.colour, 'size', v.size, 'price', v.price,
                     'left', case when p.supply = 'stock' then least(greatest(v.stock - v.held, 0), 99) end) order by v.sort, v.sku)
            from shop.variants v where v.product_id = p.id and v.active)
        ) as product
        from shop.products p
        where p.status = 'published'
          and exists (select 1 from shop.variants v where v.product_id = p.id and v.active)
          and exists (select 1 from shop.photos f where f.product_id = p.id)
      ) x), '[]'::jsonb)
  )
  from shop.settings s
$$;

-- 7. The shop site's own login. No password here: it is set by hand when the site is connected, and it lives only
-- in the site's hosting settings. The role may use the schema and run the web_ functions; it is granted no table.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'shop_web') then
    create role shop_web nologin noinherit;
  end if;
end $$;
alter role shop_web set statement_timeout = '8s';
grant usage on schema shop to shop_web;

revoke all on all functions in schema shop from public, anon, authenticated, shop_web;
grant execute on function shop.stock_change(uuid, integer, text, text) to authenticated;
grant execute on function shop.web_catalog() to shop_web;
grant execute on all functions in schema shop to service_role;

-- 8. Product photos: a public bucket (2 MB a file, pictures only). Anyone may open a photo by its address; only
-- Shop editors add, change or remove them, and Shop viewers list them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop', 'shop', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "shop viewers list product photos" on storage.objects;
create policy "shop viewers list product photos" on storage.objects for select to authenticated
  using (bucket_id = 'shop' and (select shared.module_viewable('shop')));
drop policy if exists "shop editors add product photos" on storage.objects;
create policy "shop editors add product photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'shop' and (select shared.module_editable('shop')));
drop policy if exists "shop editors change product photos" on storage.objects;
create policy "shop editors change product photos" on storage.objects for update to authenticated
  using (bucket_id = 'shop' and (select shared.module_editable('shop')))
  with check (bucket_id = 'shop' and (select shared.module_editable('shop')));
drop policy if exists "shop editors remove product photos" on storage.objects;
create policy "shop editors remove product photos" on storage.objects for delete to authenticated
  using (bucket_id = 'shop' and (select shared.module_editable('shop')));

-- 9. Live updates in ArkOS.
do $$
declare
  t text;
begin
  foreach t in array array['products', 'variants', 'photos', 'stock_moves', 'delivery_fees', 'settings'] loop
    begin
      execute format('alter publication supabase_realtime add table shop.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
