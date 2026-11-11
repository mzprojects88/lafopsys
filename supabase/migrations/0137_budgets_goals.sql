-- 0137 Voucher System, phase 4: Goals and Budgets (decided 11 Nov 2026).
--
-- Goals: the CEO's 1-, 3- and 5-year goals, each with a target per year, measured by what ArkOS already counts
-- (people housed, rides, meals, Care Cart served, Activity Center participants, money raised, spending) or written
-- only. A page for the CEO, the Trustees and the Super Admin alone: the CEO and the Super Admin edit, the Trustees
-- read; nobody else sees it.
-- Budgets: by program, with the items their creator adds (patients and carers housed, meals served, trips...), each
-- with a quantity and/or an amount per month, keyed for the year or month by month. Finance and the CEO edit a
-- draft; only the CEO approves it, which locks it; a change afterwards is a revision with a reason, the earlier
-- version kept. Budget vs Actual compares only approved months. The yearly budget is due before January 1.

-- 1. Goals.
create table if not exists ops.goals (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 160),
  horizon smallint not null check (horizon in (1, 3, 5)),
  start_year integer not null check (start_year between 2020 and 2100),
  program_id text references ops.programs(id) on delete set null deferrable initially immediate,
  measure text not null default 'none' check (measure in ('housing', 'rides', 'meals', 'care_cart', 'center', 'donations', 'spending', 'none')),
  narrative text check (length(narrative) <= 2000),
  status text not null default 'active' check (status in ('active', 'achieved', 'dropped')),
  sort integer not null default 0,
  created_by uuid default auth.uid() references shared.staff(id) on delete set null deferrable initially immediate,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists ops.goal_targets (
  goal_id uuid not null references ops.goals(id) on delete cascade deferrable initially immediate,
  year integer not null check (year between 2020 and 2100),
  target numeric(14, 2) not null check (target >= 0),
  primary key (goal_id, year)
);

alter table ops.goals enable row level security;
alter table ops.goal_targets enable row level security;
drop policy if exists "leadership reads" on ops.goals;
drop policy if exists "ceo writes" on ops.goals;
drop policy if exists "leadership reads" on ops.goal_targets;
drop policy if exists "ceo writes" on ops.goal_targets;
create policy "leadership reads" on ops.goals for select to authenticated using ((select shared.has_role('ceo', 'board', 'admin')));
create policy "ceo writes" on ops.goals for all to authenticated using ((select shared.has_role('ceo', 'admin'))) with check ((select shared.has_role('ceo', 'admin')));
create policy "leadership reads" on ops.goal_targets for select to authenticated using ((select shared.has_role('ceo', 'board', 'admin')));
create policy "ceo writes" on ops.goal_targets for all to authenticated using ((select shared.has_role('ceo', 'admin'))) with check ((select shared.has_role('ceo', 'admin')));
grant select, insert, update, delete on ops.goals, ops.goal_targets to authenticated;
drop trigger if exists set_updated_at on ops.goals;
create trigger set_updated_at before update on ops.goals for each row execute function shared.set_updated_at();

-- 2. Budgets: a version per year (one draft at a time), its items by program, and the months' figures.
create table if not exists ops.budgets (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2020 and 2100),
  version integer not null default 1 check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  note text check (length(note) <= 2000),
  revision_reason text check (length(revision_reason) <= 1000),
  approved_by uuid references shared.staff(id) on delete set null deferrable initially immediate,
  approved_at timestamptz,
  created_by uuid default auth.uid() references shared.staff(id) on delete set null deferrable initially immediate,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year, version),
  check (status = 'draft' or approved_at is not null)
);
create unique index if not exists budgets_one_draft on ops.budgets (year) where status = 'draft';
create table if not exists ops.budget_items (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references ops.budgets(id) on delete cascade deferrable initially immediate,
  t3_id uuid references ops.fin_codes(id) on delete restrict deferrable initially immediate,
  label text not null check (length(btrim(label)) between 1 and 160),
  unit text check (length(unit) <= 40),
  measure text check (measure in ('housing', 'rides', 'meals', 'care_cart', 'center')),
  account_id uuid references ops.coa_accounts(id) on delete restrict deferrable initially immediate,
  sort integer not null default 0
);
create index if not exists budget_items_budget on ops.budget_items (budget_id, sort);
create table if not exists ops.budget_values (
  item_id uuid not null references ops.budget_items(id) on delete cascade deferrable initially immediate,
  month smallint not null check (month between 1 and 12),
  quantity numeric(14, 2) check (quantity >= 0),
  amount numeric(14, 2) check (amount >= 0),
  primary key (item_id, month)
);

