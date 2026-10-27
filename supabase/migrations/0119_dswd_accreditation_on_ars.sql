-- 0119: the DSWD number on every acknowledgment receipt, as its own labelled line (user, 27 Oct:
-- "add the DSWD Accreditation Number DSWD-SB-RL-2026-000131 to all generated AR files").
--
-- Until now the number rode inside the free-text registration line ("SEC ... · BIR TIN ... ·
-- DSWD Licence ..."), kept twice (here and in LAF Inventory's settings) and printed small. From
-- here it is one setting, read by both apps: Settings > Receipts & certificates > DSWD label and
-- number. Every AR prints "<label> <number>" under the foundation's name and at the foot of each
-- page; the registration lines keep SEC and BIR only, so it is never printed twice.
-- (inventory.app_settings is LAF Inventory's table in this same database; only its header text is
-- touched, the same edit an admin would make in Inventory's Settings.)

alter table shared.app_settings
  add column if not exists dswd_label text not null default 'DSWD Accreditation No.' check (length(dswd_label) between 1 and 60),
  add column if not exists dswd_number text check (dswd_number is null or length(dswd_number) between 1 and 60);
comment on column shared.app_settings.dswd_number is 'Printed on every acknowledgment receipt in both apps, after dswd_label (0119).';

update shared.app_settings set dswd_number = 'DSWD-SB-RL-2026-000131' where id and dswd_number is null;

-- The DSWD part leaves the registration lines (both apps), wherever it sits in the line.
update shared.app_settings
   set report_header = btrim(regexp_replace(report_header, '\s*·?\s*DSWD\s+(Licen[cs]e|Accreditation|Registration)?\s*(No\.?)?\s*DSWD-[A-Z0-9-]+\s*', ' ', 'i'), ' ·')
 where id and report_header ~* 'DSWD-[A-Z0-9-]+';
update inventory.app_settings
   set report_header = btrim(regexp_replace(report_header, '\s*·?\s*DSWD\s+(Licen[cs]e|Accreditation|Registration)?\s*(No\.?)?\s*DSWD-[A-Z0-9-]+\s*', ' ', 'i'), ' ·')
 where id and report_header ~* 'DSWD-[A-Z0-9-]+';
