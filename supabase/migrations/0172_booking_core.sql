-- 0172: LAF Activity Center Bookings, the database (owner, 25 Nov 2026; the plan is in
-- Builds/Activity Center Booking/PLAN.md, version 3).
--
-- Donors, people, companies and institutions ask for a slot to run activities for the children at the LAF
-- Activity Center at the National Children's Hospital (later also other places). Staff answer in ArkOS.
--
-- Rules this file holds:
--   * Its own schema, `booking`. The hourly copy between development and production carries ops, shared, hr and
--     inventory only, so a test request on development can never appear on production, and its emails are
--     queued in booking.outbox, not in the shared one.
--   * The public page never touches a table. The ArkOS server calls the booking.web_* functions with the service
--     key; nobody else may run them (no grant to anon or to signed-in staff), so the page's own limits can't be
--     walked around with the public API key.
--   * One group per slot, enforced by a unique index, not by the page.
--   * A request holds its slot while it waits ("pending approval"); declined and cancelled ones free it.
--   * An activity that is not in the month's NCH-approved Activity Plan marks the request "off plan": it cannot
--     be approved until the social worker has recorded who at NCH she coordinated with, and when.
--   * The Request ID a requestor is given has a random part (LAF-AC-7K4M-9XQ2): it is the only thing needed to
--     look a request up, so it must not be guessable. Staff also see a running number (LAF-ACB-2026-0001).
--
-- NOT in this file, on purpose: the rows that let roles open the pages (shared.module_access,
-- shared.role_page_access). Those tables ARE copied between the databases, and production would refuse the new
-- module until it has this migration, which stops the hourly copy. They come in their own migration on release
-- day. Until then only the Super Admin sees the pages; the checks seed the rows inside rolled-back runs.

create schema if not exists booking;
grant usage on schema booking to authenticated, service_role;
alter role authenticator set pgrst.db_schemas = 'public, ops, inventory, shared, hr, sync, shop, booking';
notify pgrst, 'reload config';

-- ---- 1. The new module's name is allowed (no rows yet: see the note above) ----
alter table shared.module_access drop constraint if exists module_access_module_check;
alter table shared.module_access add constraint module_access_module_check
  check (module = any (array['executive', 'dashboard', 'calendar', 'staff', 'hr', 'patients', 'house_ops', 'donors', 'inventory', 'finance', 'compliance',
    'analytics', 'reports', 'settings', 'transport', 'inventory_stock', 'inventory_given_out', 'requests', 'shop', 'bookings']));
alter table shared.staff_module_access drop constraint if exists staff_module_access_module_check;
alter table shared.staff_module_access add constraint staff_module_access_module_check
  check (module = any (array['executive', 'dashboard', 'calendar', 'staff', 'hr', 'patients', 'house_ops', 'donors', 'inventory', 'finance', 'compliance',
    'analytics', 'reports', 'transport', 'requests', 'shop', 'bookings']));
alter table shared.role_page_access drop constraint if exists role_page_access_page_check;
alter table shared.role_page_access add constraint role_page_access_page_check
  check (page ~ '^(executive|dashboard|calendar|staff|hr|patients|house_ops|donors|inventory|finance|compliance|analytics|reports|transport|requests|shop|bookings)\.[a-z_]+$');

-- ---- 2. Settings: one row of the figures and texts management sets ----
create table if not exists booking.settings (
  id boolean primary key default true check (id),
  -- The booking window: the earliest and the latest day that can be asked for, counted from today.
  min_days_ahead integer not null default 14 check (min_days_ahead between 0 and 180),
  max_days_ahead integer not null default 60 check (max_days_ahead between 1 and 365),
  max_volunteers integer not null default 10 check (max_volunteers between 1 and 100),
  -- How many requests one email address may have waiting or approved for days still to come.
  max_open_requests integer not null default 2 check (max_open_requests between 1 and 10),
  -- Volunteers' names are due this many days before the visit (the hospital's gate needs them).
  names_due_days integer not null default 3 check (names_due_days between 0 and 30),
  -- "We will email you within N working days."
  reply_days integer not null default 3 check (reply_days between 1 and 30),
  guidelines text not null default '' check (length(guidelines) <= 6000),
  prohibited text not null default '' check (length(prohibited) <= 1000),
  privacy_notice text not null default '' check (length(privacy_notice) <= 4000),
  updated_at timestamptz not null default now(),
  updated_by uuid references shared.staff (id) deferrable initially immediate,
  check (max_days_ahead > min_days_ahead)
);

-- ---- 3. Places, their weekly slots, and closed dates ----
create table if not exists booking.places (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 2 and 80),
  -- Which program site a visit here counts under (the Activity Center sessions use NCH / LAF).
  site text not null default 'NCH' check (site in ('NCH', 'LAF')),
  where_to_go text not null default '' check (length(where_to_go) <= 600),
  -- Shown to a requestor only once the booking is approved: the gate steps, what to bring, parking.
  instructions text not null default '' check (length(instructions) <= 3000),
  coordinator_name text not null default '' check (length(coordinator_name) <= 120),
  coordinator_phone text not null default '' check (length(coordinator_phone) <= 40),
  open boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists booking.slots (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references booking.places (id) on delete cascade deferrable initially immediate,
  -- 0 = Sunday ... 6 = Saturday, as extract(dow) gives it.
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  check (end_time > start_time),
  unique (place_id, weekday, start_time)
);

