-- 0126 Case files, phase 3 (decided 4 Nov 2026): the rest of LAF's paper case folder as case records
-- -- the social case study report, the intervention plan and contract, the discharge and aftercare
-- papers (LAF-CM-DS-01 to TP-05) and the referral letters (age 19+, DSWD social case summary).
-- Same table, same rules (0124): only the form list grows. No new links between tables.
-- Phase 4 adds one read-only report function (below).

alter table ops.case_records drop constraint if exists case_records_form_check;
alter table ops.case_records add constraint case_records_form_check check (form in (
  'intake', 'progress_note', 'casework', 'counseling', 'home_visit', 'monitoring',
  'case_study', 'intervention_plan',
  'discharge_slip', 'closing_summary', 'transfer_summary', 'aftercare_plan', 'pre_discharge_plan',
  'referral_letter', 'dswd_case_summary'));


-- Phase 4: the social worker's period report (a month, or a year for the DSWD annual report).
-- Counts only, never names. Runs as the caller, so each part shows only what their role may read:
-- case records for the social worker, Super Admin and CEO; nights and referrals for Patients viewers.
-- Children housed come from ops.nightly_record (the House Sheet before the switch, the app after),
-- the same nights the Programs report counts.
create or replace function ops.case_period_report(p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'records', coalesce((select jsonb_object_agg(form, n) from (
        select form, count(*) as n from ops.case_records
         where status = 'approved' and held_on between p_from and p_to group by form) r), '{}'::jsonb),
    'drafts', (select count(*) from ops.case_records where status = 'draft' and held_on between p_from and p_to),
    'children_seen', (select count(distinct patient_id) from ops.case_records where status = 'approved' and held_on between p_from and p_to),
    'referrals', coalesce((select jsonb_object_agg(status, n) from (
        select status, count(*) as n from ops.referrals where date between p_from and p_to group by status) r), '{}'::jsonb),
    'housed', coalesce((select jsonb_object_agg(coalesce(sex, 'unknown'), n) from (
        select p.sex, count(distinct p.id) as n from ops.nightly_record nr join ops.patients p on p.id = nr.patient_id
         where nr.night between p_from and p_to group by p.sex) h), '{}'::jsonb),
    'first_stays', (select count(*) from (
        select patient_id from ops.nightly_record group by patient_id having min(night) between p_from and p_to) f)
  );
$$;
revoke execute on function ops.case_period_report(date, date) from public, anon;
grant execute on function ops.case_period_report(date, date) to authenticated;

notify pgrst, 'reload schema';
