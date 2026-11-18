-- 0159 The shop's menu follows Shop settings (user, 18 Nov 2026).
--
-- The shop site's main menu shows "Shop all", the first three categories and "More" (the rest). Which categories
-- lead is the foundation's choice: it is the order of the category list in ArkOS > Shop > Shop settings. Until now
-- the site only saw each product's category, in product order, so the catalogue the site reads now also carries
-- the two ordered lists (categories, collections).
--
-- The function is the live one (0155) with those two lines added; nothing else in it changes.

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
    -- The lists as Shop settings order them: the site's menu and its home page follow this order (0159).
    'categories', to_jsonb(s.categories),
    'collections', to_jsonb(s.collections),
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

revoke all on function shop.web_catalog() from public, anon, authenticated, shop_web;
grant execute on function shop.web_catalog() to shop_web;
grant execute on all functions in schema shop to service_role;

-- The order approved for the menu (Apparel, Bags, Drinkware first), only where the list is still the one the shop
-- started with. A list the foundation has already changed is left exactly as it is.
update shop.settings
   set categories = array['Apparel', 'Bags', 'Drinkware', 'Accessories', 'Home & desk', 'Gift sets']
 where categories = array['Apparel', 'Drinkware', 'Bags', 'Accessories', 'Home & desk', 'Gift sets'];
