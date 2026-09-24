-- Undo 0064. The sync code must go back to the 0057 behaviour (sheet wins) first.
alter table ops.master_sheet_sync_runs drop column if exists new_children_found, drop column if exists changes_found;
alter publication supabase_realtime drop table ops.sheet_changes;
drop table if exists ops.sheet_changes;
notify pgrst, 'reload schema';
