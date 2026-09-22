-- 0052: how each family reached LAF House (Phase B). Every new stay records
-- its arrival: LAF HOPE Transport (LAF's own vehicle; the trip itself is
-- Phase C), a ride app, own or public transport, or a hospital ambulance /
-- NCH vehicle.
--
-- A ride-app arrival hangs on a RIDE: one booking that may carry several
-- families. LAF reimburses the fare only when two or more NCH-referred
-- patients rode together, and never an Angkas (a motorbike cannot carry two).
-- Rides that do not qualify are still recorded, marked not reimbursable.
-- Each ride keeps its fare, its receipt photo (the file library, record type
-- 'ride') and who was paid back, how much, when and by whom.
--
--   * ops.arrival_rides + ops.v_arrival_rides (riders, reimbursable)
--   * ops.stays.arrival_mode / arrival_ride_id / arrival_trip_id
--   * ops.record_arrival: set a stay's arrival, joining a ride of the day or
--     starting one; a ride left with no riders and no pay-out is removed
--   * the guard refuses paying back a ride that does not qualify, and signs
--     every pay-out with the person who recorded it
-- Who: Patients editors record arrivals and rides; Financial editors may
-- also record a pay-out. Both read.
-- Rollback: supabase/rollbacks/0052_down.sql.

-- ---------------------------------------------------------------------
-- 1. Rides
-- ---------------------------------------------------------------------

create table ops.arrival_rides (
  id uuid primary key default gen_random_uuid(),
  ride_date date not null,
  app text not null check (app in ('grab', 'joyride', 'indrive', 'moveit', 'angkas')),
  fare numeric(10, 2) check (fare >= 0),
  notes text,
  reimbursed_at date,
  reimbursed_amount numeric(10, 2) check (reimbursed_amount >= 0),
  reimbursed_to text,
  reimbursed_by uuid references shared.staff (id),
  created_by uuid references shared.staff (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arrival_rides_paid_together check ((reimbursed_at is null) = (reimbursed_amount is null)),
  constraint arrival_rides_paid_to check (reimbursed_at is null or nullif(btrim(reimbursed_to), '') is not null)
);
create index arrival_rides_date_idx on ops.arrival_rides (ride_date desc);
create trigger set_updated_at before update on ops.arrival_rides
  for each row execute function shared.set_updated_at();

alter table ops.stays
  add column arrival_mode text check (arrival_mode in ('laf_hope', 'ride_app', 'own_transport', 'hospital_vehicle')),
  add column arrival_ride_id uuid references ops.arrival_rides (id) on delete set null,
  add column arrival_trip_id uuid references ops.trips (id) on delete set null,
  add constraint stays_ride_is_ride_app check (arrival_ride_id is null or arrival_mode = 'ride_app'),
  add constraint stays_trip_is_laf_hope check (arrival_trip_id is null or arrival_mode = 'laf_hope');
create index stays_arrival_ride_idx on ops.stays (arrival_ride_id) where arrival_ride_id is not null;

-- The rule, in one place: 2+ riders, and not a motorbike. Runs with the
-- owner's rights so the rider count is the same for Financial viewers (who
-- cannot read stays); the WHERE clause is the read policy's own test.
create or replace view ops.v_arrival_rides
as
select r.*,
       coalesce(s.riders, 0) as riders,
       (r.app <> 'angkas' and coalesce(s.riders, 0) >= 2) as reimbursable
from ops.arrival_rides r
left join (select arrival_ride_id, count(*)::int as riders from ops.stays
           where arrival_ride_id is not null group by arrival_ride_id) s on s.arrival_ride_id = r.id
where (select shared.module_viewable('patients', 'house_ops', 'finance'));

-- A pay-out needs a qualifying ride and is signed by whoever records it.
-- Definer: Financial editors record pay-outs but cannot read stays, and the
-- rider count must not depend on who is asking.
create or replace function ops.guard_arrival_ride()
returns trigger
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_riders int;
begin
  if new.reimbursed_at is not null
     and (old.reimbursed_at is null or new.reimbursed_at is distinct from old.reimbursed_at
          or new.reimbursed_amount is distinct from old.reimbursed_amount or new.reimbursed_to is distinct from old.reimbursed_to) then
    select count(*) into v_riders from ops.stays where arrival_ride_id = new.id;
    if new.app = 'angkas' or v_riders < 2 then
      raise exception 'This ride is not reimbursable: it needs two or more NCH patients riding together, and not by Angkas'
        using errcode = '23514';
    end if;
    new.reimbursed_by := auth.uid();
  end if;
  if new.reimbursed_at is null then
    new.reimbursed_by := null;
  end if;
  return new;
