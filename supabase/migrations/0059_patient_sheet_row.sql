-- Master Plan step 3: the copy sheet repeats the original's own words
-- ("BCell ALL", "9171234567") wherever they still mean what the app holds,
-- so the copy and the original differ only where the records really do.
-- The sync keeps the row as the original last read it, cell text by header.
-- Read only by the sync and the copy's export (both service role); staff
-- see it only as the patient row they can already see.
alter table ops.patients add column sheet_row jsonb;

comment on column ops.patients.sheet_row is
  'The Patients Database row as last read, {header: cell text}; written by the master-sheet sync (0059).';

notify pgrst, 'reload schema';
