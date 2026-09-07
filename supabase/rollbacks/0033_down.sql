-- Reverses 0033. DESTRUCTIVE: drops the bank record, every statement import,
-- and every monthly narrative. The January-to-July rows can be rebuilt from
-- the workbook by the backfill script; anything uploaded since, and any note
-- edited in the app, cannot. Export first:
--
--   select * from ops.bank_transactions order by account_id, posting_date, row_seq;
--   select * from ops.bank_statement_imports order by created_at;
--   select * from ops.finance_month_notes order by month;

alter publication supabase_realtime drop table ops.finance_month_notes;
alter publication supabase_realtime drop table ops.bank_transactions;
alter publication supabase_realtime drop table ops.bank_statement_imports;

drop table ops.finance_month_notes;
drop table ops.bank_transactions;
drop table ops.bank_statement_imports;

delete from ops.accounts where id = '00000000-0000-4000-8000-00000000bd01';
