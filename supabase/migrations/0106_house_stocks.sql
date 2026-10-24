-- 0106: Operations Stocks, read-only in arkos (user, 2026-10-24).
--
-- LAF Inventory 0066 keeps the boxes of critical items (Rice, Pork, Paper Cups…) and works out each
-- one's count, usage rate and projected days left in inventory.house_stock_status(). House Ops
-- viewers see the same boxes here; the math lives in one place. Apply Inventory 0066 first.
create function ops.house_stock_status()
returns table (
  group_id text, group_name text, group_sort integer,
  line_id text, line_name text, line_sort integer, min_days integer,
  items integer, on_hand numeric, uom text, mixed_units boolean,
  draws integer, used_per_day numeric, days_left numeric, status text
)
language plpgsql stable security definer
set search_path to 'ops', 'inventory', 'pg_temp' as $$
begin
  if not shared.module_viewable('house_ops') then
    raise exception 'House Operations access is needed to see the stocks' using errcode = '42501';
  end if;
  return query select * from inventory.house_stock_status();
end;
$$;
revoke all on function ops.house_stock_status() from public;
grant execute on function ops.house_stock_status() to authenticated;

-- The new page House Ops > Stocks opens for every role exactly as Meals does (0093 pages).
insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level
  from shared.role_page_access r cross join (values ('house_ops.stocks')) p(page)
 where r.page = 'house_ops.meals'
on conflict do nothing;

notify pgrst, 'reload schema';
