-- 0077: Fuel Monitoring, phase B -- the fuel and expense log (2026-10-02).
--
--   * ops.vehicle_expense_kinds: Fuel, Change oil, Tires, ... The Super Admin
--     adds more in Settings > Reference Data; Fuel is fixed (the fuel figures
--     read it).
--   * ops.vehicle_expenses: one fill-up or expense per row. Fuel carries
--     litres and "full tank"; on a tracked vehicle it carries the odometer
--     too (km per litre is measured between full tanks, phase D). Who paid:
--     LAF, or a driver who is owed it back (reimbursement, phase E).
--   * Who logged it is stamped by the database. The person who logged an
--     entry may change or void it the same day; after that only the Super
--     Admin, with a reason. Every change keeps the before and after in
--     ops.vehicle_expense_changes. Entries are voided with a reason, never
--     deleted.
--   * Receipts: the file library learns 'vehicle_expense' (module
--     transport, folder Transport/<vehicle>/<year>/<month>). Transport and
--     Finance read them, Transport editors add them, only the Super Admin
--     removes one.
-- Rollback: supabase/rollbacks/0077_down.sql.

-- ---------------------------------------------------------------------
-- 1. Kinds
-- ---------------------------------------------------------------------

create table ops.vehicle_expense_kinds (
  id text primary key,
  name text not null unique check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);
insert into ops.vehicle_expense_kinds (id, name) values
  ('fuel', 'Fuel'),
  ('change_oil', 'Change oil'),
  ('tires', 'Tires'),
  ('maintenance', 'Maintenance / service'),
  ('repair', 'Repair'),
  ('registration', 'Registration (LTO)'),
  ('insurance', 'Insurance'),
  ('parking_toll', 'Parking & toll'),
  ('car_wash', 'Car wash'),
  ('other', 'Other');

alter table ops.vehicle_expense_kinds enable row level security;
create policy "module read" on ops.vehicle_expense_kinds for select to authenticated
  using ((select shared.module_viewable('transport', 'house_ops', 'finance', 'settings')));
create policy "super admin adds" on ops.vehicle_expense_kinds for insert to authenticated
  with check ((select shared.has_role('admin')));
-- An entry that uses a kind keeps it (the foreign key); Fuel is never removed.
create policy "super admin removes" on ops.vehicle_expense_kinds for delete to authenticated
  using ((select shared.has_role('admin')) and id <> 'fuel');
revoke all on ops.vehicle_expense_kinds from anon, authenticated;
grant select, insert, delete on ops.vehicle_expense_kinds to authenticated;
alter publication supabase_realtime add table ops.vehicle_expense_kinds;

-- ---------------------------------------------------------------------
-- 2. The log
-- ---------------------------------------------------------------------

create table ops.vehicle_expenses (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references ops.vehicles (id),
  expense_date date not null default ((now() at time zone 'Asia/Manila')::date),
  kind text not null references ops.vehicle_expense_kinds (id),
  amount numeric(12, 2) not null check (amount > 0),
  litres numeric(7, 2) check (litres > 0),
  full_tank boolean,
  odometer integer check (odometer >= 0),
  vendor text,
  notes text,
  paid_by text not null default 'laf' check (paid_by in ('laf', 'driver')),
  paid_by_staff_id uuid references shared.staff (id),
  logged_by uuid references shared.staff (id),
  logged_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references shared.staff (id),
  void_reason text,
  -- why a later change was made; moved into ops.vehicle_expense_changes and cleared
  change_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_expenses_fuel check ((kind = 'fuel') = (litres is not null and full_tank is not null)),
  constraint vehicle_expenses_payer check ((paid_by = 'driver') = (paid_by_staff_id is not null)),
  constraint vehicle_expenses_void check ((voided_at is null) = (void_reason is null))
);
create index vehicle_expenses_vehicle_date_idx on ops.vehicle_expenses (vehicle_id, expense_date desc);
create trigger set_updated_at before update on ops.vehicle_expenses
  for each row execute function shared.set_updated_at();

create table ops.vehicle_expense_changes (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references ops.vehicle_expenses (id),
  old_row jsonb not null,
  new_row jsonb not null,
  reason text,
  changed_by uuid references shared.staff (id),
  changed_at timestamptz not null default now()
);
create index vehicle_expense_changes_expense_idx on ops.vehicle_expense_changes (expense_id);

-- Security definer only to write the change history, which nobody may write by hand.
create or replace function ops.guard_vehicle_expense()
returns trigger
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v ops.vehicles%rowtype;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_mine_today boolean;
  v_reason text;
