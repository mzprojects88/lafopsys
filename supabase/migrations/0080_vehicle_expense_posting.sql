-- 0080: Fuel Monitoring, phase E -- Finance posts vehicle costs; driver reimbursements (2026-10-03).
--
--   * Finance Staff (Finance editors) post each fuel or expense entry to
--     Finance with one tap: ops.post_vehicle_expense writes the cash entry
--     (outflow, source vehicle_fuel, program Transportation, pending like
--     any entry typed in Finance, so Approvals still sees it) and records the
--     posting in ops.vehicle_expense_postings.
--   * Paid by LAF: the cash entry is dated the day of the expense. Paid by a
--     driver: LAF's money moves when the driver is paid back, so posting is
--     the reimbursement -- dated that day, for the amount paid back, with when,
--     how much and by whom (as arrival rides do, 0052). One cash entry per
--     expense either way: nothing counted twice.
--   * The posting is its own table that only the function writes (nobody
--     has insert, update or delete on it), so it can't be made or undone by
--     hand. A posted entry no longer changes or voids in the log; Finance
--     corrects the cash entry.
-- Rollback: supabase/rollbacks/0080_down.sql.

create table ops.vehicle_expense_postings (
  expense_id uuid primary key references ops.vehicle_expenses (id),
  cash_entry_id uuid not null unique references ops.cash_entries (id),
  posted_at timestamptz not null default now(),
  posted_by uuid references shared.staff (id),
  reimbursed_on date,
  reimbursed_amount numeric(12, 2) check (reimbursed_amount > 0),
  constraint vehicle_expense_postings_reimbursed check ((reimbursed_on is null) = (reimbursed_amount is null))
);
alter table ops.vehicle_expense_postings enable row level security;
create policy "module read" on ops.vehicle_expense_postings for select to authenticated
  using ((select shared.module_viewable('transport', 'house_ops', 'finance')));
revoke all on ops.vehicle_expense_postings from anon, authenticated;
grant select on ops.vehicle_expense_postings to authenticated;
alter publication supabase_realtime add table ops.vehicle_expense_postings;

-- The guard of 0077, plus: a posted entry stays as it is.
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
    if exists (select 1 from ops.vehicle_expense_postings p where p.expense_id = old.id) then
      raise exception 'This entry is posted to Finance; correct it on the cash entry there' using errcode = '42501';
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

create or replace function ops.post_vehicle_expense(p_expense_id uuid, p_reimbursed_on date default null, p_reimbursed_amount numeric default null)
returns uuid
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  e ops.vehicle_expenses%rowtype;
  v_vehicle text;
  v_kind text;
  v_payee text;
  v_entry uuid;
  v_date date;
  v_amount numeric;
begin
  if not shared.module_editable('finance') then
    raise exception 'Only Finance posts vehicle costs' using errcode = '42501';
  end if;
  select * into e from ops.vehicle_expenses where id = p_expense_id for update;
  if not found then
    raise exception 'No such entry' using errcode = 'P0002';
  end if;
  if e.voided_at is not null then
    raise exception 'A voided entry isn''t posted' using errcode = '22023';
  end if;
  if exists (select 1 from ops.vehicle_expense_postings p where p.expense_id = e.id) then
    raise exception 'Already posted to Finance' using errcode = '22023';
  end if;

  if e.paid_by = 'driver' then
    if p_reimbursed_on is null then
      raise exception 'A driver paid this: give the day they were paid back' using errcode = '22023';
    end if;
    if p_reimbursed_on > (now() at time zone 'Asia/Manila')::date or p_reimbursed_on < e.expense_date then
      raise exception 'The pay-back day is between the expense and today' using errcode = '22023';
    end if;
    v_amount := coalesce(p_reimbursed_amount, e.amount);
    if v_amount <= 0 then
      raise exception 'The amount paid back is more than zero' using errcode = '22023';
    end if;
    v_date := p_reimbursed_on;
    select btrim(first_name || ' ' || last_name) into v_payee from shared.staff where id = e.paid_by_staff_id;
  else
    if p_reimbursed_on is not null or p_reimbursed_amount is not null then
      raise exception 'LAF paid this; there is no one to pay back' using errcode = '22023';
    end if;
    v_amount := e.amount;
    v_date := e.expense_date;
  end if;

  select name into v_vehicle from ops.vehicles where id = e.vehicle_id;
  select name into v_kind from ops.vehicle_expense_kinds where id = e.kind;
  insert into ops.cash_entries (date, direction, source, entity, currency, amount, program_id, description, approval_status, donor_name)
    values (
      v_date, 'outflow', 'vehicle_fuel', 'PH_SEC', 'PHP', v_amount,
      (select id from ops.programs where id = 'prog-transport'),
      concat_ws(' · ', v_kind, v_vehicle, nullif(btrim(coalesce(e.vendor, '')), ''),
                case when e.litres is not null then e.litres || ' L' end,
                case when e.paid_by = 'driver' then 'reimbursed to ' || coalesce(v_payee, 'the driver') end),
      'pending',
      case when e.paid_by = 'driver' then v_payee end
    )
    returning id into v_entry;

  insert into ops.vehicle_expense_postings (expense_id, cash_entry_id, posted_by, reimbursed_on, reimbursed_amount)
    values (e.id, v_entry, auth.uid(),
            case when e.paid_by = 'driver' then v_date end,
            case when e.paid_by = 'driver' then v_amount end);
  return v_entry;
end;
$$;
revoke all on function ops.post_vehicle_expense(uuid, date, numeric) from public, anon;
grant execute on function ops.post_vehicle_expense(uuid, date, numeric) to authenticated;

notify pgrst, 'reload schema';
