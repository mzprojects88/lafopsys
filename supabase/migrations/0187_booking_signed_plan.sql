-- 0187: the signed copy of an Activity Plan uses booking.plans.signed_file_key (0172). A first draft of this migration
-- added four more columns on dev only; they are removed again. On production this changes nothing.
alter table booking.plans
  drop column if exists signed_key,
  drop column if exists signed_name,
  drop column if exists signed_at,
  drop column if exists signed_by;
