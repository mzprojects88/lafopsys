-- VIP Donors Portal, part 3: donor-scoped read access + closing two
-- donor-session leaks this feature would otherwise expose.
--
-- shared.staff's roster policy ("staff can read all staff", 0001) and
-- shared.app_settings's read policy ("staff can read app settings", 0020)
-- are both `to authenticated using (true)` -- deliberately blanket, because
-- until now every authenticated session WAS a staff session. A donor now
-- holds a real Supabase Auth session in the same `authenticated` Postgres
-- role, so left as-is they'd see the full staff directory (names, roles,
-- positions, hire dates) and the org's internal settings flag. Narrowed to
-- "any staff session", which preserves the intended cross-app staff-roster
-- visibility (inventory-only roles still have a shared.staff row) while
-- excluding donor accounts, which never get one.

drop policy "staff can read all staff" on shared.staff;
create policy "staff can read all staff" on shared.staff
  for select
  to authenticated
  using (shared.current_staff_role() is not null);

drop policy "staff can read app settings" on shared.app_settings;
create policy "staff can read app settings" on shared.app_settings
  for select
  to authenticated
  using (shared.current_staff_role() is not null);

-- Additive, donor-scoped SELECT policies -- ownership-shaped (0018's
-- precedent: `staff_id = auth.uid()`), not role-list-shaped (0016's), since
-- a donor must only ever see their own rows, never the roster. These layer
-- safely on top of every existing staff policy: `shared.current_donor_id()`
-- returns null for a staff session (no shared.donor_accounts row), and
-- `shared.current_staff_role()` returns null for a donor session (no
-- shared.staff row), so neither side's checks ever match the other's rows.

create policy "donor can read own donor row" on ops.donors
  for select
  to authenticated
  using (id = shared.current_donor_id());

create policy "donor can read own donations" on ops.donations
  for select
  to authenticated
  using (donor_id = shared.current_donor_id());

-- Depends on "donor can read own donations" above to scope the join --
-- created after it in this same migration so ordering is never in question.
create policy "donor can read own acknowledgment receipts" on ops.acknowledgment_receipts
  for select
  to authenticated
  using (exists (select 1 from ops.donations d where d.id = donation_id and d.donor_id = shared.current_donor_id()));

create policy "donor can read own donee certificates" on ops.donee_certificates
  for select
  to authenticated
  using (exists (select 1 from ops.donations d where d.id = donation_id and d.donor_id = shared.current_donor_id()));

-- Campaign name/target/raised isn't donor-sensitive -- any donor account may
-- browse all campaigns to decide whether to join one.
create policy "donor can read campaigns" on ops.campaigns
  for select
  to authenticated
  using (shared.current_donor_id() is not null);

-- Org-wide aggregate impact numbers, not per-donor data.
create policy "donor can read metric snapshots" on ops.metric_snapshots
  for select
  to authenticated
  using (shared.current_donor_id() is not null);

-- Donor's own pledge, read-only (view-only by explicit decision -- editing
-- frequency/amount/status stays staff-only via the 0021 blanket policy).
create policy "donor can read own pledge" on ops.donor_pledges
  for select
  to authenticated
  using (donor_id = shared.current_donor_id());