-- Who keys budgets in: Finance's editors, the CEO and the Super Admin. Who reads them: Finance's viewers too, and
-- the Trustees.
create or replace function ops.budget_editor()
returns boolean language sql stable security definer set search_path = shared, pg_temp as $$
  select shared.current_staff_roles() is not null and (shared.module_level('finance') = 'edit' or shared.has_role('ceo', 'admin'));
$$;
create or replace function ops.budget_reader()
returns boolean language sql stable security definer set search_path = shared, pg_temp as $$
  select shared.current_staff_roles() is not null and (shared.module_level('finance') <> 'none' or shared.has_role('ceo', 'board', 'admin'));
$$;
revoke all on function ops.budget_editor() from public;
revoke all on function ops.budget_reader() from public;
grant execute on function ops.budget_editor(), ops.budget_reader() to authenticated, service_role;
-- A draft's items and figures change; an approved or superseded version's never do.
create or replace function ops.budget_is_draft(p_budget uuid)
returns boolean language sql stable security definer set search_path = ops, pg_temp as $$
  select exists (select 1 from ops.budgets where id = p_budget and status = 'draft');
$$;
revoke all on function ops.budget_is_draft(uuid) from public;
grant execute on function ops.budget_is_draft(uuid) to authenticated, service_role;

alter table ops.budgets enable row level security;
alter table ops.budget_items enable row level security;
alter table ops.budget_values enable row level security;
drop policy if exists "readers read" on ops.budgets;
drop policy if exists "editors add drafts" on ops.budgets;
drop policy if exists "editors change drafts" on ops.budgets;
drop policy if exists "editors remove drafts" on ops.budgets;
create policy "readers read" on ops.budgets for select to authenticated using ((select ops.budget_reader()));
create policy "editors add drafts" on ops.budgets for insert to authenticated with check ((select ops.budget_editor()) and status = 'draft' and approved_at is null);
create policy "editors change drafts" on ops.budgets for update to authenticated using ((select ops.budget_editor()) and status = 'draft') with check ((select ops.budget_editor()) and status = 'draft' and approved_at is null);
create policy "editors remove drafts" on ops.budgets for delete to authenticated using ((select ops.budget_editor()) and status = 'draft');
drop policy if exists "readers read" on ops.budget_items;
drop policy if exists "editors write drafts" on ops.budget_items;
create policy "readers read" on ops.budget_items for select to authenticated using ((select ops.budget_reader()));
create policy "editors write drafts" on ops.budget_items for all to authenticated using ((select ops.budget_editor()) and ops.budget_is_draft(budget_id)) with check ((select ops.budget_editor()) and ops.budget_is_draft(budget_id));
drop policy if exists "readers read" on ops.budget_values;
drop policy if exists "editors write drafts" on ops.budget_values;
create policy "readers read" on ops.budget_values for select to authenticated using ((select ops.budget_reader()));
create policy "editors write drafts" on ops.budget_values for all to authenticated
  using ((select ops.budget_editor()) and exists (select 1 from ops.budget_items i where i.id = item_id and ops.budget_is_draft(i.budget_id)))
  with check ((select ops.budget_editor()) and exists (select 1 from ops.budget_items i where i.id = item_id and ops.budget_is_draft(i.budget_id)));
grant select, insert, update, delete on ops.budgets, ops.budget_items, ops.budget_values to authenticated;
drop trigger if exists set_updated_at on ops.budgets;
create trigger set_updated_at before update on ops.budgets for each row execute function shared.set_updated_at();

