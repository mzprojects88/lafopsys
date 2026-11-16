-- 0154 A copy of the signature picture beside its row (16 Nov 2026), so LAF Inventory can print it.
--
-- The signature file lives in the Operating System's private file store, which LAF Inventory's own key cannot open.
-- Both apps share this database, so the upload keeps a copy of the picture (base64, at most 1 MB of file) on the
-- owner's row. The server reads it to put the signature on a document (0153's rules: only what the owner allowed,
-- every use logged). Access is unchanged: the owner and the Super Admin read the row, nobody writes it from the
-- browser. Text, not bytea, so the hourly two-way sync copies it like any other value.

alter table shared.staff_signatures add column if not exists image_b64 text;
alter table shared.staff_signatures drop constraint if exists staff_signatures_image_b64_check;
alter table shared.staff_signatures add constraint staff_signatures_image_b64_check check (image_b64 is null or length(image_b64) <= 1400000);

notify pgrst, 'reload schema';