create table if not exists booking.closures (
  id uuid primary key default gen_random_uuid(),
  -- Empty = every place.
  place_id uuid references booking.places (id) on delete cascade deferrable initially immediate,
  date_from date not null,
  date_to date not null,
  reason text not null default '' check (length(reason) <= 200),
  created_by uuid references shared.staff (id) deferrable initially immediate,
  created_at timestamptz not null default now(),
  check (date_to >= date_from)
);
create index if not exists closures_dates on booking.closures (date_from, date_to);

-- ---- 4. The list of activities offered on the form ----
create table if not exists booking.activity_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 2 and 60),
  active boolean not null default true,
  sort integer not null default 0
);

-- ---- 5. The monthly Activity Plan the social worker sends to NCH ----
create table if not exists booking.plans (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references booking.places (id) deferrable initially immediate,
  -- The first day of the month it covers; a plan always runs from the 1st to the last day of that month.
  month date not null check (extract(day from month) = 1),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'returned')),
  submitted_on date,
  approved_on date,
  -- The person at NCH who approved it, as written on the signed copy.
  approved_by text check (approved_by is null or length(approved_by) <= 120),
  notes text not null default '' check (length(notes) <= 2000),
  -- The signed copy in the file library, when one was uploaded.
  signed_file_key text check (signed_file_key is null or length(signed_file_key) <= 300),
  created_by uuid references shared.staff (id) deferrable initially immediate,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (place_id, month),
  check (status <> 'approved' or approved_on is not null)
);

create table if not exists booking.plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references booking.plans (id) on delete cascade deferrable initially immediate,
  activity text not null check (length(btrim(activity)) between 2 and 80),
  purpose text not null default '' check (length(purpose) <= 300),
  participants text not null default '' check (length(participants) <= 200),
  materials text not null default '' check (length(materials) <= 500),
  -- Set when the plan fixes the activity to a day; empty when it may be run on any open slot of the month.
  on_date date,
  sort integer not null default 0
);
create index if not exists plan_items_plan on booking.plan_items (plan_id, sort);

-- ---- 6. Requests ----
create sequence if not exists booking.request_seq;

create table if not exists booking.requests (
  id uuid primary key default gen_random_uuid(),
  -- The Request ID given to the requestor; the only key to the public look-up.
  ref text not null unique check (ref ~ '^LAF-AC-[A-Z2-9]{4}-[A-Z2-9]{4}$'),
  -- The running number staff use.
  seq_no text not null unique,
  place_id uuid not null references booking.places (id) deferrable initially immediate,
  date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled', 'completed', 'no_show')),
  requestor_name text not null check (length(btrim(requestor_name)) between 2 and 120),
  requestor_kind text not null check (requestor_kind in ('person', 'company', 'school', 'church', 'organization', 'government')),
  contact_person text not null check (length(btrim(contact_person)) between 2 and 120),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200),
  mobile text not null check (mobile ~ '^[0-9+() -]{7,20}$'),
  volunteers_count integer not null check (volunteers_count between 1 and 100),
  has_minors boolean not null default false,
  -- An activity that is not in the month's NCH-approved plan was chosen or suggested.
  off_plan boolean not null default false,
  -- The social worker's coordination with NCH for an off-plan activity: who, when, what was agreed.
  nch_contact text check (nch_contact is null or length(nch_contact) <= 120),
  nch_coordinated_at timestamptz,
  nch_notes text check (nch_notes is null or length(nch_notes) <= 1000),
  decline_reason text check (decline_reason is null or length(decline_reason) <= 500),
  -- Seen by staff only.
  staff_note text not null default '' check (length(staff_note) <= 2000),
  -- For this booking only, shown to the requestor once approved (on top of the place's standing instructions).
  instructions text not null default '' check (length(instructions) <= 2000),
  attended_children integer check (attended_children is null or attended_children between 0 and 500),
  attended_volunteers integer check (attended_volunteers is null or attended_volunteers between 0 and 100),
  attended_hours numeric(4, 2) check (attended_hours is null or attended_hours between 0 and 12),
  consent_at timestamptz not null,
  -- A one-way mark of where the request came from, for telling abuse apart. Never an address.
  caller_hash text check (caller_hash is null or length(caller_hash) <= 64),
  decided_by uuid references shared.staff (id) deferrable initially immediate,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);
-- One group per slot. A declined or cancelled request frees it.
create unique index if not exists requests_one_per_slot on booking.requests (place_id, date, start_time)
  where status in ('pending', 'approved', 'completed', 'no_show');
create index if not exists requests_status_date on booking.requests (status, date);
create index if not exists requests_email on booking.requests (lower(email));

-- The program flow: one to three activities inside the slot.
create table if not exists booking.request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references booking.requests (id) on delete cascade deferrable initially immediate,
  position smallint not null check (position between 1 and 3),
  activity text not null check (length(btrim(activity)) between 2 and 80),
  -- plan = from the month's NCH-approved plan; list = from LAF's list; suggested = typed by the requestor.
  source text not null check (source in ('plan', 'list', 'suggested')),
  purpose text not null default '' check (length(purpose) <= 300),
  -- Who the activity is for.
  who text not null default 'patients' check (who in ('patients', 'carers', 'both')),
  ages text not null default '' check (length(ages) <= 40),
  gender text not null default 'all' check (gender in ('all', 'girls', 'boys')),
  participants_note text not null default '' check (length(participants_note) <= 200),
  start_time time not null,
  end_time time not null,
  materials text not null default '' check (length(materials) <= 500),
  check (end_time > start_time),
  unique (request_id, position)
);

-- The volunteers' names the hospital's gate needs; typed by the group after approval, or by staff.
create table if not exists booking.volunteers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references booking.requests (id) on delete cascade deferrable initially immediate,
  position integer not null check (position between 1 and 100),
  name text not null check (length(btrim(name)) between 2 and 120),
  unique (request_id, position)
);

