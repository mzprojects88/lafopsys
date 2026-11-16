-- 0153 Signatures on generated documents (user, 16 Nov 2026: "all generated documents that have a staff name on them
-- have the option to attach the uploaded PNG signature"; the owner decides which documents).
--
-- A person's uploaded signature (0149) prints above their name on a generated document only for the kinds of
-- document they have allowed (shared.staff_signatures.allowed_docs, empty until they choose). They change the list
-- from My signature; the server writes it (no browser write on this table) and logs the change. Every time a
-- signature is put on a document, the server logs whose it was, on which document, and who generated it
-- (shared.signature_uses): the owner and the Super Admin can read their uses.

alter table shared.staff_signatures add column if not exists allowed_docs text[] not null default '{}';
alter table shared.staff_signatures drop constraint if exists staff_signatures_allowed_docs_check;
alter table shared.staff_signatures add constraint staff_signatures_allowed_docs_check
  check (allowed_docs <@ array['voucher', 'cash_receipt', 'donee_certificate', 'volunteer_certificate', 'nch_billing',
                               'case_record', 'dtr', 'manifest', 'report', 'gik_receipt', 'inventory_report']);

alter table shared.staff_signature_log add column if not exists docs text[];
alter table shared.staff_signature_log drop constraint if exists staff_signature_log_action_check;
alter table shared.staff_signature_log add constraint staff_signature_log_action_check check (action in ('uploaded', 'removed', 'allowed'));

create table if not exists shared.signature_uses (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references shared.staff(id) on delete set null deferrable initially immediate,
  doc_type text not null check (length(doc_type) between 1 and 40),
  doc_ref text not null check (length(doc_ref) between 1 and 120),
  by_staff_id uuid references shared.staff(id) on delete set null deferrable initially immediate,
  at timestamptz not null default now()
);
create index if not exists signature_uses_staff_at on shared.signature_uses (staff_id, at desc);
alter table shared.signature_uses enable row level security;
drop policy if exists "own signature uses or the super admin" on shared.signature_uses;
create policy "own signature uses or the super admin" on shared.signature_uses for select to authenticated
  using (staff_id = auth.uid() or shared.has_role('admin'));
revoke all on shared.signature_uses from anon, authenticated;
grant select on shared.signature_uses to authenticated;

notify pgrst, 'reload schema';
