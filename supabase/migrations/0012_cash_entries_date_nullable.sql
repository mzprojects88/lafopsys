-- Real data-quality finding while migrating cash_entries: 24 of 816 real rows
-- have no usable date (23 "Missing date" from the reimbursements sheet, 1
-- unparseable raw value "210/2026" from the CASH sheet) -- all already
-- flagged needs_review=true with an explicit review_reason by the cleaning
-- pipeline. `date not null` (0011) doesn't match that reality. Loosening to
-- nullable rather than fabricating a date or dropping real financial
-- records, same discipline as Carer.relationship in migration 0005.

alter table ops.cash_entries alter column date drop not null;
