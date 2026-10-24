-- 0107: Activity Center sessions from the LAF Programs sheet (release 2 of 0103; user, 2026-10-22).
--
-- The sheet's Activity Center tab (one row per session day: NCH and/or LAF, with the number of
-- participants, volunteers and hours) is read every half hour by /api/programs/sheet-sync, like the
-- meals and the Care Cart. A sheet session is known by its sheet_key (date|site) so a re-read updates
-- it and a row removed from the sheet removes it; sessions added in the app (source 'app') are
-- never touched by the sync.
alter table ops.activity_sessions
  add column source text not null default 'app' check (source in ('app', 'sheet')),
  add column sheet_key text unique;
comment on column ops.activity_sessions.source is '''sheet'' = read from the LAF Programs sheet (0107); ''app'' = entered here.';
comment on column ops.activity_sessions.sheet_key is 'date|site of the sheet row this session came from (0107).';

notify pgrst, 'reload schema';
