-- 0095: donation totals split food / non-food, and meals served per family (user, 2026-10-15).
--
--   1. ops.gik_batches(from, to): every gift-in-kind batch LAF Inventory logged (one receipt =
--      one donated batch, with its AR number once issued), with its food and non-food value.
--      Food = the line's category is flagged for meals (inventory.categories.meal_use) -- the
--      same flag that decides what may go into meals and the Care Cart, so the totals can never
--      disagree with the kitchen. The receipts are readable only by inventory roles, so this
--      reads them as its owner and answers only callers who may view Donors.
--   2. ops.meals_served: breakfast, lunch and dinner ticked per patient per day on House Today
--      (the patient and the carer were served). The dish comes later from LAF Inventory's meal
--      service for the same date and meal; no link column needed.

-- ---- 1. gift-in-kind batches with food / non-food ----
create or replace function ops.gik_batches(p_from date, p_to date)
returns table (
  receipt_id text, date date, donor_id uuid, ar_number text, booklet_ar_number text,
  lines integer, food_value numeric, nonfood_value numeric, total_value numeric
)
language plpgsql stable security definer
set search_path to 'ops', 'inventory', 'pg_temp' as $$
begin
  if not shared.module_viewable('donors') then
    raise exception 'Donors access is needed to see donation totals' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3700 then
    raise exception 'Give a date range of up to ten years' using errcode = '22023';
  end if;
  return query
    select r.id, r.date, r.donor_id, r.ar_number, r.booklet_ar_number,
           count(l.id)::int,
           coalesce(sum(l.value) filter (where c.meal_use), 0)::numeric,
           coalesce(sum(l.value) filter (where c.meal_use is not true), 0)::numeric,
           coalesce(sum(l.value), 0)::numeric
      from inventory.donation_log r
      left join inventory.donation_lines l on l.donation_id = r.id
      left join inventory.categories c on c.name = l.category
     where r.date between p_from and p_to
     group by r.id
     order by r.date desc, r.id;
end;
$$;
revoke all on function ops.gik_batches(date, date) from public;
grant execute on function ops.gik_batches(date, date) to authenticated;

-- The new page Donors > Totals opens for every role exactly as the Donors list does (0093 pages).
insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level
  from shared.role_page_access r cross join (values ('donors.totals')) p(page)
 where r.page = 'donors.list'
on conflict do nothing;

-- ---- 2. meals served ----
create table if not exists ops.meals_served (
  patient_id uuid not null references ops.patients (id) on delete cascade,
  date date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner')),
  served_by uuid default auth.uid() references shared.staff (id),
  served_at timestamptz not null default now(),
  primary key (patient_id, date, meal)
);
comment on table ops.meals_served is 'A meal served to a patient and their carer at LAF House (0095). One row per patient, day and meal.';

-- Who and when come from the session, never from the screen; today only, so the record is what
-- happened at the table, not filled in later. The Super Admin may correct an earlier day.
create or replace function ops.guard_meals_served()
returns trigger language plpgsql
set search_path to 'ops', 'pg_temp' as $$
declare
  manila_today date := (now() at time zone 'Asia/Manila')::date;
  d date := coalesce(new.date, old.date);
begin
  if d <> manila_today and not shared.has_role('admin') then
    raise exception 'Meals can only be ticked for today' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.served_by := auth.uid();
    new.served_at := now();
    return new;
  end if;
  return old;
end;
$$;
drop trigger if exists guard_meals_served on ops.meals_served;
create trigger guard_meals_served before insert or delete on ops.meals_served
  for each row execute function ops.guard_meals_served();

alter table ops.meals_served enable row level security;
drop policy if exists "patients or house ops read meals" on ops.meals_served;
create policy "patients or house ops read meals" on ops.meals_served
  for select to authenticated using (shared.module_viewable('patients', 'house_ops'));
drop policy if exists "patients or house ops tick meals" on ops.meals_served;
create policy "patients or house ops tick meals" on ops.meals_served
  for insert to authenticated with check (shared.module_editable('patients') or shared.module_editable('house_ops'));
drop policy if exists "patients or house ops untick meals" on ops.meals_served;
create policy "patients or house ops untick meals" on ops.meals_served
  for delete to authenticated using (shared.module_editable('patients') or shared.module_editable('house_ops'));
revoke all on ops.meals_served from anon;
grant select, insert, delete on ops.meals_served to authenticated;

do $$ begin
  alter publication supabase_realtime add table ops.meals_served;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
