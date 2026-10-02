-- Undo 0075: the Office Admin's grid rows.
delete from shared.module_access where role = 'office_admin';
