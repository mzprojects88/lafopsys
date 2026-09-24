-- Undo 0062. Approved requests keep their adjustment punches (append-only).
drop function if exists ops.approve_correction_request(uuid, text);
drop function if exists ops.reject_correction_request(uuid, text);
notify pgrst, 'reload schema';
