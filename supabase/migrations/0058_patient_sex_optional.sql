-- A child whose patient and carer details are complete on the Patients
-- Database sheet is brought in even before the sheet records their sex
-- (user, 2026-09-23). Sex stays M or F when known; blank until the sheet
-- fills it, and the next sync writes it. The check constraint already
-- accepts null.
alter table ops.patients alter column sex drop not null;

notify pgrst, 'reload schema';
