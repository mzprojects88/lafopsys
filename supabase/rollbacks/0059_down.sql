-- Undo 0059. The copy then writes the app's own wording everywhere.
alter table ops.patients drop column if exists sheet_row;
notify pgrst, 'reload schema';
