-- 0091: manage users (asked 2026-10-14): switch an account off and on, remove one that was never
-- used, reset a PIN, and raise or lower what ONE person can open.
--
--   1. shared.staff_module_access: per-person overrides of the role grid (0050). One row per
--      person and module, None / View / Edit; no row = the roles decide, as before.
--      shared.module_level() reads it first, so the 210 policies built on module_viewable /
--      module_editable follow it without being touched. Never for an admin (always full), never
--      for Settings (stays with admins), never for an outside account (0090: its areas are the
--      grid's outside rows).
--   2. shared.staff_events: what an admin did to an account and when (created, access changed,
--      override set, switched off/on, PIN reset, removed). Written by the server actions, read
--      by admins, never changed.
--   3. shared.delete_unused_staff(): removes an account that has no record anywhere. 67 foreign
--      keys point at shared.staff with no ON DELETE, so Postgres itself refuses an account with
--      history; the ids kept without a foreign key are checked by hand. Deactivating is the
--      normal way to let someone go -- this is for an account made by mistake.
--
-- Needs 0090. Rollback: supabase/rollbacks/0091_down.sql

-- ---------------------------------------------------------------------
-- 1. Per-person overrides
-- ---------------------------------------------------------------------
create table shared.staff_module_access (
  staff_id uuid not null references shared.staff(id) on delete cascade,
  module text not null check (module = any (array['executive', 'dashboard', 'calendar', 'staff', 'hr', 'patients', 'house_ops', 'donors', 'inventory', 'finance', 'compliance', 'analytics', 'reports', 'transport'])),
  level text not null check (level = any (array['none', 'view', 'edit'])),
  updated_at timestamptz not null default now(),
  updated_by uuid references shared.staff(id),
  primary key (staff_id, module)
);
comment on table shared.staff_module_access is 'What one person may open, overriding their roles'' grid rows (0091). No row = the roles decide.';

create or replace function shared.guard_staff_module_access()
returns trigger
language plpgsql
as $$
declare
  v_role text;
begin
  select role into v_role from shared.staff where id = new.staff_id;
  if v_role = 'admin' then
    raise exception 'Admins always have full access' using errcode = '23514';
  end if;
  if v_role = 'partner_viewer' then
    raise exception 'An outside account''s areas are set under Roles & Access' using errcode = '23514';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger guard_staff_module_access before insert or update on shared.staff_module_access
  for each row execute function shared.guard_staff_module_access();

alter table shared.staff_module_access enable row level security;
create policy "admins manage overrides" on shared.staff_module_access
  for all to authenticated using (shared.has_role('admin')) with check (shared.has_role('admin'));
create policy "own overrides" on shared.staff_module_access
  for select to authenticated using (staff_id = (select auth.uid()));
revoke all on shared.staff_module_access from authenticated;
grant select, insert, update, delete on shared.staff_module_access to authenticated;
alter publication supabase_realtime add table shared.staff_module_access;

-- The person's own row wins; otherwise the highest level among their roles, as 0073 had it.
create or replace function shared.module_level(p_module text)
returns text
language sql
stable
security definer
set search_path = shared, pg_temp
as $$
  select case
    when rs is null then 'none'
    when 'admin' = any (rs) then 'edit'
    else coalesce(
      (select o.level from shared.staff_module_access o where o.staff_id = auth.uid() and o.module = p_module),
      (
        select case max(case a.level when 'edit' then 2 when 'view' then 1 else 0 end) when 2 then 'edit' when 1 then 'view' end
        from shared.module_access a
        where a.role = any (rs) and a.module = p_module
      ),
      'none')
  end
  from (select shared.current_staff_roles() as rs) s;
$$;

-- ---------------------------------------------------------------------
-- 2. What an admin did to an account
-- ---------------------------------------------------------------------
create table shared.staff_events (
  id bigint generated always as identity primary key,
  staff_id uuid references shared.staff(id) on delete set null,
  staff_name text not null,
  action text not null check (action = any (array['created', 'access_changed', 'override_set', 'deactivated', 'reactivated', 'pin_reset', 'deleted'])),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references shared.staff(id) on delete set null,
  actor_name text not null,
  at timestamptz not null default now()
);
comment on table shared.staff_events is 'Admin actions on accounts (0091): written by the server actions, read by admins, never changed.';
create index staff_events_staff_at on shared.staff_events (staff_id, at desc);
alter table shared.staff_events enable row level security;
create policy "admins read account events" on shared.staff_events for select to authenticated using (shared.has_role('admin'));
revoke all on shared.staff_events from authenticated;
grant select on shared.staff_events to authenticated;

-- ---------------------------------------------------------------------
-- 3. Removing an account that was never used
-- ---------------------------------------------------------------------
create or replace function shared.delete_unused_staff(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = shared, pg_temp
as $$
declare
  v_role text;
  v_active boolean;
begin
  if not shared.has_role('admin') then
    raise exception 'Only admins can remove an account' using errcode = '42501';
  end if;
  if p_staff_id = auth.uid() then
    raise exception 'You can''t remove your own account' using errcode = '22023';
  end if;
  select role, active into v_role, v_active from shared.staff where id = p_staff_id;
  if v_role is null then
    raise exception 'That account no longer exists' using errcode = '22023';
  end if;
  if v_role = 'admin' and v_active and (select count(*) from shared.staff where role = 'admin' and active) <= 1 then
    raise exception 'At least one active Super Admin must remain' using errcode = '22023';
  end if;
  -- Ids kept without a foreign key (the keyed ones refuse the delete below on their own).
  if exists (select 1 from inventory.lot_corrections where performed_by_staff_id = p_staff_id)
     or exists (select 1 from inventory.transaction_corrections where performed_by_staff_id = p_staff_id)
     or exists (select 1 from inventory.audit_log where actor_id = p_staff_id)
     or exists (select 1 from ops.bed_rule_exceptions where allowed_by = p_staff_id)
     or exists (select 1 from ops.bed_moves where moved_by = p_staff_id)
     or exists (select 1 from ops.donor_suggestions where created_by = p_staff_id or decided_by = p_staff_id)
     or exists (select 1 from ops.donor_merges where merged_by = p_staff_id)
     or exists (select 1 from ops.donor_sheet_names where decided_by = p_staff_id)
     or exists (select 1 from ops.sheet_name_hints where created_by = p_staff_id)
  then
    raise exception 'This account has records; switch it off instead' using errcode = '23503';
  end if;
  delete from inventory.login_attempts where staff_id = p_staff_id;
  delete from inventory.staff_house where staff_id = p_staff_id;
  if to_regclass('inventory_staging.staff_house') is not null then
    execute 'delete from inventory_staging.staff_house where staff_id = $1' using p_staff_id;
  end if;
  begin
    delete from shared.staff where id = p_staff_id;
  exception when foreign_key_violation then
    raise exception 'This account has records; switch it off instead' using errcode = '23503';
  end;
end;
$$;
revoke all on function shared.delete_unused_staff(uuid) from public;
grant execute on function shared.delete_unused_staff(uuid) to authenticated;
comment on function shared.delete_unused_staff(uuid) is 'Removes an account with no record anywhere (0091); the auth user is removed by the server action afterwards.';
