-- 0170: Operations Stocks under Inventory too (owner, 22 Nov 2026: "Let's add this to ArkOS under Inventory",
-- about LAF Inventory's Operations Stocks). The page has been in House Operations since 0106; it now also
-- opens as Inventory > Operations Stocks, for the roles that see Inventory (the Inventory Lead and Staff, the
-- Chef, Finance, the nutritionist, house staff), read only, the same figures.
--   1. ops.house_stock_status(): House Operations OR Inventory viewers (it was House Operations only).
--   2. The page inventory.stocks, with the levels the Inventory overview page has.

create or replace function ops.house_stock_status()
 returns table(group_id text, group_name text, group_sort integer, line_id text, line_name text, line_sort integer, min_days integer, items integer, on_hand numeric, uom text, mixed_units boolean, draws integer, used_per_day numeric, days_left numeric, status text)
 language plpgsql
 stable security definer
 set search_path to 'ops', 'inventory', 'pg_temp'
as $function$
begin
  if not shared.module_viewable(variadic array['house_ops', 'inventory']) then
    raise exception 'House Operations or Inventory access is needed to see the stocks' using errcode = '42501';
  end if;
  return query select * from inventory.house_stock_status();
end;
$function$;

insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level
  from shared.role_page_access r cross join (values ('inventory.stocks')) p(page)
 where r.page = 'inventory.overview'
on conflict do nothing;
