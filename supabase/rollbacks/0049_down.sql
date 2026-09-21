-- Undo 0049: drops the check-in function. Stays, patients and carers it
-- created are ordinary rows and stay where they are.
drop function if exists ops.check_in(text, date, uuid, uuid, uuid, text, text, text, date, date, text, text, text, boolean);
notify pgrst, 'reload schema';
