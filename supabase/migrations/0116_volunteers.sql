-- 0116: Volunteers on real records (Sprint 10).
--
-- The Volunteers page was a prototype list with a certificate counter. From here:
--   * the people who help at the Care Cart, the LAF Center, events and on the road are kept here
--     with a phone or email, and can be set inactive;
--   * every session they serve is logged with its date, hours and activity
--     (ops.volunteer_hours); a volunteer's total hours and last session follow from that log;
--   * a service certificate (PDF) states the hours over a chosen period, signed by the
--     certificate signatory in Settings, and counts toward certificates_issued.
-- The Social Worker, House Staff and Driver (House Ops editors) add volunteers and log hours, as
-- well as Staff editors; the Super Admin and the Office Admin (Runs HR) print certificates.

-- ---- 1. volunteers ----
alter table ops.volunteers
  add column if not exists phone text check (phone is null or length(phone) <= 40),
  add column if not exists email text check (email is null or length(email) <= 120),
  add column if not exists active boolean not null default true;
alter table ops.volunteers drop constraint if exists volunteers_focus_area_check;
alter table ops.volunteers add constraint volunteers_focus_area_check
  check (focus_area in ('Care Cart', 'Activity Center', 'Transport', 'Events', 'Other'));

drop policy if exists "module insert" on ops.volunteers;
drop policy if exists "module update" on ops.volunteers;
create policy "module insert" on ops.volunteers for insert to authenticated
  with check ((select shared.module_editable('staff')) or (select shared.module_editable('house_ops')));
create policy "module update" on ops.volunteers for update to authenticated
  using ((select shared.module_editable('staff')) or (select shared.module_editable('house_ops')))
  with check ((select shared.module_editable('staff')) or (select shared.module_editable('house_ops')));

-- ---- 2. the hours ----
create table if not exists ops.volunteer_hours (
  id uuid primary key default gen_random_uuid(),
  volunteer_id uuid not null references ops.volunteers (id) on delete cascade,
  date date not null,
  hours numeric(5, 2) not null check (hours > 0 and hours <= 24),
  activity text not null check (activity in ('Care Cart', 'Activity Center', 'Transport', 'Events', 'Other')),
  note text check (note is null or length(note) <= 200),
  logged_by uuid default auth.uid() references shared.staff (id),
  created_at timestamptz not null default now()
);
create index if not exists volunteer_hours_volunteer_date on ops.volunteer_hours (volunteer_id, date);
comment on table ops.volunteer_hours is 'Each session a volunteer served: date, hours, activity (0116). Totals on ops.volunteers follow from it.';

alter table ops.volunteer_hours enable row level security;
drop policy if exists "volunteer hours read" on ops.volunteer_hours;
drop policy if exists "volunteer hours write" on ops.volunteer_hours;
create policy "volunteer hours read" on ops.volunteer_hours for select to authenticated
  using ((select shared.module_viewable('staff', 'house_ops')));
create policy "volunteer hours write" on ops.volunteer_hours for all to authenticated
  using ((select shared.module_editable('staff')) or (select shared.module_editable('house_ops')))
  with check ((select shared.module_editable('staff')) or (select shared.module_editable('house_ops')));
grant select, insert, update, delete on ops.volunteer_hours to authenticated;

-- A volunteer's total hours and last session, kept from the log.
create or replace function ops.volunteer_hours_totals()
returns trigger language plpgsql security definer
set search_path = ops, pg_temp as $$
declare
  v_id uuid := coalesce(new.volunteer_id, old.volunteer_id);
begin
  update ops.volunteers v
     set total_hours = coalesce((select sum(h.hours) from ops.volunteer_hours h where h.volunteer_id = v_id), 0),
         last_session_date = (select max(h.date) from ops.volunteer_hours h where h.volunteer_id = v_id)
   where v.id = v_id;
  if tg_op = 'UPDATE' and old.volunteer_id is distinct from new.volunteer_id then
    update ops.volunteers v
       set total_hours = coalesce((select sum(h.hours) from ops.volunteer_hours h where h.volunteer_id = old.volunteer_id), 0),
           last_session_date = (select max(h.date) from ops.volunteer_hours h where h.volunteer_id = old.volunteer_id)
     where v.id = old.volunteer_id;
  end if;
  return null;
end;
$$;
revoke all on function ops.volunteer_hours_totals() from public, anon, authenticated;
drop trigger if exists volunteer_hours_totals on ops.volunteer_hours;
create trigger volunteer_hours_totals after insert or update or delete on ops.volunteer_hours
  for each row execute function ops.volunteer_hours_totals();

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'ops' and tablename = 'volunteer_hours') then
    alter publication supabase_realtime add table ops.volunteer_hours;
  end if;
end $$;
