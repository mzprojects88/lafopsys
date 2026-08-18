-- Extends shared.staff.role to also allow laf-inventory's roles, and closes
-- a cross-app access gap this creates: ops.* RLS has always been blanket
-- "any authenticated staff, full access" (documented gap since Phase 0).
-- Once real laf-inventory-only accounts (chef/inventory_staff/nutritionist/
-- inventory_lead) exist in this same shared auth.users pool, that blanket
-- policy would let them read/write lafopsys's patient/finance/donor data via
-- direct API calls the laf-inventory UI never shows them. This role-gates
-- every existing ops.* RLS policy to lafopsys's own role set instead.

alter table shared.staff drop constraint staff_role_check;
alter table shared.staff add constraint staff_role_check check (
  role in (
    'admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer', -- lafopsys
    'inventory_staff', 'chef', 'nutritionist', 'inventory_lead' -- laf-inventory
  )
);

-- shared.staff's own RLS (roster readable by any authenticated staff) is left
-- untouched -- that cross-app directory visibility was an intentional Phase 0
-- decision, not part of this change.

do $$
declare
  t text;
  lafopsys_roles text := $roles$('admin','social_worker','house_staff','driver','finance','board','volunteer')$roles$;
begin
  for t in select tablename from pg_tables where schemaname = 'ops'
  loop
    execute format('drop policy if exists "authenticated staff full access" on ops.%I', t);
    execute format(
      'create policy "lafopsys staff full access" on ops.%I for all to authenticated using (shared.current_staff_role() in %s) with check (shared.current_staff_role() in %s)',
      t, lafopsys_roles, lafopsys_roles
    );
  end loop;
end $$;