-- Only the CEO approves (decided 11 Nov: "only CEO or Butch approves"); the year's earlier approved version is
-- superseded, so one version stands per year.
create or replace function ops.budget_approve(p_id uuid)
returns void language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare b ops.budgets;
begin
  if not shared.has_role('ceo') then
    raise exception 'Only the CEO approves a budget.' using errcode = '42501';
  end if;
  select * into b from ops.budgets where id = p_id for update;
  if not found or b.status <> 'draft' then
    raise exception 'Only a draft budget can be approved.' using errcode = '23514';
  end if;
  if not exists (select 1 from ops.budget_items where budget_id = b.id) then
    raise exception 'The budget has no items yet.' using errcode = '23514';
  end if;
  update ops.budgets set status = 'superseded' where year = b.year and status = 'approved';
  update ops.budgets set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = b.id;
end $$;
revoke all on function ops.budget_approve(uuid) from public;
grant execute on function ops.budget_approve(uuid) to authenticated;

-- A change after approval: a new draft version copied from the approved one, with the reason; the approved version
-- stands until the CEO approves the revision.
create or replace function ops.budget_revise(p_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = ops, shared, pg_temp as $$
declare
  b ops.budgets;
  v_new uuid;
  i ops.budget_items;
  v_item uuid;
begin
  if not ops.budget_editor() then
    raise exception 'Only Finance or the CEO keys in budgets.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Say why the budget changes.' using errcode = '23514';
  end if;
  select * into b from ops.budgets where id = p_id;
  if not found or b.status <> 'approved' then
    raise exception 'Only the approved budget is revised.' using errcode = '23514';
  end if;
  if exists (select 1 from ops.budgets where year = b.year and status = 'draft') then
    raise exception 'A revision of % is already being keyed in.', b.year using errcode = '23514';
  end if;
  insert into ops.budgets (year, version, status, note, revision_reason)
  values (b.year, (select max(version) + 1 from ops.budgets where year = b.year), 'draft', b.note, btrim(p_reason)) returning id into v_new;
  for i in select * from ops.budget_items where budget_id = b.id loop
    insert into ops.budget_items (budget_id, t3_id, label, unit, measure, account_id, sort)
    values (v_new, i.t3_id, i.label, i.unit, i.measure, i.account_id, i.sort) returning id into v_item;
    insert into ops.budget_values (item_id, month, quantity, amount) select v_item, month, quantity, amount from ops.budget_values where item_id = i.id;
  end loop;
  return v_new;
end $$;
revoke all on function ops.budget_revise(uuid, text) from public;
grant execute on function ops.budget_revise(uuid, text) to authenticated;

-- 3. When the next year's budget is due, and from when the bell reminds (Financial Settings › General).
alter table ops.finance_settings
  add column if not exists budget_due_month smallint not null default 12 check (budget_due_month between 1 and 12),
  add column if not exists budget_due_day smallint not null default 31 check (budget_due_day between 1 and 31),
  add column if not exists budget_remind_days smallint not null default 30 check (budget_remind_days between 0 and 180);

-- 4. The pages: Goals for the CEO (edit) and the Trustees (view); Budgets for Finance (edit) and the CEO and the
-- Trustees (view; the CEO edits and approves by role).
insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level from (values ('executive.goals')) p(page)
cross join (values ('ceo', 'edit'), ('board', 'view')) r(role, level)
where exists (select 1 from shared.roles where key = r.role)
on conflict do nothing;
insert into shared.role_page_access (role, page, level)
select r.role, p.page, r.level from (values ('finance.budgets')) p(page)
cross join (values ('finance', 'edit'), ('office_admin', 'edit'), ('ceo', 'view'), ('board', 'view')) r(role, level)
where exists (select 1 from shared.roles where key = r.role)
on conflict do nothing;

do $$ begin
  alter publication supabase_realtime add table ops.goals, ops.goal_targets, ops.budgets, ops.budget_items, ops.budget_values;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