-- What happened to a request, in order.
create table if not exists booking.events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references booking.requests (id) on delete cascade deferrable initially immediate,
  at timestamptz not null default now(),
  actor uuid references shared.staff (id) deferrable initially immediate,
  by_requestor boolean not null default false,
  action text not null check (length(action) <= 40),
  detail text not null default '' check (length(detail) <= 1000)
);
create index if not exists events_request on booking.events (request_id, at);

-- Emails to requestors wait here; the ArkOS server writes and sends them (lib/notify/email.ts).
create table if not exists booking.outbox (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references booking.requests (id) on delete set null deferrable initially immediate,
  to_address text not null check (to_address ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(to_address) <= 200),
  subject text not null check (length(subject) between 1 and 200),
  body_html text not null,
  source text,
  status text not null default 'queued' check (status in ('queued', 'held', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists outbox_status on booking.outbox (status, created_at);

-- Every use of the public doors, to keep one caller from flooding them. No address is kept, only a mark.
create table if not exists booking.web_hits (
  kind text not null,
  key_hash text not null,
  at timestamptz not null default now()
);
create index if not exists web_hits_lookup on booking.web_hits (kind, key_hash, at);

-- ---- 7. Who may read and change what ----
alter table booking.settings enable row level security;
alter table booking.places enable row level security;
alter table booking.slots enable row level security;
alter table booking.closures enable row level security;
alter table booking.activity_types enable row level security;
alter table booking.plans enable row level security;
alter table booking.plan_items enable row level security;
alter table booking.requests enable row level security;
alter table booking.request_items enable row level security;
alter table booking.volunteers enable row level security;
alter table booking.events enable row level security;
alter table booking.outbox enable row level security;
alter table booking.web_hits enable row level security;

revoke all on all tables in schema booking from public, anon, authenticated;
grant all on all tables in schema booking to service_role;
grant usage on sequence booking.request_seq to service_role;

do $$
declare
  t text;
begin
  -- Everything the Bookings pages show: viewers read.
  foreach t in array array['settings', 'places', 'slots', 'closures', 'activity_types', 'plans', 'plan_items', 'requests', 'request_items', 'volunteers', 'events', 'outbox'] loop
    execute format('drop policy if exists "bookings viewers read" on booking.%I', t);
    execute format('create policy "bookings viewers read" on booking.%I for select to authenticated using ((select shared.module_viewable(''bookings'')))', t);
    execute format('grant select on booking.%I to authenticated', t);
  end loop;
  -- What editors keep by hand: places, slots, closed dates, the activity list, the plans and the volunteers' names.
  foreach t in array array['places', 'slots', 'closures', 'activity_types', 'plans', 'plan_items', 'volunteers'] loop
    execute format('drop policy if exists "bookings editors add" on booking.%I', t);
    execute format('create policy "bookings editors add" on booking.%I for insert to authenticated with check ((select shared.module_editable(''bookings'')))', t);
    execute format('drop policy if exists "bookings editors change" on booking.%I', t);
    execute format('create policy "bookings editors change" on booking.%I for update to authenticated using ((select shared.module_editable(''bookings''))) with check ((select shared.module_editable(''bookings'')))', t);
    execute format('drop policy if exists "bookings editors remove" on booking.%I', t);
    execute format('create policy "bookings editors remove" on booking.%I for delete to authenticated using ((select shared.module_editable(''bookings'')))', t);
    execute format('grant insert, update, delete on booking.%I to authenticated', t);
  end loop;
end $$;

drop policy if exists "bookings editors change" on booking.settings;
create policy "bookings editors change" on booking.settings for update to authenticated
  using ((select shared.module_editable('bookings'))) with check ((select shared.module_editable('bookings')));
grant update on booking.settings to authenticated;

-- A request's status changes only through booking.decide(); by hand, editors keep its notes and the NCH
-- coordination only.
drop policy if exists "bookings editors change" on booking.requests;
create policy "bookings editors change" on booking.requests for update to authenticated
  using ((select shared.module_editable('bookings'))) with check ((select shared.module_editable('bookings')));
grant update (staff_note, instructions, nch_contact, nch_coordinated_at, nch_notes) on booking.requests to authenticated;

-- ---- 8. Small helpers ----
create or replace function booking.today() returns date
language sql stable set search_path to 'pg_temp' as $$ select (now() at time zone 'Asia/Manila')::date $$;

-- A new Request ID: LAF-AC-XXXX-XXXX from 31 letters and digits that are not mistaken for one another.
create or replace function booking.new_ref() returns text
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  hex text;
  v text;
  i integer;
begin
  loop
    hex := replace(gen_random_uuid()::text, '-', '');
    v := '';
    for i in 0..7 loop
      v := v || substr(alphabet, (('x' || substr(hex, i * 2 + 1, 2))::bit(8)::integer % 31) + 1, 1);
    end loop;
    v := 'LAF-AC-' || substr(v, 1, 4) || '-' || substr(v, 5, 4);
    exit when not exists (select 1 from booking.requests where ref = v);
  end loop;
  return v;
end;
$$;

-- Counts one use of a public door and says whether the caller is still within the limit.
create or replace function booking.within_limit(p_kind text, p_key text, p_max integer, p_window interval) returns boolean
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $$
declare
  v_key text := left(coalesce(p_key, ''), 64);
  v_count integer;
begin
  if v_key = '' then
    return false;
  end if;
  insert into booking.web_hits (kind, key_hash) values (p_kind, v_key);
  -- ponytail: tidied on the way; a nightly job if the table ever grows.
  delete from booking.web_hits where at < now() - interval '3 days';
  select count(*) into v_count from booking.web_hits where kind = p_kind and key_hash = v_key and at > now() - p_window;
  return v_count <= p_max;
end;
$$;

-- Every slot of a place between two days, with its state. The order of the tests is the order of the answer:
-- a taken slot says so even when the day is also too soon.
create or replace function booking.slot_states(p_place uuid, p_from date, p_to date)
returns table (day date, start_time time, end_time time, state text)
language sql stable security definer set search_path to 'booking', 'ops', 'pg_temp' as $$
  select d::date, s.start_time, s.end_time,
    case
      when d::date < booking.today() then 'past'
      when exists (select 1 from booking.requests r where r.place_id = p_place and r.date = d::date and r.start_time = s.start_time and r.status in ('approved', 'completed', 'no_show')) then 'booked'
      when exists (select 1 from booking.requests r where r.place_id = p_place and r.date = d::date and r.start_time = s.start_time and r.status = 'pending') then 'pending'
      when exists (select 1 from booking.closures c where (c.place_id is null or c.place_id = p_place) and d::date between c.date_from and c.date_to) then 'closed'
      when exists (select 1 from ops.calendar_events e where e.date = d::date and e.is_holiday and e.sheet_removed_at is null) then 'holiday'
      when d::date < booking.today() + st.min_days_ahead then 'too_soon'
      when d::date > booking.today() + st.max_days_ahead then 'too_far'
      else 'open'
    end
  from generate_series(p_from::timestamp, least(p_to, p_from + 100)::timestamp, interval '1 day') d
  join booking.slots s on s.place_id = p_place and s.active and s.weekday = extract(dow from d)::integer
  cross join (select min_days_ahead, max_days_ahead from booking.settings where id) st
  order by 1, 2;
$$;

-- ---- 9. The public doors (run by the ArkOS server only) ----

-- What the booking form needs: the open places, the limits and texts, LAF's activity list, and the activities of
-- the NCH-approved plans of the months that can be booked.
create or replace function booking.web_form() returns jsonb
language sql stable security definer set search_path to 'booking', 'pg_temp' as $$
  select jsonb_build_object(
    'today', booking.today(),
    'settings', (select jsonb_build_object('minDaysAhead', min_days_ahead, 'maxDaysAhead', max_days_ahead, 'maxVolunteers', max_volunteers,
        'namesDueDays', names_due_days, 'replyDays', reply_days, 'guidelines', guidelines, 'prohibited', prohibited, 'privacyNotice', privacy_notice)
      from booking.settings where id),
    'places', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'whereToGo', where_to_go) order by sort, name) from booking.places where open), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(name order by sort, name) from booking.activity_types where active), '[]'::jsonb),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object('placeId', p.place_id, 'month', to_char(p.month, 'YYYY-MM'), 'items', (
          select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'activity', i.activity, 'purpose', i.purpose, 'participants', i.participants, 'materials', i.materials, 'onDate', i.on_date) order by i.sort, i.activity), '[]'::jsonb)
          from booking.plan_items i where i.plan_id = p.id)) order by p.month)
      from booking.plans p
      where p.status = 'approved' and p.month >= date_trunc('month', booking.today())::date
        and p.month <= booking.today() + (select max_days_ahead from booking.settings where id)), '[]'::jsonb)
  );
