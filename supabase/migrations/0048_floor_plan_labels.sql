-- 0048: free-text labels an admin writes onto the floor plan ("Nurse
-- station", "Exit", a room's name) now that the app draws no room captions
-- and the plan image carries no baked-in area names. Position and size are
-- normalised against the plan image, like ops.units (0047); labels are
-- drafted and saved with the same "Save layout" as the beds.
--
-- Everyone who can see the house sees the labels; only admins add, move,
-- edit or delete them, and RLS is the gate: 0003's default privileges
-- already give authenticated S/I/U/D on any new ops.* table, so the grant
-- below documents rather than controls. No guard trigger -- unlike
-- ops.units there is no per-column split to enforce.
-- Rollback: supabase/rollbacks/0048_down.sql.

create table ops.floor_plan_labels (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(btrim(text)) between 1 and 60),
  -- centre of the text, normalised 0..1 against the plan image
  x numeric(6, 5) not null check (x >= 0 and x <= 1),
  y numeric(6, 5) not null check (y >= 0 and y <= 1),
  rotation_deg smallint not null default 0 check (rotation_deg >= 0 and rotation_deg < 360),
  font_size smallint not null default 16 check (font_size between 8 and 48),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at
  before update on ops.floor_plan_labels
  for each row execute function shared.set_updated_at();

grant select, insert, update, delete on ops.floor_plan_labels to authenticated, service_role;

alter table ops.floor_plan_labels enable row level security;

-- Same role list as 0015's "lafopsys staff full access".
create policy "lafopsys staff read floor plan labels" on ops.floor_plan_labels
  for select to authenticated
  using (shared.current_staff_role() in ('admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer'));

create policy "admin adds floor plan labels" on ops.floor_plan_labels
  for insert to authenticated
  with check (shared.current_staff_role() = 'admin');

create policy "admin edits floor plan labels" on ops.floor_plan_labels
  for update to authenticated
  using (shared.current_staff_role() = 'admin')
  with check (shared.current_staff_role() = 'admin');

create policy "admin deletes floor plan labels" on ops.floor_plan_labels
  for delete to authenticated
  using (shared.current_staff_role() = 'admin');

alter publication supabase_realtime add table ops.floor_plan_labels;

notify pgrst, 'reload schema';
