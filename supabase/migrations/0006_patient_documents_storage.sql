-- Phase 1.3: Storage bucket for the admission document checklist
-- (ops.patient_documents.storage_path points into this bucket). Private
-- bucket -- documents (IDs, medical certs, consent forms, photos) are never
-- publicly readable; access goes through RLS-checked signed URLs only.

insert into storage.buckets (id, name, public)
values ('patient-documents', 'patient-documents', false)
on conflict (id) do nothing;

-- Any authenticated staff member can read/write/delete patient documents, matching
-- the blanket "authenticated staff full access" policy already used across ops.*
-- in migration 0002 -- fine-grained per-action RBAC is a later hardening pass,
-- not in scope here.
create policy "authenticated staff full access to patient documents"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'patient-documents')
  with check (bucket_id = 'patient-documents');