$$;

-- A month of one place: each slot and whether it can be asked for. Never a name.
create or replace function booking.web_availability(p_place uuid, p_month date) returns jsonb
language sql stable security definer set search_path to 'booking', 'pg_temp' as $$
  select coalesce(jsonb_agg(jsonb_build_object('date', s.day, 'start', left(s.start_time::text, 5), 'end', left(s.end_time::text, 5), 'state', s.state) order by s.day, s.start_time), '[]'::jsonb)
  from booking.slot_states(p_place, date_trunc('month', p_month)::date, (date_trunc('month', p_month) + interval '1 month - 1 day')::date) s
  where exists (select 1 from booking.places p where p.id = p_place and p.open);
$$;

-- Files a request. Every rule is checked here, whatever the page checked. Messages are written for the requestor.
create or replace function booking.web_request(p jsonb, p_caller text) returns jsonb
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $$
declare
  st booking.settings;
  v_place booking.places;
  v_slot booking.slots;
  v_date date;
  v_start time;
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_count integer;
  v_items jsonb := coalesce(p->'items', '[]'::jsonb);
  v_item jsonb;
  v_i integer := 0;
  v_from time;
  v_to time;
  v_prev_end time;
  v_source text;
  v_activity text;
  v_off_plan boolean := false;
  v_id uuid;
  v_ref text;
  v_seq text;
  v_state text;
