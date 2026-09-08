-- Reverses 0045: the file rows are lost (the objects in the bucket are not
-- touched; delete them from the Backblaze console if the table goes).

drop table if exists shared.files;
drop function if exists shared.file_delete_allowed(text);
drop function if exists shared.file_write_allowed(text);
drop function if exists shared.file_read_allowed(text, text, uuid);
