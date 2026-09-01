-- VIP Donors Portal, part 4: a donor "joining" a campaign creates a
-- pledge/lead record here, NOT a real ops.donations row -- no payment
-- processing exists in this app, so nothing has actually been received yet.
-- Staff record the real gift through the existing intake flow when it
-- arrives and mark this fulfilled, optionally linking back via
-- fulfilled_donation_id.

create table ops.campaign_commitments (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references ops.donors (id) on delete cascade,
  campaign_id uuid not null references ops.campaigns (id) on delete cascade,
  kind text not null check (kind in ('cash', 'in_kind')),
  pledged_amount numeric(12, 2),
  currency text check (currency in ('USD', 'PHP')),
  item_description text,
  status text not null check (status in ('pledged', 'fulfilled', 'cancelled')) default 'pledged',
  fulfilled_donation_id uuid references ops.donations (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_commitments_amount_or_item check (
    (kind = 'cash' and pledged_amount is not null) or (kind = 'in_kind' and item_description is not null)
  )
);

alter table ops.campaign_commitments enable row level security;

create policy "lafopsys staff full access" on ops.campaign_commitments
  for all
  to authenticated
  using (shared.current_staff_role() in ('admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer'))
  with check (shared.current_staff_role() in ('admin', 'social_worker', 'house_staff', 'driver', 'finance', 'board', 'volunteer'));

create policy "donor can read own commitments" on ops.campaign_commitments
  for select
  to authenticated
  using (donor_id = shared.current_donor_id());

-- WITH CHECK pins the columns a donor-authored insert may set even though
-- grants alone can't -- closes both the self-fulfilling-commitment hole and
-- a forged fulfilled_donation_id link.
create policy "donor can create own pledged commitment" on ops.campaign_commitments
  for insert
  to authenticated
  with check (
    donor_id = shared.current_donor_id()
    and status = 'pledged'
    and fulfilled_donation_id is null
  );

-- Donor may withdraw their own still-open pledge -- exactly one transition
-- (pledged -> cancelled), never touching kind/amount/item or reaching
-- "fulfilled" (that means a real donation was received and matched, which
-- only staff can attest to via the full-access policy above).
create policy "donor can cancel own pledged commitment" on ops.campaign_commitments
  for update
  to authenticated
  using (donor_id = shared.current_donor_id() and status = 'pledged')
  with check (donor_id = shared.current_donor_id() and status = 'cancelled');

create trigger set_updated_at before update on ops.campaign_commitments for each row execute function shared.set_updated_at();

create index on ops.campaign_commitments (donor_id);
create index on ops.campaign_commitments (campaign_id);
