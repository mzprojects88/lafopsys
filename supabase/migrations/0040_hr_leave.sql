-- Leave requests and the one stored piece of a balance.
--
-- Balances are DERIVED (lib/utils/leave.ts): accrual from the yearly
-- entitlement in Settings and the hire date, minus approved requests,
-- plus or minus the adjustments below. Nothing else is stored, so a
-- balance can never drift from the requests that make it up.
--
-- hr.leave_requests is the one hr table an employee writes directly: they
-- insert their own request as `pending`, and may only cancel it while it
-- is still pending. HR decides. `days` is computed at submission over the
-- person's scheduled workdays (requestDays); it is what the balance and
-- the payroll absence lines use, so it is stored with the request rather
-- than recomputed against a schedule that may change later.
--
-- hr.leave_adjustments: opening balances at go-live, year-end carry-in,
-- cash conversion (SIL is commutable, Art. 95; VL conversion is the
-- foundation's policy in Settings), forfeiture, manual corrections.

create table hr.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  leave_type_id text not null references hr.leave_types (id),
  starts_on date not null,
  ends_on date not null,
  start_half boolean not null default false,
  end_half boolean not null default false,
  days numeric(5, 2) not null check (days >= 0),
  reason text,
  document_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references shared.staff (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check ((status in ('approved', 'rejected')) = (decided_at is not null))
);

create index leave_requests_employee_idx on hr.leave_requests (employee_id, starts_on desc);
create index leave_requests_status_idx on hr.leave_requests (status) where status = 'pending';

alter table hr.leave_requests enable row level security;

create policy "hr manage leave requests" on hr.leave_requests
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create policy "own leave requests" on hr.leave_requests
  for select to authenticated
  using (employee_id = hr.current_employee_id());

-- An employee files their own request: pending, undecided.
create policy "own leave request insert" on hr.leave_requests
  for insert to authenticated
  with check (
    employee_id = hr.current_employee_id()
    and status = 'pending'
    and decided_by is null
    and decided_at is null
  );

-- ...and may withdraw it while HR has not decided. The trigger below is
-- what limits the update to that one transition; the policy only says
-- whose rows.
create policy "own leave request update" on hr.leave_requests
  for update to authenticated
  using (employee_id = hr.current_employee_id())
  with check (employee_id = hr.current_employee_id());

create or replace function hr.guard_own_leave_request_update()
returns trigger
language plpgsql
as $$
begin
  if hr.is_hr_staff() then
    return new;
  end if;
  if old.status <> 'pending' or new.status <> 'cancelled' then
    raise exception 'A request can only be withdrawn while it is pending; HR decides the rest'
      using errcode = '42501';
  end if;
  if new.employee_id is distinct from old.employee_id
     or new.leave_type_id is distinct from old.leave_type_id
     or new.starts_on is distinct from old.starts_on
     or new.ends_on is distinct from old.ends_on
     or new.days is distinct from old.days
     or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at then
    raise exception 'Only the status of a pending request can be changed by its owner'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_own_leave_request_update
  before update on hr.leave_requests
  for each row execute function hr.guard_own_leave_request_update();

create trigger set_updated_at
  before update on hr.leave_requests
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.leave_requests;

-- ---------------------------------------------------------------------------

create table hr.leave_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references hr.employees (id) on delete cascade,
  leave_type_id text not null references hr.leave_types (id),
  year integer not null check (year between 2020 and 2100),
  kind text not null check (kind in ('opening', 'carry_in', 'conversion', 'forfeit', 'manual')),
  days numeric(6, 2) not null,
  note text,
  created_by uuid references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leave_adjustments_employee_idx on hr.leave_adjustments (employee_id, year);

alter table hr.leave_adjustments enable row level security;

create policy "hr manage leave adjustments" on hr.leave_adjustments
  for all to authenticated
  using (hr.is_hr_staff())
  with check (hr.is_hr_staff());

create policy "own leave adjustments" on hr.leave_adjustments
  for select to authenticated
  using (employee_id = hr.current_employee_id());

create trigger set_updated_at
  before update on hr.leave_adjustments
  for each row execute function shared.set_updated_at();

alter publication supabase_realtime add table hr.leave_adjustments;