begin
  select * into st from booking.settings where id;
  if not booking.within_limit('request', p_caller, 6, interval '1 hour') or not booking.within_limit('request-day', p_caller, 20, interval '1 day') then
    raise exception 'Too many requests were sent from here. Please try again later.' using errcode = '53400';
  end if;
  if coalesce((p->>'agree_guidelines')::boolean, false) is not true or coalesce((p->>'agree_privacy')::boolean, false) is not true then
    raise exception 'Please tick both boxes: the visit guidelines and the privacy notice.' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then
    raise exception 'Please give an email address we can write to.' using errcode = '22023';
  end if;
  if not booking.within_limit('request-email', v_email, 4, interval '1 hour') then
    raise exception 'Too many requests were sent for this email address. Please try again later.' using errcode = '53400';
  end if;

  begin
    v_date := (p->>'date')::date;
    v_start := (p->>'start_time')::time;
  exception when others then
    raise exception 'Please choose a day and a time slot.' using errcode = '22023';
  end;
  select * into v_place from booking.places where id = nullif(p->>'place_id', '')::uuid and open;
  if not found then
    raise exception 'That place is not open for booking.' using errcode = '22023';
  end if;
  select * into v_slot from booking.slots where place_id = v_place.id and active and weekday = extract(dow from v_date)::integer and start_time = v_start;
  if not found then
    raise exception 'That time slot is not offered on that day.' using errcode = '22023';
  end if;

  v_count := coalesce(nullif(p->>'volunteers_count', '')::integer, 0);
  if v_count < 1 or v_count > st.max_volunteers then
    raise exception 'A group is 1 to % volunteers.', st.max_volunteers using errcode = '22023';
  end if;

  -- One at a time per slot: two people sending at the same moment get one yes and one "just taken".
  perform pg_advisory_xact_lock(hashtext('booking.slot:' || v_place.id::text || v_date::text || v_start::text));
  select state into v_state from booking.slot_states(v_place.id, v_date, v_date) where start_time = v_start;
  if v_state is distinct from 'open' then
    raise exception '%', case v_state
      when 'pending' then 'That slot has just been asked for by another group. Please choose another.'
      when 'booked' then 'That slot is already booked. Please choose another.'
      when 'too_soon' then format('Please book at least %s days ahead.', st.min_days_ahead)
      when 'too_far' then format('Bookings open %s days ahead. Please choose an earlier day.', st.max_days_ahead)
      else 'That day is not open for booking. Please choose another.' end
      using errcode = '22023';
  end if;

  select count(*) into v_count from booking.requests where lower(email) = v_email and status in ('pending', 'approved') and date >= booking.today();
  if v_count >= st.max_open_requests then
    raise exception 'This email address already has % requests waiting or approved. Please wait for those, or write to us.', v_count using errcode = '22023';
  end if;

  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) not between 1 and 3 then
    raise exception 'The program flow needs 1 to 3 activities.' using errcode = '22023';
  end if;

  v_ref := booking.new_ref();
  v_seq := 'LAF-ACB-' || to_char(booking.today(), 'YYYY') || '-' || lpad(nextval('booking.request_seq')::text, 4, '0');
  insert into booking.requests (ref, seq_no, place_id, date, start_time, end_time, requestor_name, requestor_kind, contact_person, email, mobile, volunteers_count, has_minors, consent_at, caller_hash)
  values (v_ref, v_seq, v_place.id, v_date, v_slot.start_time, v_slot.end_time, btrim(p->>'requestor_name'), coalesce(nullif(p->>'requestor_kind', ''), 'person'), btrim(p->>'contact_person'), v_email,
          btrim(p->>'mobile'), coalesce(nullif(p->>'volunteers_count', '')::integer, 0), coalesce((p->>'has_minors')::boolean, false), now(), left(p_caller, 64))
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(v_items) loop
    v_i := v_i + 1;
    begin
      v_from := (v_item->>'start_time')::time;
      v_to := (v_item->>'end_time')::time;
    exception when others then
      raise exception 'Activity %: please give its start and end time.', v_i using errcode = '22023';
    end;
    if v_from is null or v_to is null or v_to <= v_from then
      raise exception 'Activity %: the end time must be after the start time.', v_i using errcode = '22023';
    end if;
    if v_from < v_slot.start_time or v_to > v_slot.end_time then
      raise exception 'Activity %: it must fit inside the slot (% to %).', v_i, to_char(current_date + v_slot.start_time, 'FMHH12:MI AM'), to_char(current_date + v_slot.end_time, 'FMHH12:MI AM') using errcode = '22023';
    end if;
    if v_prev_end is not null and v_from < v_prev_end then
      raise exception 'Activity %: it starts before the one before it has ended.', v_i using errcode = '22023';
    end if;
    v_prev_end := v_to;

    v_source := coalesce(v_item->>'source', 'suggested');
    v_activity := btrim(coalesce(v_item->>'activity', ''));
    if v_source = 'plan' then
      -- Must really be in the approved plan of that place and month; its name is taken from the plan.
      select i.activity into v_activity from booking.plan_items i join booking.plans pl on pl.id = i.plan_id
       where i.id = nullif(v_item->>'plan_item_id', '')::uuid and pl.place_id = v_place.id and pl.status = 'approved' and pl.month = date_trunc('month', v_date)::date;
      if not found then
        raise exception 'Activity %: that activity is not in the approved plan of that month. Please choose again.', v_i using errcode = '22023';
      end if;
    elsif v_source = 'list' then
      if not exists (select 1 from booking.activity_types a where a.active and lower(a.name) = lower(v_activity)) then
        raise exception 'Activity %: please choose an activity from the list, or suggest one.', v_i using errcode = '22023';
      end if;
      v_off_plan := true;
    else
      v_source := 'suggested';
      v_off_plan := true;
    end if;
    if length(v_activity) not between 2 and 80 then
      raise exception 'Activity %: please name the activity.', v_i using errcode = '22023';
    end if;

    insert into booking.request_items (request_id, position, activity, source, purpose, who, ages, gender, participants_note, start_time, end_time, materials)
    values (v_id, v_i, v_activity, v_source, left(btrim(coalesce(v_item->>'purpose', '')), 300), coalesce(nullif(v_item->>'who', ''), 'patients'), left(btrim(coalesce(v_item->>'ages', '')), 40),
            coalesce(nullif(v_item->>'gender', ''), 'all'), left(btrim(coalesce(v_item->>'note', '')), 200), v_from, v_to, left(btrim(coalesce(v_item->>'materials', '')), 500));
  end loop;

  update booking.requests set off_plan = v_off_plan where id = v_id;
  insert into booking.events (request_id, by_requestor, action, detail) values (v_id, true, 'requested', case when v_off_plan then 'An activity is not in the approved plan.' else '' end);
  return jsonb_build_object('id', v_id, 'ref', v_ref, 'seqNo', v_seq, 'offPlan', v_off_plan, 'replyDays', st.reply_days);
