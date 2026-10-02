-- Undo 0080: Finance posting. Cash entries already posted stay in ops.cash_entries; the
-- link and the reimbursement record go, and the guard returns to 0077's.
drop function if exists ops.post_vehicle_expense(uuid, date, numeric);

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

alter publication supabase_realtime drop table ops.vehicle_expense_postings;
drop table if exists ops.vehicle_expense_postings;
notify pgrst, 'reload schema';
