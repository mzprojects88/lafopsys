-- 0149 Branded voucher and digital signatures (user, 12 Nov 2026).
--
-- The printed voucher follows the foundation's paper format with the LAF branding: a certification sentence the
-- Super Admin may change in Settings › Documents, and each signer's own signature image above their name on the
-- steps they did in ArkOS. A signature is uploaded by its owner only (the server writes the row, never the
-- browser); it is read by its owner and the Super Admin, and by the print page (the server) for the people who
-- signed a voucher the viewer may see. Each upload and removal is logged.

alter table shared.app_settings add column if not exists voucher_certification text not null
  default 'I certify that this disbursement is for official Foundation purposes, is properly supported by documents, and is charged to the appropriate account.';
alter table shared.app_settings drop constraint if exists app_settings_voucher_certification_check;
alter table shared.app_settings add constraint app_settings_voucher_certification_check check (length(btrim(voucher_certification)) between 1 and 600);

create table if not exists shared.staff_signatures (
  staff_id uuid primary key references shared.staff(id) on delete cascade deferrable initially immediate,
  object_key text not null,
  content_type text not null check (content_type in ('image/png', 'image/jpeg')),
  bytes integer not null check (bytes between 1 and 1048576),
  uploaded_at timestamptz not null default now()
);
alter table shared.staff_signatures enable row level security;
drop policy if exists "own signature or the super admin" on shared.staff_signatures;
create policy "own signature or the super admin" on shared.staff_signatures for select to authenticated
  using (staff_id = auth.uid() or shared.has_role('admin'));
revoke all on shared.staff_signatures from anon, authenticated;
grant select on shared.staff_signatures to authenticated;

create table if not exists shared.staff_signature_log (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references shared.staff(id) on delete set null deferrable initially immediate,
  action text not null check (action in ('uploaded', 'removed')),
  by_staff_id uuid references shared.staff(id) on delete set null deferrable initially immediate,
  at timestamptz not null default now()
);
alter table shared.staff_signature_log enable row level security;
drop policy if exists "own signature log or the super admin" on shared.staff_signature_log;
create policy "own signature log or the super admin" on shared.staff_signature_log for select to authenticated
  using (staff_id = auth.uid() or shared.has_role('admin'));
revoke all on shared.staff_signature_log from anon, authenticated;
grant select on shared.staff_signature_log to authenticated;

notify pgrst, 'reload schema';