exception
  when check_violation or not_null_violation or invalid_text_representation then
    raise exception 'Some details are missing or too long. Please check the form and send it again.' using errcode = '22023';
  when unique_violation then
    raise exception 'That slot has just been taken. Please choose another.' using errcode = '22023';
end;
$$;

-- What a requestor sees for their Request ID. The coordinator and the instructions only once it is approved;
-- the email and the mobile number come back masked.
create or replace function booking.request_view(p_id uuid) returns jsonb
language sql stable security definer set search_path to 'booking', 'pg_temp' as $$
  select jsonb_build_object(
    'ref', r.ref, 'status', r.status, 'offPlan', r.off_plan,
    'date', r.date, 'start', left(r.start_time::text, 5), 'end', left(r.end_time::text, 5),
    'place', jsonb_build_object('name', pl.name, 'whereToGo', pl.where_to_go),
    'requestorName', r.requestor_name, 'requestorKind', r.requestor_kind, 'contactPerson', r.contact_person,
    'email', regexp_replace(r.email, '^(.).*(@.*)$', '\1***\2'), 'mobile', regexp_replace(r.mobile, '.(?=.{3})', '*', 'g'),
    'volunteersCount', r.volunteers_count, 'hasMinors', r.has_minors,
    'requestedOn', (r.created_at at time zone 'Asia/Manila')::date,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('activity', i.activity, 'source', i.source, 'purpose', i.purpose, 'who', i.who, 'ages', i.ages, 'gender', i.gender,
        'note', i.participants_note, 'start', left(i.start_time::text, 5), 'end', left(i.end_time::text, 5), 'materials', i.materials) order by i.position), '[]'::jsonb)
      from booking.request_items i where i.request_id = r.id),
    'names', (select coalesce(jsonb_agg(v.name order by v.position), '[]'::jsonb) from booking.volunteers v where v.request_id = r.id),
    'namesDue', r.date - st.names_due_days,
    'canEditNames', r.status = 'approved' and booking.today() <= r.date - st.names_due_days,
    'canCancel', r.status in ('pending', 'approved') and r.date > booking.today(),
    'declineReason', case when r.status = 'declined' then r.decline_reason end,
    'approved', case when r.status in ('approved', 'completed') then jsonb_build_object(
        'instructions', pl.instructions, 'bookingInstructions', r.instructions,
        'coordinatorName', pl.coordinator_name, 'coordinatorPhone', pl.coordinator_phone) end,
    'replyDays', st.reply_days
  )
  from booking.requests r join booking.places pl on pl.id = r.place_id cross join (select * from booking.settings where id) st
  where r.id = p_id;
$$;

create or replace function booking.web_lookup(p_ref text, p_caller text) returns jsonb
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $$
declare
  v_ref text := upper(regexp_replace(coalesce(p_ref, ''), '\s+', '', 'g'));
  v_id uuid;
begin
  if not booking.within_limit('lookup', p_caller, 30, interval '1 hour') then
    raise exception 'Too many look-ups from here. Please try again later.' using errcode = '53400';
  end if;
  select id into v_id from booking.requests where ref = v_ref;
  if not found then
    return null;
  end if;
  return booking.request_view(v_id);
end;
$$;

-- The group types its volunteers' names once approved, until the names are due.
create or replace function booking.web_names(p_ref text, p_names jsonb, p_caller text) returns jsonb
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $$
declare
  r booking.requests;
  v_due integer;
  v_name text;
  v_i integer := 0;
begin
  if not booking.within_limit('names', p_caller, 20, interval '1 hour') then
    raise exception 'Too many changes from here. Please try again later.' using errcode = '53400';
  end if;
  select * into r from booking.requests where ref = upper(regexp_replace(coalesce(p_ref, ''), '\s+', '', 'g')) for update;
  if not found then
    return null;
  end if;
  select names_due_days into v_due from booking.settings where id;
  if r.status <> 'approved' then
    raise exception 'Names can be added once the booking is approved.' using errcode = '22023';
  end if;
  if booking.today() > r.date - v_due then
    raise exception 'The names were due % days before the visit. Please write to us to change them.', v_due using errcode = '22023';
  end if;
  if jsonb_typeof(p_names) is distinct from 'array' or jsonb_array_length(p_names) > r.volunteers_count then
    raise exception 'This booking is for % volunteers. Please write to us if the number changed.', r.volunteers_count using errcode = '22023';
  end if;
  delete from booking.volunteers where request_id = r.id;
  for v_name in select btrim(value) from jsonb_array_elements_text(p_names) loop
    if v_name = '' then
      continue;
    end if;
    if length(v_name) not between 2 and 120 then
      raise exception 'Please give each volunteer''s full name.' using errcode = '22023';
    end if;
    v_i := v_i + 1;
    insert into booking.volunteers (request_id, position, name) values (r.id, v_i, v_name);
  end loop;
  insert into booking.events (request_id, by_requestor, action, detail) values (r.id, true, 'names', v_i || ' name(s) given.');
  return booking.request_view(r.id);
end;
$$;

create or replace function booking.web_cancel(p_ref text, p_caller text) returns jsonb
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $$
declare
  r booking.requests;
