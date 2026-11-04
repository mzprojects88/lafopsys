-- 0126 Case files, phase 3 (decided 4 Nov 2026): the rest of LAF's paper case folder as case records
-- -- the social case study report, the intervention plan and contract, the discharge and aftercare
-- papers (LAF-CM-DS-01 to TP-05) and the referral letters (age 19+, DSWD social case summary).
-- Same table, same rules (0124): only the form list grows. No new links between tables.

alter table ops.case_records drop constraint if exists case_records_form_check;
alter table ops.case_records add constraint case_records_form_check check (form in (
  'intake', 'progress_note', 'casework', 'counseling', 'home_visit', 'monitoring',
  'case_study', 'intervention_plan',
  'discharge_slip', 'closing_summary', 'transfer_summary', 'aftercare_plan', 'pre_discharge_plan',
  'referral_letter', 'dswd_case_summary'));

notify pgrst, 'reload schema';
