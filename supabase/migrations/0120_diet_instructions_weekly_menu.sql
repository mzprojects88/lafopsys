-- 0120: a doctor's food instructions on the child's record, and the weekly menu in House Operations
-- (Sprint 10; with LAF Inventory 0068, which holds the menu itself).
--
--   * ops.diet_instructions: what a doctor said a child or their carer may or may not eat, written
--     by the Social Worker (Patients editors), read by those who see clinical detail. The menu's
--     AI reads them anonymised; the kitchen sees the name only with the clinical-detail power.
--   * House Operations > Weekly Menu: the Social Worker edits the menu, the Nutritionist / Dietician
--     approves it and may build a week by hand against Operations Stocks. The Nutritionist gets
--     House Operations (view), the menu page (edit) and clinical detail.

create table if not exists ops.diet_instructions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references ops.patients (id) on delete cascade,
  applies_to text not null default 'patient' check (applies_to in ('patient', 'carer')),
  carer_name text check (carer_name is null or length(carer_name) <= 120),
  instruction text not null check (length(instruction) between 3 and 500),
  given_by text check (given_by is null or length(given_by) <= 120),
  given_on date,
  until date,
  active boolean not null default true,
  created_by uuid default auth.uid() references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists diet_instructions_patient on ops.diet_instructions (patient_id, active);
comment on table ops.diet_instructions is 'A doctor''s food instructions for a child or their carer (0120); the weekly menu is checked against the active ones.';
alter table ops.diet_instructions enable row level security;
drop policy if exists "clinical readers read food instructions" on ops.diet_instructions;
drop policy if exists "patients editors write food instructions" on ops.diet_instructions;
create policy "clinical readers read food instructions" on ops.diet_instructions for select to authenticated
  using ((select shared.has_power('clinical_detail')) and (select shared.module_viewable('patients', 'house_ops')));
create policy "patients editors write food instructions" on ops.diet_instructions for all to authenticated
  using ((select shared.module_editable('patients')))
  with check ((select shared.module_editable('patients')));
grant select, insert, update, delete on ops.diet_instructions to authenticated;
drop trigger if exists set_updated_at on ops.diet_instructions;
create trigger set_updated_at before update on ops.diet_instructions for each row execute function shared.set_updated_at();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'ops' and tablename = 'diet_instructions') then
    alter publication supabase_realtime add table ops.diet_instructions;
  end if;
end $$;

-- ---- the Weekly Menu page and the Nutritionist's access ----
-- The page's level per role: the Social Worker and the Nutritionist edit; whoever views House
-- Operations' Meals views it too.
insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level
  from shared.role_page_access r cross join (values ('house_ops.menu')) p(page)
 where r.page = 'house_ops.meals'
on conflict do nothing;
insert into shared.role_page_access (role, page, level) values ('social_worker', 'house_ops.menu', 'edit'), ('nutritionist', 'house_ops.menu', 'edit')
on conflict (role, page) do update set level = 'edit';
insert into shared.role_page_access (role, page, level)
select 'nutritionist', p, 'view' from unnest(array['house_ops.overview', 'house_ops.meals', 'house_ops.care_cart', 'house_ops.stocks']) as p
on conflict do nothing;
insert into shared.module_access (role, module, level) values ('nutritionist', 'house_ops', 'view') on conflict do nothing;
insert into shared.role_powers (role, power) values ('nutritionist', 'clinical_detail') on conflict do nothing;

notify pgrst, 'reload schema';