begin
  if not booking.within_limit('cancel', p_caller, 10, interval '1 hour') then
    raise exception 'Too many changes from here. Please try again later.' using errcode = '53400';
  end if;
  select * into r from booking.requests where ref = upper(regexp_replace(coalesce(p_ref, ''), '\s+', '', 'g')) for update;
  if not found then
    return null;
  end if;
  if r.status not in ('pending', 'approved') or r.date <= booking.today() then
    raise exception 'This booking can no longer be cancelled here. Please write to us.' using errcode = '22023';
  end if;
  update booking.requests set status = 'cancelled', updated_at = now() where id = r.id;
  insert into booking.events (request_id, by_requestor, action) values (r.id, true, 'cancelled');
  return booking.request_view(r.id);
end;
$$;

-- ---- 10. Staff: every change of a request's status ----
-- approve (an off-plan request needs the NCH coordination: who and when), decline (with a reason), cancel,
-- move (to another open slot of the same length), complete (children, volunteers, hours) and no_show.
create or replace function booking.decide(p_id uuid, p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $$
declare
  r booking.requests;
  v_uid uuid := auth.uid();
  v_date date;
  v_start time;
  v_slot booking.slots;
  v_state text;
  v_shift interval;
  v_reason text := btrim(coalesce(p->>'reason', ''));
  v_contact text := btrim(coalesce(p->>'nch_contact', ''));
begin
  if not shared.module_editable('bookings') then
    raise exception 'Only the people who process bookings can do that.' using errcode = '42501';
  end if;
  select * into r from booking.requests where id = p_id for update;
  if not found then
    raise exception 'That request was not found.' using errcode = 'P0002';
  end if;

  if p_action = 'approve' then
    if r.status <> 'pending' then
      raise exception 'Only a request that is pending approval can be approved.' using errcode = '22023';
    end if;
    if r.off_plan then
      -- Her approval says it is coordinated with NCH: who she spoke with and when must be on record first.
      v_contact := coalesce(nullif(v_contact, ''), r.nch_contact, '');
      if length(v_contact) < 2 or coalesce(nullif(p->>'nch_coordinated_at', '')::timestamptz, r.nch_coordinated_at) is null then
        raise exception 'An activity here is not in the NCH-approved plan. Record who at NCH you coordinated with, and when, before approving.' using errcode = '22023';
      end if;
      update booking.requests set nch_contact = left(v_contact, 120), nch_coordinated_at = coalesce(nullif(p->>'nch_coordinated_at', '')::timestamptz, nch_coordinated_at),
             nch_notes = coalesce(nullif(left(btrim(coalesce(p->>'nch_notes', '')), 1000), ''), nch_notes) where id = r.id;
    end if;
    update booking.requests set status = 'approved', decided_by = v_uid, decided_at = now(), updated_at = now(),
           instructions = coalesce(nullif(left(btrim(coalesce(p->>'instructions', '')), 2000), ''), instructions) where id = r.id;
    insert into booking.events (request_id, actor, action, detail) values (r.id, v_uid, 'approved', case when r.off_plan then 'Coordinated with NCH: ' || left(v_contact, 120) else '' end);

  elsif p_action = 'decline' then
    if r.status <> 'pending' then
      raise exception 'Only a request that is pending approval can be declined.' using errcode = '22023';
    end if;
    if length(v_reason) not between 5 and 500 then
      raise exception 'Say why it is declined (5 to 500 characters): the requestor is told.' using errcode = '22023';
    end if;
    update booking.requests set status = 'declined', decline_reason = v_reason, decided_by = v_uid, decided_at = now(), updated_at = now() where id = r.id;
    insert into booking.events (request_id, actor, action, detail) values (r.id, v_uid, 'declined', v_reason);

  elsif p_action = 'cancel' then
    if r.status not in ('pending', 'approved') then
      raise exception 'This booking is already closed.' using errcode = '22023';
    end if;
    update booking.requests set status = 'cancelled', decided_by = v_uid, decided_at = now(), updated_at = now() where id = r.id;
    insert into booking.events (request_id, actor, action, detail) values (r.id, v_uid, 'cancelled', left(v_reason, 500));

  elsif p_action = 'move' then
    if r.status not in ('pending', 'approved') then
      raise exception 'Only a pending or an approved booking can be moved.' using errcode = '22023';
    end if;
    v_date := (p->>'date')::date;
    v_start := (p->>'start_time')::time;
    select * into v_slot from booking.slots where place_id = r.place_id and active and weekday = extract(dow from v_date)::integer and start_time = v_start;
    if not found then
      raise exception 'That time slot is not offered on that day.' using errcode = '22023';
    end if;
    if (v_slot.end_time - v_slot.start_time) <> (r.end_time - r.start_time) then
      raise exception 'That slot is a different length, so the program flow would not fit. Ask the group to book it afresh.' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtext('booking.slot:' || r.place_id::text || v_date::text || v_start::text));
    select state into v_state from booking.slot_states(r.place_id, v_date, v_date) where start_time = v_start;
    -- Staff may move into a day that is too soon or too far for the public, never into a taken or closed one.
    if v_state not in ('open', 'too_soon', 'too_far') then
      raise exception 'That slot is not free (%).', v_state using errcode = '22023';
    end if;
    v_shift := v_slot.start_time - r.start_time;
    update booking.request_items set start_time = start_time + v_shift, end_time = end_time + v_shift where request_id = r.id;
    insert into booking.events (request_id, actor, action, detail) values (r.id, v_uid, 'moved', 'From ' || to_char(r.date, 'Mon DD, YYYY') || ' ' || to_char(current_date + r.start_time, 'FMHH12:MI AM'));
    update booking.requests set date = v_date, start_time = v_slot.start_time, end_time = v_slot.end_time, updated_at = now() where id = r.id;

  elsif p_action in ('complete', 'no_show') then
    if r.status <> 'approved' then
      raise exception 'Only an approved booking can be closed after the visit.' using errcode = '22023';
    end if;
    if r.date > booking.today() then
      raise exception 'The visit has not happened yet.' using errcode = '22023';
    end if;
    if p_action = 'complete' then
      update booking.requests set status = 'completed', updated_at = now(),
             attended_children = nullif(p->>'children', '')::integer, attended_volunteers = nullif(p->>'volunteers', '')::integer, attended_hours = nullif(p->>'hours', '')::numeric
       where id = r.id;
      insert into booking.events (request_id, actor, action, detail) values (r.id, v_uid, 'completed',
        coalesce(p->>'children', '0') || ' children, ' || coalesce(p->>'volunteers', '0') || ' volunteers, ' || coalesce(p->>'hours', '0') || ' hours');
    else
      update booking.requests set status = 'no_show', updated_at = now() where id = r.id;
      insert into booking.events (request_id, actor, action) values (r.id, v_uid, 'no_show');
    end if;

  else
    raise exception 'Unknown step.' using errcode = '22023';
  end if;

  return booking.request_view(r.id) || jsonb_build_object('id', r.id);