end;
$$;
create trigger guard_arrival_ride
  before update on ops.arrival_rides
  for each row execute function ops.guard_arrival_ride();

alter table ops.arrival_rides enable row level security;
create policy "module read" on ops.arrival_rides for select to authenticated
  using ((select shared.module_viewable('patients', 'house_ops', 'finance')));
create policy "patients editors add rides" on ops.arrival_rides for insert to authenticated
  with check ((select shared.module_editable('patients')));
create policy "patients or finance editors change rides" on ops.arrival_rides for update to authenticated
  using ((select shared.module_editable('patients')) or (select shared.module_editable('finance')))
  with check ((select shared.module_editable('patients')) or (select shared.module_editable('finance')));
create policy "patients editors remove rides" on ops.arrival_rides for delete to authenticated
  using ((select shared.module_editable('patients')));
revoke all on ops.arrival_rides from authenticated;
grant select, insert, update, delete on ops.arrival_rides to authenticated;
grant select on ops.v_arrival_rides to authenticated;
alter publication supabase_realtime add table ops.arrival_rides;

-- ---------------------------------------------------------------------
-- 2. Recording an arrival
-- ---------------------------------------------------------------------

-- p_mode: laf_hope | ride_app | own_transport | hospital_vehicle.
-- ride_app: p_ride_id joins a ride already recorded (its app wins), or
-- p_app (+ p_fare) starts one on the stay's check-in day.
create or replace function ops.record_arrival(
  p_stay_id uuid,
  p_mode text,
  p_app text default null,
  p_ride_id uuid default null,
  p_fare numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ops, shared, pg_temp
as $$
declare
  v_stay ops.stays%rowtype;
  v_ride ops.arrival_rides%rowtype;
  v_ride_id uuid;
  v_old_ride uuid;
begin
  if not shared.module_editable('patients') then
    raise exception 'Your access to Patients is view only' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('laf_hope', 'ride_app', 'own_transport', 'hospital_vehicle') then
    raise exception 'Say how they arrived' using errcode = '22023';
  end if;
  select * into v_stay from ops.stays where id = p_stay_id for update;
  if not found then
    raise exception 'No such stay' using errcode = 'P0002';
  end if;
  v_old_ride := v_stay.arrival_ride_id;

  if p_mode = 'ride_app' then
    if p_ride_id is not null then
      select * into v_ride from ops.arrival_rides where id = p_ride_id for update;
      if not found then
        raise exception 'No such ride' using errcode = 'P0002';
      end if;
      if v_ride.reimbursed_at is not null and v_ride.id is distinct from v_old_ride then
        raise exception 'That ride has already been paid back; start a new one' using errcode = '23514';
      end if;
      v_ride_id := v_ride.id;
    else
      if p_app is null or p_app not in ('grab', 'joyride', 'indrive', 'moveit', 'angkas') then
        raise exception 'Say which app' using errcode = '22023';
      end if;
      insert into ops.arrival_rides (ride_date, app, fare)
        values (v_stay.check_in_at, p_app, p_fare)
        returning id into v_ride_id;
    end if;
  end if;

  update ops.stays
    set arrival_mode = p_mode,
        arrival_ride_id = v_ride_id,
        arrival_trip_id = case when p_mode = 'laf_hope' then arrival_trip_id end
    where id = v_stay.id;

  -- A ride nobody is on any more, never paid out, was a mistake: remove it.
  if v_old_ride is not null and v_old_ride is distinct from v_ride_id then
    delete from ops.arrival_rides r
      where r.id = v_old_ride and r.reimbursed_at is null
        and not exists (select 1 from ops.stays s where s.arrival_ride_id = r.id);
  end if;

  return jsonb_build_object('stay_id', v_stay.id, 'arrival_mode', p_mode, 'ride_id', v_ride_id);
end;
$$;

revoke execute on function ops.record_arrival(uuid, text, text, uuid, numeric) from public;
grant execute on function ops.record_arrival(uuid, text, text, uuid, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Receipts: the file library learns 'ride' (Patients)
-- ---------------------------------------------------------------------

alter table shared.files drop constraint files_record_type_check;
alter table shared.files add constraint files_record_type_check
  check (record_type in ('employee', 'compliance_item', 'patient', 'donor', 'bank_statement_import', 'general', 'ride'));
alter table shared.files drop constraint files_check;
alter table shared.files add constraint files_check
  check (
    (record_type, module) in (
      ('employee', 'hr'), ('compliance_item', 'compliance'), ('patient', 'patients'),
      ('donor', 'donors'), ('bank_statement_import', 'finance'), ('general', 'reports'), ('ride', 'patients')
    )
  );

notify pgrst, 'reload schema';
