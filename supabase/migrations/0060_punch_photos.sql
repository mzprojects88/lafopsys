-- DTR punch photos (user, 2026-09-24): every clock-in and clock-out takes a
-- live photo from the front camera alongside the location. Staff see their
-- own entries with the location; the photo is for admins and HR only.
--
-- time_punches.photo_status says what happened to the photo, and staff may
-- see it on their own punches ("photo taken" is not the photo). The photo
-- itself sits in the private B2 bucket; its key is in a table of its own
-- that only admins and HR (hr.is_hr_staff(), 0035) can read, so a staff
-- member cannot even learn where their picture is kept. A picture is
-- shown only through app/api/dtr/photo/route.ts, which signs a five-minute
-- link after RLS has let the viewer read the row.
--
-- Append-only like the punches (0017): no update or delete policy.

alter table ops.time_punches
  add column photo_status text not null default 'none'
    check (photo_status in ('captured', 'denied', 'unavailable', 'upload_failed', 'none'));

comment on column ops.time_punches.photo_status is
  'captured = a photo is in ops.time_punch_photos; denied/unavailable = the camera was refused or absent; upload_failed = taken but not stored; none = punches from before 0060 and admin adjustments.';

create table ops.time_punch_photos (
  punch_id uuid primary key references ops.time_punches (id),
  staff_id uuid not null references shared.staff (id),
  object_key text not null unique,
  bytes integer not null check (bytes > 0),
  created_at timestamptz not null default now()
);

alter table ops.time_punch_photos enable row level security;

-- Written by the punch route as the person punching, for their own punch only.
create policy "insert own punch photo" on ops.time_punch_photos
  for insert to authenticated
  with check (
    staff_id = auth.uid()
    and exists (select 1 from ops.time_punches p where p.id = punch_id and p.staff_id = auth.uid() and p.source = 'device')
  );

-- Seen by admins and HR only; not by the person in it, not by finance.
create policy "admin and hr read punch photos" on ops.time_punch_photos
  for select to authenticated
  using (hr.is_hr_staff());

-- The schema's default privileges hand out update and delete too; with no
-- policy RLS would already change nothing, but refuse outright instead.
revoke all on ops.time_punch_photos from anon, authenticated;
grant select, insert on ops.time_punch_photos to authenticated;

notify pgrst, 'reload schema';
