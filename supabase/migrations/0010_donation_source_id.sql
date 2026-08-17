-- Fixes a real idempotency bug in migrate-donors-to-supabase.mjs: a
-- composite-content key (donor/date/item/value) can't distinguish "this is
-- the second of two legitimately identical donations" from "already
-- inserted" -- 3 real donor/date/item/value combinations occur twice in the
-- source data. source_id holds the original don-real-N/donor-real-N id from
-- lib/mock-data/real/*.json, giving a genuinely stable idempotency key, the
-- same role patient_number plays for ops.patients.

alter table ops.donations add column source_id text unique;
alter table ops.donors add column source_id text unique;