begin
  if tg_op = 'INSERT' then
    new.logged_by := coalesce(auth.uid(), new.logged_by);
    new.logged_at := now();
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;
    new.change_reason := null;
  else
    if old.voided_at is not null then
      raise exception 'A voided entry stays as it is' using errcode = '42501';
    end if;
    new.logged_by := old.logged_by;
    new.logged_at := old.logged_at;
    v_mine_today := auth.uid() = old.logged_by and (old.logged_at at time zone 'Asia/Manila')::date = v_today;

    if new.voided_at is not null then
      -- Voiding: nothing else changes with it.
      if not (v_mine_today or shared.has_role('admin')) then
        raise exception 'Only the person who logged it can void it, the same day; after that, the Super Admin' using errcode = '42501';
      end if;
      if length(btrim(coalesce(new.void_reason, ''))) < 5 then
        raise exception 'Say why it is being voided' using errcode = '22023';
      end if;
      v_reason := btrim(new.void_reason);
      new := old;
      new.voided_at := now();
      new.voided_by := auth.uid();
      new.void_reason := v_reason;
      insert into ops.vehicle_expense_changes (expense_id, old_row, new_row, reason, changed_by)
        values (old.id, to_jsonb(old) - 'change_reason', to_jsonb(new) - 'change_reason', 'Voided: ' || v_reason, auth.uid());
      return new;
    end if;

    if not v_mine_today then
      if not shared.has_role('admin') then
        raise exception 'Only the person who logged it can change it, the same day; after that, the Super Admin' using errcode = '42501';
      end if;
      if length(btrim(coalesce(new.change_reason, ''))) < 5 then
        raise exception 'Say why the entry is being changed' using errcode = '22023';
      end if;
    end if;
    v_reason := nullif(btrim(coalesce(new.change_reason, '')), '');
    new.change_reason := null;
  end if;

  if new.expense_date > v_today then
    raise exception 'The date can''t be in the future' using errcode = '22023';
  end if;
  select * into v from ops.vehicles where id = new.vehicle_id;
  if new.kind = 'fuel' and v.start_odometer is not null then
    if new.odometer is null then
      raise exception 'Enter the odometer reading at the pump' using errcode = '22023';
    end if;
    if new.odometer < v.start_odometer then
      raise exception 'The odometer can''t be below % (where % started)', v.start_odometer, v.name using errcode = '22023';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    insert into ops.vehicle_expense_changes (expense_id, old_row, new_row, reason, changed_by)
      values (old.id, to_jsonb(old) - 'change_reason', to_jsonb(new) - 'change_reason', v_reason, auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function ops.guard_vehicle_expense() from public, anon;
grant execute on function ops.guard_vehicle_expense() to authenticated, service_role;
create trigger guard_vehicle_expense before insert or update on ops.vehicle_expenses
  for each row execute function ops.guard_vehicle_expense();

alter table ops.vehicle_expenses enable row level security;
create policy "module read" on ops.vehicle_expenses for select to authenticated
  using ((select shared.module_viewable('transport', 'house_ops', 'finance')));
create policy "transport editors log" on ops.vehicle_expenses for insert to authenticated
  with check ((select shared.module_editable('transport')));
-- The guard decides who may change what; this only opens the door.
create policy "transport editors or the super admin change" on ops.vehicle_expenses for update to authenticated
  using ((select shared.module_editable('transport')) or (select shared.has_role('admin')))
  with check ((select shared.module_editable('transport')) or (select shared.has_role('admin')));
revoke all on ops.vehicle_expenses from anon, authenticated;
grant select, insert, update on ops.vehicle_expenses to authenticated;
alter publication supabase_realtime add table ops.vehicle_expenses;

alter table ops.vehicle_expense_changes enable row level security;
create policy "module read" on ops.vehicle_expense_changes for select to authenticated
  using ((select shared.module_viewable('transport', 'house_ops', 'finance')));
revoke all on ops.vehicle_expense_changes from anon, authenticated;
grant select on ops.vehicle_expense_changes to authenticated;

-- ---------------------------------------------------------------------
-- 3. Receipts: the file library learns 'vehicle_expense' (Transport)
-- ---------------------------------------------------------------------

alter table shared.files drop constraint files_module_check;
alter table shared.files add constraint files_module_check
  check (module in ('hr', 'compliance', 'patients', 'donors', 'finance', 'reports', 'transport'));
alter table shared.files drop constraint files_record_type_check;
alter table shared.files add constraint files_record_type_check
  check (record_type in ('employee', 'compliance_item', 'patient', 'donor', 'bank_statement_import', 'general', 'ride', 'vehicle_expense'));
alter table shared.files drop constraint files_check;
alter table shared.files add constraint files_check
  check (
    (record_type, module) in (
      ('employee', 'hr'), ('compliance_item', 'compliance'), ('patient', 'patients'),
      ('donor', 'donors'), ('bank_statement_import', 'finance'), ('general', 'reports'), ('ride', 'patients'),
      ('vehicle_expense', 'transport')
    )
  );

create or replace function shared.file_read_allowed(m text, rt text, rid uuid)
returns boolean
language sql
stable
security invoker
set search_path = shared, hr, pg_temp
as $$
  select case m
    when 'hr' then hr.is_hr_staff() or (rt = 'employee' and rid is not null and rid = hr.current_employee_id())
    when 'compliance' then hr.is_hr_staff() or shared.module_viewable('compliance')
    when 'patients' then shared.module_viewable('patients')
    when 'donors' then shared.module_viewable('donors')
    when 'transport' then shared.module_viewable('transport', 'finance')
    else shared.module_viewable('finance')
  end;
$$;

create or replace function shared.file_write_allowed(m text)
returns boolean
language sql
stable
security invoker
set search_path = shared, hr, pg_temp
as $$
  select case m
    when 'hr' then hr.is_hr_staff()
    when 'compliance' then hr.is_hr_staff() or shared.module_editable('compliance')
    when 'patients' then shared.module_editable('patients')
    when 'donors' then shared.module_editable('donors')
    when 'transport' then shared.module_editable('transport')
    else shared.module_editable('finance')
  end;
$$;

-- A receipt is the proof of an expense: only the Super Admin removes one.
create or replace function shared.file_delete_allowed(m text)
returns boolean
language sql
stable
security invoker
set search_path = shared, hr, pg_temp
as $$
  select case m
    when 'compliance' then hr.is_hr_staff()
    when 'transport' then shared.has_role('admin')
    else shared.file_write_allowed(m)
  end;
$$;

notify pgrst, 'reload schema';