end;
$$;

-- ---- 11. Who may run what ----
revoke all on all functions in schema booking from public, anon, authenticated;
grant execute on all functions in schema booking to service_role;
-- Staff, from the Bookings pages: the steps (decide checks the caller itself) and the Manila day.
grant execute on function booking.decide(uuid, text, jsonb) to authenticated;
grant execute on function booking.today() to authenticated;

-- slot_states runs with the owner's rights and names nobody; staff reach it through this door, which checks them.
create or replace function booking.staff_slot_states(p_place uuid, p_from date, p_to date)
returns table (day date, start_time time, end_time time, state text)
language plpgsql stable security definer set search_path to 'booking', 'pg_temp' as $$
begin
  if not shared.module_viewable('bookings') then
    raise exception 'Bookings access is needed.' using errcode = '42501';
  end if;
  return query select * from booking.slot_states(p_place, p_from, p_to);
end;
$$;
revoke all on function booking.staff_slot_states(uuid, date, date) from public, anon;
grant execute on function booking.staff_slot_states(uuid, date, date) to authenticated, service_role;

-- ---- 12. What the foundation starts with (this schema is not copied between the databases) ----
insert into booking.settings (id, guidelines, prohibited, privacy_notice) values (true,
  E'Thank you for giving your time to the children. To keep them safe, every group agrees to these:\n\n'
  '1. Book ahead: the calendar shows the earliest day that is open. Keep the group small and the activity calm and short.\n'
  '2. Nobody comes with fever, cough, colds or diarrhoea, or after recent contact with chickenpox or measles.\n'
  '3. Clean your hands on arrival and wear a mask when the hospital asks.\n'
  '4. Volunteers under 18 come with an adult.\n'
  '5. No photos or videos of the children without Little Ark Foundation''s written consent.\n'
  '6. Do not exchange personal contact details with patients or their families.\n'
  '7. Bring your own materials. Everything shown, read or played must be suitable for children.\n'
  '8. Every volunteer signs the logbook at the hospital gate. Give us their names once your booking is approved.\n'
  '9. Little Ark Foundation or the hospital may cancel a visit for hospital reasons. You will be told at once.',
  'Not allowed: running, physical games and anything tiring for the children. Food of any kind, balloons, face painting and animals need the hospital''s clearance first.',
  E'Little Ark Foundation collects the details on this form only to arrange your visit: to reply to you, to coordinate with the National Children''s Hospital, and to keep a record of the activity. '
  'They are seen by the staff who process bookings and are not shared with anyone else, except the volunteers'' names given to the hospital''s gate. '
  'You may ask us to correct or remove your details at any time: info@littlearkfoundation.org.')
on conflict (id) do nothing;

insert into booking.places (name, site, where_to_go, sort)
values ('LAF Activity Center at National Children''s Hospital', 'NCH', 'National Children''s Hospital, Quezon City', 1)
on conflict (name) do nothing;

-- Monday, Tuesday, Thursday and Friday, 10:00 AM to 12:00 NN.
insert into booking.slots (place_id, weekday, start_time, end_time)
select p.id, d, '10:00', '12:00' from booking.places p cross join unnest(array[1, 2, 4, 5]) d
where p.name = 'LAF Activity Center at National Children''s Hospital'
on conflict (place_id, weekday, start_time) do nothing;

insert into booking.activity_types (name, sort)
select name, row_number() over () from unnest(array['Book Reading', 'Storytelling', 'Drawing', 'Coloring and Painting', 'Arts and Crafts', 'Film Showing', 'Puppet Show',
  'Music and Sing-along', 'Magic Show', 'Quiet Table Games', 'Learning Session', 'Bible Study', 'Gift Giving', 'Food Distribution', 'Birthday or Holiday Celebration',
  'Mascot or Character Visit', 'Session for Parents and Carers']) name
on conflict (name) do nothing;

-- ---- 13. Live updates in ArkOS ----
do $$
declare
  t text;
begin
  foreach t in array array['settings', 'places', 'slots', 'closures', 'activity_types', 'plans', 'plan_items', 'requests', 'request_items', 'volunteers', 'events'] loop
    begin
      execute format('alter publication supabase_realtime add table booking.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
